import { createHash, randomUUID } from "node:crypto";
import type { AcpPromptDeliveryEvent } from "../types.js";
import type { AcpTurnAssurance } from "./assurance.js";
import { isRecord } from "./public/shared.js";

/** Allowlisted client/ACP facts. Opaque IDs are runtime-local, not authorization. */
export type AcpSafeObservation = Readonly<{
  schemaVersion: 1;
  sequence: number;
  monotonicMs: number;
  source: "client" | "acp_peer";
  sessionId: string;
  backendSessionId?: string;
  turnId: string;
  requestId: string;
  rpcRequestId?: string;
  type:
    | "turn_started"
    | "prompt_dispatching"
    | "prompt_submitted"
    | "prompt_response"
    | "cancellation_requested"
    | "cancellation_written"
    | "tool"
    | "turn_settled";
  toolId?: string;
  toolPhase?: "call" | "update";
  toolStatus?: "pending" | "in_progress" | "completed" | "failed" | "unknown";
  toolCoverage?: "from_call" | "update_only" | "untracked";
  toolDurationMs?: number;
  /** ACP v1 updates have no authenticated turn/request identity. */
  toolCorrelation?: "active_session_window";
  delivery?: AcpTurnAssurance["delivery"];
  transport?: AcpTurnAssurance["transport"];
  turnStatus?: AcpTurnAssurance["turnStatus"];
  failureCategory?: AcpTurnAssurance["failureCategory"];
  backendOutcome?: "unknown";
  businessValidation?: "unknown";
  cancelRequested?: boolean;
  cancelWritten?: boolean;
  cancelAcknowledged?: boolean;
  nativeToolsStopped?: "unknown";
  cleanup?: AcpTurnAssurance["cleanup"];
  durationMs?: number;
  timingMs?: AcpTurnAssurance["timingMs"];
  toolCalls: number;
  coverage: "partial";
  dropped: number;
  ignoredUpdates: number;
  trackingTruncated: boolean;
}>;

export type AcpSafeObservationOptions = {
  sink: (event: AcpSafeObservation) => void | Promise<void>;
  /** Queue limits include the in-flight event. Values are clamped to hard limits. */
  maxPendingEvents?: number;
  maxPendingBytes?: number;
  maxToolsPerTurn?: number;
  /** Total accepted output per turn, including one reserved settlement slot. */
  maxEventsPerTurn?: number;
  /** A timed-out sink is disabled; unresolved calls are never multiplied. */
  sinkTimeoutMs?: number;
};

export type AcpSafeObservationStats = {
  queued: number;
  retainedBytes: number;
  inFlight: boolean;
  dropped: number;
  delivered: number;
  sinkFailures: number;
  disabled: boolean;
};

type ObservationFields = Omit<
  AcpSafeObservation,
  "schemaVersion" | "sequence" | "monotonicMs" | "dropped" | "coverage"
>;
type TurnBudget = { accepted: number };
const MAX_EVENT_BYTES = 2048;

function bound(value: number | undefined, fallback: number, maximum: number): number {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(1, Math.min(maximum, Math.floor(value)));
}

/** One caller-owned sink, one in-flight call and a fixed bounded pending queue. */
export class SafeObserver {
  private readonly salt = randomUUID();
  private sequence = 0;
  private readonly queue: Array<{ event: AcpSafeObservation; bytes: number }> = [];
  private bytes = 0;
  private active = false;
  private disabled = false;
  private dropped = 0;
  private delivered = 0;
  private failures = 0;
  private readonly maxEvents: number;
  private readonly maxBytes: number;
  private readonly maxPerTurn: number;
  readonly maxTools: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: AcpSafeObservationOptions) {
    this.maxEvents = bound(options.maxPendingEvents, 64, 1024);
    this.maxBytes = bound(options.maxPendingBytes, 65_536, 1_048_576);
    this.maxTools = bound(options.maxToolsPerTurn, 128, 2048);
    this.maxPerTurn = Math.max(2, bound(options.maxEventsPerTurn, 256, 4096));
    this.timeoutMs = bound(options.sinkTimeoutMs, 1000, 60_000);
  }

  opaque(value: string): string {
    return createHash("sha256").update(this.salt).update(value).digest("hex");
  }

  stats(): AcpSafeObservationStats {
    return {
      queued: this.queue.length,
      retainedBytes: this.bytes,
      inFlight: this.active,
      dropped: this.dropped,
      delivered: this.delivered,
      sinkFailures: this.failures,
      disabled: this.disabled,
    };
  }

  close(): void {
    this.disabled = true;
    this.dropQueued();
  }

  emit(fields: ObservationFields, budget: TurnBudget): void {
    const event: AcpSafeObservation = Object.freeze({
      ...fields,
      schemaVersion: 1,
      sequence: ++this.sequence,
      monotonicMs: performance.now(),
      dropped: this.dropped,
      coverage: "partial",
    });
    const bytes = Buffer.byteLength(JSON.stringify(event));
    const limit = this.maxPerTurn - Number(fields.type !== "turn_settled");
    if (
      this.disabled ||
      budget.accepted >= limit ||
      bytes > MAX_EVENT_BYTES ||
      this.queue.length + Number(this.active) >= this.maxEvents ||
      this.bytes + bytes > this.maxBytes
    ) {
      this.dropped++;
      return;
    }
    budget.accepted++;
    this.queue.push({ event, bytes });
    this.bytes += bytes;
    this.drain();
  }

  private dropQueued(): void {
    for (const item of this.queue.splice(0)) {
      this.bytes -= item.bytes;
      this.dropped++;
    }
  }

  private drain(): void {
    if (this.active || this.disabled) {
      return;
    }
    const next = this.queue.shift();
    if (!next) {
      return;
    }
    this.active = true;
    let failed = false;
    const fail = () => {
      if (failed) {
        return;
      }
      failed = true;
      this.failures++;
      this.dropped++;
      this.disabled = true;
      this.dropQueued();
    };
    const timer = setTimeout(fail, this.timeoutMs);
    timer.unref();
    void Promise.resolve()
      .then(() => this.options.sink(next.event))
      .then(() => {
        if (!failed) {
          this.delivered++;
        }
      })
      .catch(fail)
      .finally(() => {
        clearTimeout(timer);
        this.active = false;
        this.bytes -= next.bytes;
        this.drain();
      });
  }
}

type ToolState = {
  id: string;
  status: NonNullable<AcpSafeObservation["toolStatus"]>;
  startedAt: number;
  fromCall: boolean;
};

type ToolUpdate = {
  session: unknown;
  id?: string;
  phase: "call" | "update";
  status: NonNullable<AcpSafeObservation["toolStatus"]>;
  hasStatus: boolean;
};

function sessionUpdate(message: unknown): Record<string, unknown> | undefined {
  if (!isRecord(message) || message.method !== "session/update" || "id" in message) {
    return undefined;
  }
  return isRecord(message.params) ? message.params : undefined;
}

function toolUpdate(message: unknown): ToolUpdate | undefined {
  const params = sessionUpdate(message);
  const update = params?.update;
  if (!isRecord(update)) {
    return undefined;
  }
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
    return undefined;
  }
  return {
    session: params?.sessionId,
    id: typeof update.toolCallId === "string" ? update.toolCallId : undefined,
    phase: update.sessionUpdate === "tool_call" ? "call" : "update",
    status: toolStatus(update.status),
    hasStatus: update.status != null,
  };
}

export class SafeTurnObserver {
  private readonly tools = new Map<string, ToolState>();
  private readonly budget: TurnBudget = { accepted: 0 };
  private truncated = false;
  private ignored = 0;
  private activeSession?: string;
  private responseSeen = false;
  private settled = false;
  private cancelSeen = false;
  private readonly ids: {
    sessionId: string;
    requestId: string;
    turnId: string;
    backendSessionId?: string;
    rpcRequestId?: string;
  };

  constructor(
    private readonly observer: SafeObserver,
    identity: AcpTurnAssurance["identity"],
    session: string,
  ) {
    this.ids = {
      sessionId: observer.opaque(`session:${session}`),
      requestId: observer.opaque(`request:${identity.requestId}`),
      turnId: observer.opaque(`turn:${identity.turnId}`),
    };
    this.emit({ type: "turn_started", source: "client", delivery: "unsent" });
  }

  identity(): NonNullable<AcpTurnAssurance["observationIdentity"]> {
    return { ...this.ids };
  }

  delivery(event: AcpPromptDeliveryEvent): void {
    if (this.settled) {
      return;
    }
    if (event.type === "cancel_written") {
      this.emit({ type: "cancellation_written", source: "client", cancelWritten: true });
      return;
    }
    this.promptDelivery(event);
  }

  private promptDelivery(event: Exclude<AcpPromptDeliveryEvent, { type: "cancel_written" }>): void {
    if (event.type === "dispatching") {
      this.activeSession = event.sessionId;
      this.ids.backendSessionId = this.observer.opaque(`backend:${event.sessionId}`);
      this.ids.rpcRequestId = this.observer.opaque(
        `rpc:${this.ids.turnId}:${typeof event.requestId}:${event.requestId}`,
      );
      this.emit({ type: "prompt_dispatching", source: "client", delivery: "unknown" });
    } else if (event.type === "submitted") {
      this.emit({ type: "prompt_submitted", source: "client", delivery: "submitted" });
    } else if (event.type === "response" && !this.responseSeen) {
      this.responseSeen = true;
      this.emit({
        type: "prompt_response",
        source: "acp_peer",
        delivery: event.errorCode === undefined ? "finished" : "failed",
        transport: event.errorCode === undefined ? "response" : "rpc_error",
      });
    }
  }

  requestCancel(): void {
    if (this.cancelSeen || this.settled) {
      return;
    }
    this.cancelSeen = true;
    this.emit({ type: "cancellation_requested", source: "client", cancelRequested: true });
  }

  sessionMessage(message: unknown): void {
    const update = toolUpdate(message);
    if (!update) {
      return;
    }
    // v1 supplies a session, not a turn ID. Never trust _meta as extra authority.
    if (!this.isCurrentSession(update.session)) {
      this.ignored++;
      return;
    }
    const tool = this.tool(update.id, update.phase === "call");
    if (tool && update.hasStatus) {
      tool.status = update.status;
    }
    this.emitTool(tool, update);
  }

  private isCurrentSession(session: unknown): boolean {
    return (
      !this.settled &&
      Boolean(this.activeSession) &&
      !this.responseSeen &&
      session === this.activeSession
    );
  }

  private emitTool(tool: ToolState | undefined, update: ToolUpdate): void {
    this.emit({
      type: "tool",
      source: "acp_peer",
      toolPhase: update.phase,
      toolCorrelation: "active_session_window",
      toolCoverage: tool ? (tool.fromCall ? "from_call" : "update_only") : "untracked",
      ...(tool
        ? { toolId: tool.id, toolDurationMs: Math.max(0, performance.now() - tool.startedAt) }
        : {}),
      toolStatus: tool?.status ?? update.status,
    });
  }

  settle(receipt: AcpTurnAssurance): void {
    this.settled = true;
    this.emit({
      type: "turn_settled",
      source: "client",
      delivery: receipt.delivery,
      transport: receipt.transport,
      turnStatus: receipt.turnStatus,
      failureCategory: receipt.failureCategory,
      durationMs: receipt.durationMs,
      ...(receipt.timingMs === undefined ? {} : { timingMs: Object.freeze({ ...receipt.timingMs }) }),
      backendOutcome: "unknown",
      businessValidation: "unknown",
      cancelRequested: receipt.cancellation.requested,
      cancelWritten: receipt.cancellation.notificationWritten,
      cancelAcknowledged: receipt.cancellation.acknowledged,
      nativeToolsStopped: "unknown",
      cleanup: receipt.cleanup,
    });
    this.tools.clear();
    this.activeSession = undefined;
  }

  private tool(value: string | undefined, fromCall: boolean): ToolState | undefined {
    if (!value || value.length > 4096) {
      this.truncated = true;
      return undefined;
    }
    const key = this.observer.opaque(value);
    const existing = this.tools.get(key);
    if (existing) {
      return existing;
    }
    if (this.tools.size >= this.observer.maxTools) {
      this.truncated = true;
      return undefined;
    }
    const tool = {
      id: this.observer.opaque(this.ids.turnId + key),
      status: "unknown" as const,
      startedAt: performance.now(),
      fromCall,
    };
    this.tools.set(key, tool);
    return tool;
  }

  private emit(
    fields: Pick<AcpSafeObservation, "type" | "source"> & Partial<AcpSafeObservation>,
  ): void {
    this.observer.emit(
      {
        ...this.ids,
        ...fields,
        toolCalls: this.tools.size,
        ignoredUpdates: this.ignored,
        trackingTruncated: this.truncated,
      },
      this.budget,
    );
  }
}

function toolStatus(value: unknown): NonNullable<AcpSafeObservation["toolStatus"]> {
  switch (value) {
    case "pending":
    case "in_progress":
    case "completed":
    case "failed":
      return value;
    default:
      return "unknown";
  }
}
