import { randomUUID } from "node:crypto";
import { withTimeout } from "../async-control.js";
import type { AcpPromptDeliveryEvent } from "../types.js";
import { TurnEvidence, type AcpTurnAssurance } from "./assurance.js";
import { createDeferred } from "./engine/turn.js";
import { SafeTurnObserver, type SafeObserver } from "./observation.js";
import type {
  AcpRuntimeTurn,
  AcpRuntimeTurnInput,
  AcpRuntimeTurnResult,
} from "./public/contract.js";
import { AcpRuntimeError } from "./public/errors.js";

/** Keeps opt-in observation/evidence out of the existing admission and ownership policy. */
export class RuntimeTurnAssurance {
  private readonly evidence?: TurnEvidence;
  private readonly observer?: SafeTurnObserver;
  private final?: AcpTurnAssurance;
  private readonly receipt;
  readonly fields: Pick<AcpRuntimeTurn, "assurance" | "getAssurance">;

  constructor(input: AcpRuntimeTurnInput, observer?: SafeObserver) {
    if (!input.assurance && !observer) {
      this.fields = {};
      return;
    }
    const identity = {
      requestId: input.requestId,
      turnId: randomUUID(),
      acpxRecordId: input.handle.acpxRecordId,
      backendSessionId: input.handle.backendSessionId,
    };
    this.observer = observer
      ? new SafeTurnObserver(
          observer,
          identity,
          input.handle.acpxRecordId ?? input.handle.sessionKey,
        )
      : undefined;
    this.evidence = new TurnEvidence(identity);
    this.receipt = input.assurance ? createDeferred<AcpTurnAssurance>() : undefined;
    this.fields = this.receipt
      ? {
          assurance: this.receipt.promise,
          getAssurance: async () => structuredClone(this.final ?? this.snapshot()),
        }
      : {};
  }

  settle(result: AcpRuntimeTurnResult): void {
    if (!this.evidence) {
      return;
    }
    this.final = this.snapshot(result);
    this.receipt?.resolve(structuredClone(this.final));
    this.observer?.settle(this.final);
  }
  private snapshot(result?: AcpRuntimeTurnResult): AcpTurnAssurance {
    return {
      ...this.evidence!.snapshot(result),
      ...(this.observer ? { observationIdentity: this.observer.identity() } : {}),
    };
  }
  requestCancel(active: boolean): void {
    if (active) {
      this.evidence?.requestCancel();
      this.observer?.requestCancel();
    }
  }
  observe(event: AcpPromptDeliveryEvent): void {
    this.evidence?.observe(event);
    this.observer?.delivery(event);
  }
  sessionMessage(message: unknown): void {
    this.observer?.sessionMessage(message);
  }
  stopReason(value: string): void {
    this.evidence?.stopReason(value);
  }
  cleanupStart(hasTurn: boolean, pooled: boolean): void {
    if (this.evidence && hasTurn) {
      this.evidence.cleanup = pooled ? "retained" : "attempted";
    }
  }
  cleanupEnd(hasTurn: boolean, pooled: boolean, ok: boolean, timedOut = false): void {
    if (this.evidence && hasTurn && !pooled) {
      if (timedOut) {
        this.evidence.cleanup = "cleanup_timed_out";
      } else if (ok) {
        this.evidence.cleanup = "owned_close_settled";
      }
    }
  }
}

export async function boundedCancel(
  cancel: () => Promise<unknown>,
  timeoutMs?: number,
): Promise<void> {
  if (
    timeoutMs !== undefined &&
    (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)
  ) {
    throw new AcpRuntimeError(
      "ACP_INVALID_RUNTIME_OPTION",
      "cancel timeoutMs must be between 1 and 2147483647.",
    );
  }
  await withTimeout(cancel(), timeoutMs);
}
