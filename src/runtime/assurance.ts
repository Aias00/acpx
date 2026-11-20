import type { AcpPromptDeliveryEvent, SessionRecord } from "../types.js";
import type { AcpRuntimeControl, AcpRuntimeTurnResult } from "./public/contract.js";

export type AcpEvidenceState = "advertised" | "unsupported" | "unknown";

/** A snapshot of claims, not a permission grant or a live capability probe. */
export type AcpCapabilityEvidence = {
  schemaVersion: 1;
  local: { source: "client_implementation"; controls: AcpRuntimeControl[] };
  peer: {
    source: "initialize_snapshot" | "none";
    freshness: "stored" | "unknown";
    protocolVersion?: number;
    loadSession: AcpEvidenceState;
    resumeSession: AcpEvidenceState;
    closeSession: AcpEvidenceState;
    listSessions: AcpEvidenceState;
  };
  qualification: { source: "none"; state: "unknown" };
};

function advertisement(value: unknown): AcpEvidenceState {
  if (value === false) {
    return "unsupported";
  }
  if (value === true || (value !== null && typeof value === "object")) {
    return "advertised";
  }
  return "unknown";
}

export function capabilityEvidence(
  record: SessionRecord | undefined,
  controls: AcpRuntimeControl[],
): AcpCapabilityEvidence {
  return {
    schemaVersion: 1,
    local: { source: "client_implementation", controls: [...controls] },
    peer: peerEvidence(record),
    qualification: { source: "none", state: "unknown" },
  };
}

function peerEvidence(record: SessionRecord | undefined): AcpCapabilityEvidence["peer"] {
  const peer = record?.agentCapabilities;
  const sessions = peer?.sessionCapabilities;
  return {
    source: peer ? "initialize_snapshot" : "none",
    freshness: peer ? "stored" : "unknown",
    protocolVersion: record?.protocolVersion,
    loadSession: advertisement(peer?.loadSession),
    ...sessionAdvertisements(sessions),
  };
}

function sessionAdvertisements(
  sessions: NonNullable<SessionRecord["agentCapabilities"]>["sessionCapabilities"],
) {
  return {
    resumeSession: advertisement(sessions?.resume),
    closeSession: advertisement(sessions?.close),
    listSessions: advertisement(sessions?.list),
  };
}

export type AcpTurnAssurance = {
  schemaVersion: 1;
  /** Present only with the safe observer; maps private receipt IDs to runtime-local aliases. */
  observationIdentity?: {
    sessionId: string;
    requestId: string;
    turnId: string;
    backendSessionId?: string;
    rpcRequestId?: string;
  };
  /** Caller/private identities. This receipt is not sanitized telemetry. */
  identity: {
    requestId: string;
    turnId: string;
    acpxRecordId?: string;
    backendSessionId?: string;
    rpcRequestId?: string | number | null;
  };
  delivery: "unsent" | "submitted" | "finished" | "failed" | "unknown";
  transport: "not_dispatched" | "no_response" | "response" | "rpc_error";
  turnStatus: AcpRuntimeTurnResult["status"] | "pending";
  backendOutcome: "unknown";
  businessValidation: "unknown";
  cancellation: {
    requested: boolean;
    notificationWritten: boolean;
    acknowledged: boolean;
    nativeToolsStopped: "unknown";
  };
  cleanup: "not_started" | "retained" | "attempted" | "owned_close_settled" | "cleanup_timed_out";
  failureCategory:
    | "none"
    | "before_dispatch"
    | "acp_error"
    | "transport_or_client"
    | "client_finalization";
  durationMs: number;
};

/** One bounded tracker per admitted turn. Never reads prose, _meta or native files. */
export class TurnEvidence {
  private readonly startedAt = performance.now();
  private attempted = false;
  private submitted = false;
  private response: "response" | "rpc_error" | undefined;
  private acknowledged = false;
  private requested = false;
  private cancelWritten = false;
  cleanup: AcpTurnAssurance["cleanup"] = "not_started";

  constructor(private readonly identity: AcpTurnAssurance["identity"]) {}

  requestCancel(): void {
    this.requested = true;
  }

  observe(event: AcpPromptDeliveryEvent): void {
    if (event.type === "cancel_written") {
      this.cancelWritten = true;
      return;
    }
    this.identity.backendSessionId = event.sessionId;
    this.identity.rpcRequestId = event.requestId;
    if (event.type === "dispatching") {
      this.attempted = true;
    }
    if (event.type === "submitted") {
      this.submitted = true;
    }
    // A duplicate success can never overwrite a settled RPC error.
    if (event.type === "response" && !this.response) {
      this.response = event.errorCode === undefined ? "response" : "rpc_error";
    }
  }

  stopReason(value: string): void {
    this.acknowledged = value === "cancelled";
  }

  snapshot(result?: AcpRuntimeTurnResult): AcpTurnAssurance {
    const transport = this.response ?? (this.attempted ? "no_response" : "not_dispatched");
    return {
      schemaVersion: 1,
      identity: { ...this.identity },
      delivery: this.delivery(result !== undefined),
      transport,
      turnStatus: result?.status ?? "pending",
      backendOutcome: "unknown",
      businessValidation: "unknown",
      cancellation: {
        requested: this.requested,
        notificationWritten: this.cancelWritten,
        acknowledged: this.acknowledged,
        nativeToolsStopped: "unknown",
      },
      cleanup: this.cleanup,
      failureCategory: this.failureCategory(result),
      durationMs: Math.max(0, performance.now() - this.startedAt),
    };
  }

  private delivery(settled: boolean): AcpTurnAssurance["delivery"] {
    if (this.response) {
      return this.response === "rpc_error" ? "failed" : "finished";
    }
    if (!this.attempted) {
      return "unsent";
    }
    if (settled) {
      return "unknown";
    }
    return this.submitted ? "submitted" : "unknown";
  }

  private failureCategory(result?: AcpRuntimeTurnResult): AcpTurnAssurance["failureCategory"] {
    if (this.response === "rpc_error") {
      return "acp_error";
    }
    if (result?.status !== "failed") {
      return "none";
    }
    if (!this.attempted) {
      return "before_dispatch";
    }
    return this.response ? "client_finalization" : "transport_or_client";
  }
}
