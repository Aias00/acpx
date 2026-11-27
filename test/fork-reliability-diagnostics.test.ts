import assert from "node:assert/strict";
import test from "node:test";
import { RequestError } from "@agentclientprotocol/sdk";
import { AgentDisconnectedError } from "../src/errors.js";
import { TurnEvidence } from "../src/runtime/assurance.js";
import { AcpRuntimeError } from "../src/runtime/public/errors.js";
import {
  buildRuntimeTurnResultError,
  mapEnsureSessionFailure,
  readObservedProcessExit,
  readObservedRpcCode,
} from "../src/runtime/public/failure-evidence.js";
import { fixture, turnInput } from "./fork-reliability-helpers.js";

test("failure evidence: preserves correlated ACP rpcCode on failed turn errors", () => {
  const error = RequestError.internalError("Synthetic failure");
  assert.equal(buildRuntimeTurnResultError(error).rpcCode, -32603);
  assert.equal(readObservedRpcCode(error), -32603);
});

test("failure evidence: preserves validated process exit on typed disconnect errors", () => {
  const error = new AgentDisconnectedError("process_exit", 17, "SIGKILL");
  assert.deepEqual(readObservedProcessExit(error), { exitCode: 17, signal: "SIGKILL" });
  const turn = buildRuntimeTurnResultError(error);
  assert.equal(turn.exitCode, 17);
  assert.equal(turn.signal, "SIGKILL");
  assert.equal(turn.detailCode, "AGENT_DISCONNECTED");
});

test("failure evidence: omits cleanup-only connection_close without exit status", () => {
  const error = new AgentDisconnectedError("connection_close", null, null);
  assert.deepEqual(readObservedProcessExit(error), {});
});

test("failure evidence: maps setup failures to typed runtime errors with detailCode", () => {
  const cause = Object.assign(new Error("Synthetic load refusal"), {
    detailCode: "ACP_PROTOCOL_VERSION_MISMATCH",
    acp: { code: -32603, message: "Synthetic load refusal" },
  });
  const mapped = mapEnsureSessionFailure(cause);
  assert.ok(mapped instanceof AcpRuntimeError);
  assert.equal(mapped.code, "ACP_SESSION_INIT_FAILED");
  assert.equal(mapped.detailCode, "ACP_PROTOCOL_VERSION_MISMATCH");
  assert.equal(mapped.rpcCode, -32603);
});

test("turn assurance: cancellation acknowledgement is measured at wire response receipt", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const evidence = new TurnEvidence({ requestId: "request", turnId: "turn" });
  const owner = { sessionId: "session", requestId: 1 };

  evidence.requestCancel();
  now = 2;
  evidence.observe({ type: "cancel_written" });
  now = 5;
  evidence.observe({ type: "response", ...owner, stopReason: "cancelled" });
  now = 50;

  assert.deepEqual(evidence.snapshot().timingMs, { cancelWriteToAcknowledgement: 3 });
  const receipt = evidence.snapshot({ status: "cancelled", stopReason: "cancelled" });
  assert.equal(receipt.cancellation.acknowledged, true);
  assert.deepEqual(receipt.timingMs?.cancelWriteToAcknowledgement, 3);
  assert.equal(receipt.timingMs?.responseToSettlement, 45);
});

test("turn assurance: bridge rpcCode remains when turn error omitted wire code", () => {
  const evidence = new TurnEvidence({ requestId: "request", turnId: "turn" });
  const owner = { sessionId: "session", requestId: 1 };
  evidence.observe({ type: "response", ...owner, errorCode: -32001 });
  const receipt = evidence.snapshot({
    status: "failed",
    error: { message: "Synthetic", detailCode: "SESSION_RESUME_REQUIRED" },
  });
  assert.equal(receipt.rpcCode, -32001);
});

test("fork reliability diagnostics: prompt RPC failures expose rpcCode on the public turn result", async () => {
  await fixture("rpc-error", async ({ runtime, ensure }) => {
    const turn = runtime.startTurn({ ...turnInput, handle: await ensure() });
    const result = await turn.result;
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.equal(result.error.rpcCode, -32603);
    }
    const evidence = await turn.assurance;
    assert.equal(evidence?.rpcCode, undefined);
  });
});

test("fork reliability diagnostics: cancel acknowledgement timing excludes late update drain", async () => {
  await fixture("cancel-late-updates", async ({ runtime, ensure, wait }) => {
    const turn = runtime.startTurn({ ...turnInput, handle: await ensure() });
    await turn.promptStarted;
    await wait("session/prompt");
    await turn.cancel({ timeoutMs: 1000 });
    await wait("session/cancel");
    const ackReceipt = await turn.getAssurance?.();
    assert.ok(ackReceipt?.cancellation.acknowledged);
    const ackMs = ackReceipt?.timingMs?.cancelWriteToAcknowledgement;
    assert.equal(typeof ackMs, "number");
    assert.equal((await turn.result).status, "cancelled");
    assert.equal((await turn.assurance)?.timingMs?.cancelWriteToAcknowledgement, ackMs);
  });
});

test("fork reliability diagnostics: incompatible initialize preserves detailCode on setup rejection", async () => {
  await fixture("incompatible", async ({ ensure }) => {
    await assert.rejects(ensure(), (error: unknown) => {
      assert.ok(error instanceof AcpRuntimeError);
      assert.equal(error.detailCode, "ACP_PROTOCOL_VERSION_MISMATCH");
      return true;
    });
  });
});
