import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  collectForkAuditTurn,
  waitForForkAuditMethod,
  withForkAuditRuntime,
} from "./fork-audit-helpers.js";

const input = {
  text: "synthetic audit input",
  mode: "prompt",
  requestId: "audit-request",
} as const;

test("fork audit: ordinary v1 empty completion describes a turn without a business effect", async () => {
  await withForkAuditRuntime("empty", async ({ root, runtime, ensure, receipts }) => {
    const handle = await ensure();
    const { result, events } = await collectForkAuditTurn(runtime.startTurn({ ...input, handle }));
    assert.equal(result.status, "completed");
    assert.equal("stopReason" in result ? result.stopReason : undefined, "end_turn");
    assert.equal(
      events.some((event) => event.type === "text_delta"),
      false,
    );
    await assert.rejects(fs.readFile(path.join(root, "effect")), { code: "ENOENT" });
    assert.equal((await receipts()).filter((row) => row.method === "session/prompt").length, 1);
  });
});

test("fork audit: RPC error cannot be overwritten by a duplicate normal stop", async () => {
  await withForkAuditRuntime("rpc-error", async ({ runtime, ensure, receipts }) => {
    const handle = await ensure();
    const { result } = await collectForkAuditTurn(runtime.startTurn({ ...input, handle }));
    assert.equal(result.status, "failed");
    assert.equal((await receipts()).filter((row) => row.method === "session/prompt").length, 1);
  });
});

test("fork audit: prose and untrusted peer metadata do not acquire native outcome authority", async () => {
  await withForkAuditRuntime("untrusted-meta", async ({ runtime, ensure }) => {
    const handle = await ensure();
    const { result, events } = await collectForkAuditTurn(runtime.startTurn({ ...input, handle }));
    assert.equal(result.status, "completed");
    assert.ok(events.some((event) => event.type === "text_delta"));
    assert.deepEqual("_meta" in result ? result._meta : undefined, {
      nativeOutcome: "failed",
      trusted: true,
    });
  });
});

test("fork audit: explicit cold resume loads the same backend session and project", async () => {
  await withForkAuditRuntime("empty", async ({ runtime, ensure, receipts }) => {
    const original = await ensure();
    await runtime.close({ handle: original, reason: "fixture cold reconnect" });
    const exact = await runtime.ensureSession({
      sessionKey: "audit",
      agent: "fixture",
      mode: "persistent",
      resumeSessionId: original.backendSessionId,
    });
    const { result } = await collectForkAuditTurn(runtime.startTurn({ ...input, handle: exact }));
    assert.equal(result.status, "completed");
    assert.equal(exact.acpxRecordId, original.acpxRecordId);
    assert.equal(exact.backendSessionId, original.backendSessionId);
    const rows = await receipts();
    const loads = rows.filter((row) => row.method === "session/load");
    assert.equal(rows.filter((row) => row.method === "session/new").length, 1);
    assert.equal(loads.length, 1);
    assert.equal(loads[0].sessionId, original.backendSessionId);
    assert.equal(loads[0].projectMatches, true);
  });
});

test("fork audit: explicit resume failure creates no replacement session and dispatches no prompt", async () => {
  await withForkAuditRuntime("empty", async ({ root, runtime, ensure, receipts }) => {
    const original = await ensure();
    await runtime.close({ handle: original, reason: "fixture failed reconnect" });
    const exact = await runtime.ensureSession({
      sessionKey: "audit",
      agent: "fixture",
      mode: "persistent",
      resumeSessionId: original.backendSessionId,
    });
    await fs.writeFile(path.join(root, "reject-load"), "reject");
    const turn = runtime.startTurn({ ...input, handle: exact });
    await assert.rejects(turn.promptStarted);
    assert.equal((await turn.result).status, "failed");
    const rows = await receipts();
    assert.equal(rows.filter((row) => row.method === "session/new").length, 1);
    assert.equal(rows.filter((row) => row.method === "session/prompt").length, 0);
  });
});

test("fork audit: EOF after a written request preserves one synthetic effect without replay", async () => {
  await withForkAuditRuntime("eof", async ({ root, runtime, ensure, receipts }) => {
    const handle = await ensure();
    const turn = runtime.startTurn({ ...input, handle });
    await turn.promptStarted;
    assert.equal((await turn.result).status, "failed");
    assert.equal(await fs.readFile(path.join(root, "effect"), "utf8"), "one synthetic effect");
    const prompts = (await receipts()).filter((row) => row.method === "session/prompt");
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].sessionId, handle.backendSessionId);
  });
});

test("fork audit: denied host authority stays unsent", async () => {
  await withForkAuditRuntime("empty", async ({ runtime, ensure, receipts }) => {
    const handle = await ensure();
    const turn = runtime.startTurn({
      ...input,
      handle,
      assertActive: () => {
        throw new Error("Synthetic revoked authority");
      },
    });
    await assert.rejects(turn.promptStarted);
    assert.equal((await turn.result).status, "failed");
    assert.equal((await receipts()).filter((row) => row.method === "session/prompt").length, 0);
  });
});

test("fork audit: same-session turns serialize until the first turn settles", async () => {
  await withForkAuditRuntime("hold", async ({ root, runtime, ensure, receipts }) => {
    const handle = await ensure();
    const first = runtime.startTurn({ ...input, handle, requestId: "first" });
    await first.promptStarted;
    await waitForForkAuditMethod(root, "session/prompt");
    const second = runtime.startTurn({ ...input, handle, requestId: "second" });
    const writtenBeforeRelease = await Promise.race([
      second.promptStarted.then(() => true),
      delay(75).then(() => false),
    ]);
    assert.equal((await receipts()).filter((row) => row.method === "session/prompt").length, 1);
    assert.equal(writtenBeforeRelease, false);
    await fs.writeFile(path.join(root, "release"), "release");
    assert.equal((await first.result).status, "completed");
    assert.equal((await second.result).status, "completed");
    const prompts = (await receipts()).filter((row) => row.method === "session/prompt");
    assert.equal(prompts.length, 2);
    assert.notEqual(prompts[0].id, prompts[1].id);
    assert.equal(prompts[0].sessionId, prompts[1].sessionId);
  });
});

test("fork audit: ignored cancel is not an acknowledged cancellation or a tool stop", async () => {
  await withForkAuditRuntime("cancel-ignored", async ({ root, runtime, ensure, receipts }) => {
    const handle = await ensure();
    const turn = runtime.startTurn({ ...input, handle });
    await turn.promptStarted;
    await waitForForkAuditMethod(root, "session/prompt");
    await turn.cancel();
    await waitForForkAuditMethod(root, "session/cancel");
    let settled = false;
    void turn.result.then(() => {
      settled = true;
    });
    await receipts();
    assert.equal(settled, false);
    await fs.writeFile(path.join(root, "release"), "release");
    const result = await turn.result;
    assert.equal(result.status, "completed");
    assert.equal("stopReason" in result ? result.stopReason : undefined, "end_turn");
    assert.equal((await receipts()).filter((row) => row.method === "session/cancel").length, 1);
  });
});

test("fork audit: cancelled stop is distinct from merely writing cancel", async () => {
  await withForkAuditRuntime("cancel-ack", async ({ root, runtime, ensure }) => {
    const handle = await ensure();
    const turn = runtime.startTurn({ ...input, handle });
    await turn.promptStarted;
    await waitForForkAuditMethod(root, "session/prompt");
    await turn.cancel();
    const result = await turn.result;
    assert.equal(result.status, "cancelled");
    assert.equal("stopReason" in result ? result.stopReason : undefined, "cancelled");
  });
});

test("fork audit: rich runtime events retain private synthetic fields and tool update identity", async () => {
  await withForkAuditRuntime("rich-events", async ({ runtime, ensure }) => {
    const handle = await ensure();
    const { result, events } = await collectForkAuditTurn(runtime.startTurn({ ...input, handle }));
    assert.equal(result.status, "completed");
    const tools = events.filter((event) => event.type === "tool_call");
    assert.equal(tools.length, 2);
    assert.equal(new Set(tools.map((event) => event.toolCallId)).size, 1);
    assert.deepEqual(tools[0].rawInput, { token: "SYNTHETIC_PRIVATE_ARGUMENT" });
    assert.deepEqual(tools[1].rawOutput, { text: "SYNTHETIC_PRIVATE_OUTPUT" });
    assert.ok(events.some((event) => event.type === "text_delta" && event.stream === "thought"));
  });
});

for (const failure of ["throw", "reject"] as const) {
  test(`fork audit: ${failure} from a runtime wire observer does not change turn outcome`, async () => {
    let calls = 0;
    await withForkAuditRuntime(
      "empty",
      async ({ runtime, ensure }) => {
        const handle = await ensure();
        const { result } = await collectForkAuditTurn(runtime.startTurn({ ...input, handle }));
        assert.equal(result.status, "completed");
        assert.ok(calls > 0);
      },
      {
        onAcpMessage: () => {
          calls += 1;
          if (failure === "throw") {
            throw new Error("Synthetic observer failure");
          }
          return Promise.reject(new Error("Synthetic observer rejection"));
        },
      },
    );
  });
}
