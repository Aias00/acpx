import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { AcpSafeObservation } from "../src/runtime.js";
import { fixture, turnInput } from "./fork-reliability-helpers.js";

test("fork reliability: rejects a different protocol before auth/new/prompt", async () => {
  await fixture("incompatible", async ({ ensure, rows }) => {
    await assert.rejects(ensure(), { detailCode: "ACP_PROTOCOL_VERSION_MISMATCH" });
    assert.deepEqual(
      (await rows()).map((row) => row.method),
      ["initialize"],
    );
  });
});

for (const profile of ["resumable", "basic"]) {
  test(`fork reliability: ${profile} advertisement is separate from local methods and qualification`, async () => {
    await fixture(
      "empty",
      async ({ runtime, ensure, rows }) => {
        const before = await runtime.getCapabilityEvidence();
        assert.equal(before.peer.loadSession, "unknown");
        assert.equal((await rows()).length, 0);
        const handle = await ensure();
        const evidence = await runtime.getCapabilityEvidence({ handle });
        assert.equal(
          evidence.peer.loadSession,
          profile === "resumable" ? "advertised" : "unsupported",
        );
        assert.equal(evidence.peer.resumeSession, "unknown");
        assert.equal(evidence.peer.freshness, "stored");
        assert.equal(evidence.qualification.state, "unknown");
        assert.deepEqual(evidence.local.controls, (await runtime.getCapabilities()).controls);
        evidence.local.controls.length = 0;
        assert.equal((await runtime.getCapabilityEvidence()).local.controls.length, 4);
        assert.deepEqual(
          (await rows()).map((row) => row.method),
          ["initialize", "session/new"],
        );
      },
      {},
      profile,
    );
  });
}

test("fork reliability: legacy empty v1 result remains a completed turn", async () => {
  await fixture("empty", async ({ runtime, ensure, root }) => {
    const turn = runtime.startTurn({ ...turnInput, assurance: false, handle: await ensure() });
    assert.equal(turn.assurance, undefined);
    assert.deepEqual(await turn.result, { status: "completed", stopReason: "end_turn" });
    await assert.rejects(fs.readFile(path.join(root, "effect")), { code: "ENOENT" });
  });
});

test("fork reliability: normal stop has transport receipt and unknown backend/business outcomes", async () => {
  await fixture("empty", async ({ runtime, ensure, rows }) => {
    const handle = await ensure();
    const turn = runtime.startTurn({ ...turnInput, handle });
    await turn.result;
    const evidence = await turn.assurance;
    assert.ok(evidence);
    assert.equal(evidence.delivery, "finished");
    assert.equal(evidence.transport, "response");
    assert.equal(evidence.backendOutcome, "unknown");
    assert.equal(evidence.businessValidation, "unknown");
    const sent = (await rows()).find((row) => row.method === "session/prompt");
    assert.equal(evidence.identity.rpcRequestId, sent?.id);
    assert.equal(evidence.identity.backendSessionId, handle.backendSessionId);
    assert.equal(evidence.identity.requestId, turnInput.requestId);
    assert.equal(evidence.cleanup, "retained");
  });
});

test("fork reliability: assurance and request identity are captured at public admission", async () => {
  await fixture("empty", async ({ runtime, ensure }) => {
    const input = { ...turnInput, assurance: true, requestId: "admitted", handle: await ensure() };
    const turn = runtime.startTurn(input);
    input.requestId = "mutated";
    input.assurance = false;
    await turn.result;
    assert.equal(turn.requestId, "admitted");
    assert.equal((await turn.assurance)?.identity.requestId, "admitted");
    assert.equal((await turn.getAssurance?.())?.identity.requestId, "admitted");
  });
});

test("fork reliability: explicit RPC error dominates duplicate success", async () => {
  await fixture("rpc-error", async ({ runtime, ensure }) => {
    const turn = runtime.startTurn({ ...turnInput, handle: await ensure() });
    assert.equal((await turn.result).status, "failed");
    const evidence = await turn.assurance;
    assert.equal(evidence?.delivery, "failed");
    assert.equal(evidence?.transport, "rpc_error");
    assert.equal(evidence?.failureCategory, "acp_error");
    assert.equal(evidence?.backendOutcome, "unknown");
  });
});

test("fork reliability: model prose and _meta cannot manufacture native evidence", async () => {
  await fixture("untrusted", async ({ runtime, ensure }) => {
    const turn = runtime.startTurn({ ...turnInput, handle: await ensure() });
    assert.equal((await turn.result).status, "completed");
    const evidence = await turn.assurance;
    assert.equal(evidence?.backendOutcome, "unknown");
    assert.equal(evidence?.businessValidation, "unknown");
    assert.equal(JSON.stringify(evidence).includes("SYNTHETIC_SECRET"), false);
  });
});

test("fork reliability: revoked authority is proven unsent", async () => {
  await fixture("empty", async ({ runtime, ensure, rows }) => {
    const turn = runtime.startTurn({
      ...turnInput,
      handle: await ensure(),
      assertActive() {
        throw new Error("revoked");
      },
    });
    await assert.rejects(turn.promptStarted);
    assert.equal((await turn.result).status, "failed");
    assert.equal((await turn.assurance)?.delivery, "unsent");
    assert.equal((await turn.assurance)?.failureCategory, "before_dispatch");
    assert.equal((await rows()).filter((row) => row.method === "session/prompt").length, 0);
  });
});

test("fork reliability: submitted is not a peer receipt; EOF remains ambiguous with no replay", async () => {
  await fixture("eof", async ({ root, runtime, ensure, rows }) => {
    const turn = runtime.startTurn({ ...turnInput, handle: await ensure() });
    await turn.promptStarted;
    assert.equal((await turn.result).status, "failed");
    const evidence = await turn.assurance;
    assert.equal(evidence?.delivery, "unknown");
    assert.equal(evidence?.transport, "no_response");
    assert.equal(evidence?.failureCategory, "transport_or_client");
    assert.equal(await fs.readFile(path.join(root, "effect"), "utf8"), "one effect");
    assert.equal((await rows()).filter((row) => row.method === "session/prompt").length, 1);
  });
});

test("fork reliability: cold explicit resume keeps exact backend session and project", async () => {
  await fixture("empty", async ({ runtime, ensure, rows }) => {
    const original = await ensure();
    await runtime.close({ handle: original, reason: "cold fixture" });
    const handle = await runtime.ensureSession({
      sessionKey: "private-session",
      agent: "synthetic",
      mode: "persistent",
      resumeSessionId: original.backendSessionId,
    });
    const turn = runtime.startTurn({ ...turnInput, handle });
    assert.equal((await turn.result).status, "completed");
    assert.equal((await turn.assurance)?.identity.backendSessionId, original.backendSessionId);
    const loads = (await rows()).filter((row) => row.method === "session/load");
    assert.equal(loads.length, 1);
    assert.equal(loads[0].sessionId, original.backendSessionId);
    assert.equal(loads[0].projectMatches, true);
    assert.equal((await rows()).filter((row) => row.method === "session/new").length, 1);
  });
});

test("fork reliability: failed exact resume never replaces or dispatches", async () => {
  await fixture("empty", async ({ root, runtime, ensure, rows }) => {
    const original = await ensure();
    await runtime.close({ handle: original, reason: "reject fixture" });
    const handle = await runtime.ensureSession({
      sessionKey: "private-session",
      agent: "synthetic",
      mode: "persistent",
      resumeSessionId: original.backendSessionId,
    });
    await fs.writeFile(path.join(root, "reject-load"), "reject");
    const turn = runtime.startTurn({ ...turnInput, handle });
    assert.equal((await turn.result).status, "failed");
    assert.equal((await turn.assurance)?.delivery, "unsent");
    assert.equal((await rows()).filter((row) => row.method === "session/new").length, 1);
    assert.equal((await rows()).filter((row) => row.method === "session/prompt").length, 0);
  });
});

test("fork reliability: same-session queued turn remains unsent until the active turn settles", async () => {
  await fixture("hold", async ({ root, runtime, ensure, rows, wait }) => {
    const handle = await ensure();
    const first = runtime.startTurn({ ...turnInput, handle, requestId: "first" });
    await first.promptStarted;
    await wait("session/prompt");
    assert.equal((await first.getAssurance?.())?.delivery, "submitted");
    const second = runtime.startTurn({ ...turnInput, handle, requestId: "second" });
    assert.equal((await second.getAssurance?.())?.delivery, "unsent");
    assert.equal((await rows()).filter((row) => row.method === "session/prompt").length, 1);
    await fs.writeFile(path.join(root, "release"), "release");
    await Promise.all([first.result, second.result]);
    assert.notEqual(
      (await first.assurance)?.identity.rpcRequestId,
      (await second.assurance)?.identity.rpcRequestId,
    );
    assert.notEqual(
      (await first.assurance)?.identity.turnId,
      (await second.assurance)?.identity.turnId,
    );
  });
});

for (const scenario of ["cancel-ignored", "cancel-ack"]) {
  test(`fork reliability: ${scenario} distinguishes cancel intent/write/acknowledgement`, async () => {
    await fixture(scenario, async ({ root, runtime, ensure, wait }) => {
      const turn = runtime.startTurn({ ...turnInput, handle: await ensure() });
      await turn.promptStarted;
      await wait("session/prompt");
      await turn.cancel({ timeoutMs: 1000 });
      await wait("session/cancel");
      if (scenario === "cancel-ignored") {
        const live = await turn.getAssurance?.();
        assert.equal(live?.cancellation.notificationWritten, true);
        assert.equal(live?.cancellation.acknowledged, false);
        await fs.writeFile(path.join(root, "release"), "release");
      }
      assert.equal(
        (await turn.result).status,
        scenario === "cancel-ack" ? "cancelled" : "completed",
      );
      const evidence = await turn.assurance;
      assert.equal(evidence?.cancellation.requested, true);
      assert.equal(evidence?.cancellation.notificationWritten, true);
      assert.equal(evidence?.cancellation.acknowledged, scenario === "cancel-ack");
      assert.equal(evidence?.cancellation.nativeToolsStopped, "unknown");
    });
  });
}

test("fork reliability: queued cancellation is unsent without a native acknowledgement", async () => {
  await fixture("hold", async ({ root, runtime, ensure, rows }) => {
    const handle = await ensure();
    const first = runtime.startTurn({ ...turnInput, handle });
    await first.promptStarted;
    const second = runtime.startTurn({ ...turnInput, handle, requestId: "queued" });
    await second.cancel();
    await fs.writeFile(path.join(root, "release"), "release");
    await first.result;
    assert.equal((await second.result).status, "cancelled");
    assert.equal((await second.assurance)?.delivery, "unsent");
    assert.equal((await second.assurance)?.cancellation.acknowledged, false);
    assert.equal((await rows()).filter((row) => row.method === "session/prompt").length, 1);
  });
});

test("fork reliability: a settled turn cannot cancel a later owner", async () => {
  await fixture("hold", async ({ root, runtime, ensure, rows }) => {
    const handle = await ensure();
    await fs.writeFile(path.join(root, "release"), "release");
    const old = runtime.startTurn({ ...turnInput, handle });
    await old.result;
    await fs.rm(path.join(root, "release"));
    const next = runtime.startTurn({ ...turnInput, handle, requestId: "new-owner" });
    await next.promptStarted;
    await old.cancel({ timeoutMs: 100 });
    assert.equal(
      (await rows()).some((row) => row.method === "session/cancel"),
      false,
    );
    assert.equal((await next.getAssurance?.())?.cancellation.requested, false);
    await fs.writeFile(path.join(root, "release"), "release");
    await next.result;
  });
});

test("fork reliability: blocked writes bound cancel wait and owned shutdown without certifying unsent", async () => {
  await fixture("blocked", async ({ runtime, ensure, rows }) => {
    const turn = runtime.startTurn({
      ...turnInput,
      text: "x".repeat(2_000_000),
      handle: await ensure(),
      timeoutMs: 10_000,
    });
    const deadline = performance.now() + 1000;
    while ((await turn.getAssurance?.())?.delivery === "unsent" && performance.now() < deadline) {
      await delay(5);
    }
    assert.equal((await turn.getAssurance?.())?.delivery, "unknown");
    await assert.rejects(turn.cancel({ timeoutMs: 30 }), { name: "TimeoutError" });
    const started = performance.now();
    await runtime.shutdown();
    assert.ok(performance.now() - started < 8000);
    assert.equal((await turn.result).status, "failed");
    const evidence = await turn.assurance;
    assert.equal(evidence?.delivery, "unknown");
    assert.equal(evidence?.cancellation.notificationWritten, false);
    assert.equal(evidence?.cleanup, "owned_close_settled");
    assert.equal(
      (await rows()).some((row) => row.method === "session/prompt"),
      false,
    );
  });
});

test("fork reliability: safe sink deduplicates tool identities and excludes private bodies", async () => {
  const observations: AcpSafeObservation[] = [];
  await fixture(
    "tools",
    async ({ runtime, ensure }) => {
      const turn = runtime.startTurn({ ...turnInput, handle: await ensure() });
      assert.equal((await turn.result).status, "completed");
      await delay(10);
      const tools = observations.filter((event) => event.type === "tool");
      assert.equal(tools.length, 2);
      assert.equal(tools[0].toolId, tools[1].toolId);
      assert.equal(tools[1].toolCalls, 1);
      const text = JSON.stringify(observations);
      for (const secret of [
        "SYNTHETIC_SECRET",
        "PRIVATE_TOOL",
        "PRIVATE_PATH",
        "private-request",
        "private-session",
        "reliability-session",
        "rawInput",
        "rawOutput",
      ]) {
        assert.equal(text.includes(secret), false);
      }
      assert.ok(
        observations.every(
          (event, i) =>
            event.coverage === "partial" &&
            (i === 0 || event.sequence > observations[i - 1].sequence),
        ),
      );
      assert.ok(observations.some((event) => event.type === "turn_settled"));
    },
    {
      observation: {
        sink: (event) => {
          observations.push(event);
        },
      },
    },
  );
});

test("fork reliability: never-settling bounded sink cannot hold the result or multiply calls", async () => {
  let calls = 0;
  await fixture(
    "flood",
    async ({ runtime, ensure }) => {
      const turn = runtime.startTurn({ ...turnInput, handle: await ensure() });
      assert.equal((await turn.result).status, "completed");
      await delay(30);
      const stats = runtime.getObservationStats();
      assert.ok(stats);
      assert.equal(calls, 1);
      assert.equal(stats.disabled, true);
      assert.equal(stats.inFlight, true);
      assert.ok(stats.retainedBytes <= 2048);
      assert.ok(stats.dropped > 0);
      assert.equal(stats.queued, 0);
    },
    {
      observation: {
        sink: () => {
          calls++;
          return new Promise<void>(() => {});
        },
        maxPendingEvents: 2,
        maxPendingBytes: 2048,
        maxToolsPerTurn: 2,
        sinkTimeoutMs: 10,
      },
    },
  );
});
