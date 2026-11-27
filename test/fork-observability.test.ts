import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { AcpRuntimeEvent } from "../src/runtime.js";
import { TurnEvidence } from "../src/runtime/assurance.js";
import { input, observedFixture, secret, settled, waitFor } from "./fork-observability-helpers.js";

test("fork assurance: phase timing uses the first observations and the settled snapshot", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const evidence = new TurnEvidence({ requestId: "request", turnId: "turn" });
  const owner = { sessionId: "session", requestId: 1 };

  assert.equal(Object.hasOwn(evidence.snapshot(), "timingMs"), false);
  evidence.observe({ type: "dispatching", ...owner });
  now = 2;
  evidence.observe({ type: "dispatching", ...owner });
  evidence.observe({ type: "cancel_written" });
  now = 4;
  evidence.observe({ type: "cancel_written" });
  now = 6.75;
  evidence.observe({ type: "response", ...owner, errorCode: -32603 });
  evidence.stopReason("cancelled");
  now = 10;
  evidence.observe({ type: "response", ...owner });
  evidence.stopReason("cancelled");

  assert.deepEqual(evidence.snapshot().timingMs, {
    dispatchToResponse: 6,
    cancelWriteToAcknowledgement: 4,
  });
  const receipt = evidence.snapshot({ status: "cancelled" });
  assert.equal(receipt.transport, "rpc_error");
  assert.deepEqual(receipt.timingMs, {
    dispatchToResponse: 6,
    cancelWriteToAcknowledgement: 4,
    responseToSettlement: 3,
  });
});

test("fork assurance: late observations cannot supply phase starts at the same clock tick", (t) => {
  t.mock.method(performance, "now", () => 0);
  const evidence = new TurnEvidence({ requestId: "request", turnId: "turn" });
  const owner = { sessionId: "session", requestId: 1 };
  evidence.observe({ type: "response", ...owner });
  evidence.observe({ type: "dispatching", ...owner });
  evidence.observe({ type: "response", ...owner });
  evidence.stopReason("cancelled");
  evidence.observe({ type: "cancel_written" });
  evidence.stopReason("cancelled");

  assert.equal(Object.hasOwn(evidence.snapshot(), "timingMs"), false);
  assert.deepEqual(evidence.snapshot({ status: "cancelled" }).timingMs, {
    responseToSettlement: 0,
  });
});

test("fork observation: opt-in is independent of assurance and rich events", async () => {
  await observedFixture(
    "normal",
    async (f) => {
      assert.equal(f.runtime.getObservationStats(), undefined);
      const turn = f.runtime.startTurn({ ...input, handle: await f.ensure() });
      const rich: AcpRuntimeEvent[] = [];
      const consume = (async () => {
        for await (const event of turn.events) {
          rich.push(event);
        }
      })();
      assert.equal((await turn.result).status, "completed");
      await consume;
      assert.equal(f.runtime.getObservationStats(), undefined);
      assert.equal(f.events.length, 0);
      assert.ok(JSON.stringify(rich).includes(secret));
    },
    { observation: undefined },
  );
});

for (const profile of ["resumable", "basic"]) {
  test(`fork observation: ${profile} uses the public runtime with truthful lifecycle and unknown outcomes`, async () => {
    await observedFixture(
      "normal",
      async (f) => {
        const handle = await f.ensure();
        assert.equal(
          (await f.runtime.getCapabilityEvidence({ handle })).peer.loadSession,
          profile === "basic" ? "unsupported" : "advertised",
        );
        const turn = f.runtime.startTurn({ ...input, assurance: false, handle });
        assert.equal(turn.assurance, undefined);
        assert.deepEqual(await turn.result, {
          status: "completed",
          stopReason: "end_turn",
          _meta: { nativeOutcome: "success", trusted: true, secret },
        });
        const end = await settled(f);
        assert.deepEqual(
          f.events.filter((event) => event.type !== "tool").map((event) => event.type),
          [
            "turn_started",
            "prompt_dispatching",
            "prompt_submitted",
            "prompt_response",
            "turn_settled",
          ],
        );
        assert.equal(end.delivery, "finished");
        assert.equal(end.transport, "response");
        assert.equal(end.turnStatus, "completed");
        assert.equal(end.failureCategory, "none");
        assert.equal(end.backendOutcome, "unknown");
        assert.equal(end.businessValidation, "unknown");
        assert.ok(end.durationMs! >= 0);
        assert.ok(end.timingMs);
        assert.deepEqual(Object.keys(end.timingMs).toSorted(), [
          "dispatchToResponse",
          "responseToSettlement",
        ]);
        assert.ok(
          Object.values(end.timingMs).every(
            (ms) => typeof ms === "number" && Number.isSafeInteger(ms) && ms >= 0,
          ),
        );
        assert.ok(Object.isFrozen(end.timingMs));
        assert.ok(f.events.every((event) => event === end || !Object.hasOwn(event, "timingMs")));
        assert.ok(
          f.events.every(
            (event, i) =>
              event.coverage === "partial" &&
              Object.isFrozen(event) &&
              (i === 0 ||
                (event.sequence > f.events[i - 1].sequence &&
                  event.monotonicMs >= f.events[i - 1].monotonicMs)),
          ),
        );
        const actual = (await f.rows()).find((row) => row.method === "session/prompt");
        assert.equal(actual?.sessionId, handle.backendSessionId);
        assert.ok(end.backendSessionId && end.rpcRequestId);
        assert.equal(end.sessionId, f.events[0].sessionId);
        assert.notEqual(end.backendSessionId, handle.backendSessionId);
        assert.equal(f.runtime.getObservationStats()?.dropped, 0);
      },
      {},
      profile,
    );
  });
}

test("fork observation: one tool call keeps identity/status across multiple partial updates", async () => {
  await observedFixture("normal", async (f) => {
    const turn = f.runtime.startTurn({ ...input, handle: await f.ensure() });
    await turn.result;
    const end = await settled(f);
    const tools = f.events.filter((event) => event.type === "tool");
    const receipt = await turn.assurance;
    assert.ok(receipt?.observationIdentity);
    for (const [key, alias] of Object.entries(receipt.observationIdentity)) {
      assert.equal(end[key as keyof typeof receipt.observationIdentity], alias);
    }
    assert.equal(receipt.identity.requestId, input.requestId);
    assert.equal(
      receipt.identity.rpcRequestId,
      (await f.rows()).find((row) => row.method === "session/prompt")?.id,
    );
    receipt.observationIdentity.turnId = "caller snapshot mutation";
    assert.equal((await turn.getAssurance?.())?.observationIdentity?.turnId, end.turnId);
    assert.equal(tools.length, 4);
    assert.equal(new Set(tools.map((event) => event.toolId)).size, 1);
    assert.deepEqual(
      tools.map((event) => event.toolStatus),
      ["pending", "in_progress", "in_progress", "failed"],
    );
    assert.deepEqual(
      tools.map((event) => event.toolPhase),
      ["call", "update", "update", "update"],
    );
    assert.ok(
      tools.every(
        (event) =>
          event.toolCalls === 1 &&
          event.toolCoverage === "from_call" &&
          event.toolCorrelation === "active_session_window" &&
          event.source === "acp_peer" &&
          event.toolDurationMs! >= 0,
      ),
    );
    assert.equal(end.toolCalls, 1);
    // A peer-reported tool failure is not a transport error or business verdict.
    assert.equal(end.turnStatus, "completed");
    assert.equal(end.businessValidation, "unknown");
  });
});

test("fork observation: privacy allowlist excludes malicious payloads/secrets and preserves rich events", async () => {
  await observedFixture("normal", async (f) => {
    const turn = f.runtime.startTurn({ ...input, handle: await f.ensure() });
    const rich: AcpRuntimeEvent[] = [];
    const consume = (async () => {
      for await (const event of turn.events) {
        rich.push(event);
      }
    })();
    await turn.result;
    await consume;
    await settled(f);
    assert.ok(JSON.stringify(rich).includes(secret));
    assert.ok(rich.some((event) => event.type === "text_delta" && event.stream === "thought"));
    assert.ok(rich.some((event) => event.type === "tool_call" && event.rawOutput));
    const safe = JSON.stringify(f.events);
    for (const excluded of [
      secret,
      input.requestId,
      "PRIVATE_SESSION",
      "PRIVATE_NATIVE_SESSION",
      "PRIVATE_TOOL",
      "rawInput",
      "rawOutput",
      "_meta",
      "authorization",
      "password",
      "/private/",
      f.root,
    ]) {
      assert.equal(safe.includes(excluded), false, excluded);
    }
    assert.ok(f.events.every((event) => Buffer.byteLength(JSON.stringify(event)) <= 2048));
  });
});

test("fork observation: wrong-session and pre/post-turn updates do not acquire current tool identity", async () => {
  let idleUpdateObserved = false;
  await observedFixture(
    "correlation",
    async (f) => {
      const handle = await f.ensure();
      await waitFor(() => idleUpdateObserved, "idle pre-dispatch fixture update");
      const first = f.runtime.startTurn({ ...input, handle });
      await first.result;
      const firstEnd = await settled(f);
      assert.equal(firstEnd.ignoredUpdates, 2); // wrong session and post-response update
      const firstTools = f.events.filter((event) => event.type === "tool");
      assert.equal(firstTools.length, 2);
      assert.equal(firstTools[0].toolId, firstTools[1].toolId);
      // Forged _meta turn/request IDs cannot manufacture native correlation.
      assert.ok(
        firstTools.every(
          (event) =>
            event.toolCorrelation === "active_session_window" && event.coverage === "partial",
        ),
      );
      const second = f.runtime.startTurn({ ...input, handle });
      await second.result;
      await waitFor(
        () => f.events.filter((event) => event.type === "turn_settled").length === 2,
        "two settled turns",
      );
      const secondEnd = f.events.findLast((event) => event.type === "turn_settled")!;
      const nextTools = f.events.filter(
        (event) => event.type === "tool" && event.turnId === secondEnd.turnId,
      );
      assert.equal(nextTools.length, 2);
      assert.equal(firstEnd.sessionId, secondEnd.sessionId);
      assert.equal(firstEnd.backendSessionId, secondEnd.backendSessionId);
      assert.equal(firstEnd.requestId, secondEnd.requestId); // caller reused it
      assert.notEqual(firstEnd.turnId, secondEnd.turnId);
      assert.notEqual(firstEnd.rpcRequestId, secondEnd.rpcRequestId);
      assert.notEqual(firstTools[0].toolId, nextTools[0].toolId);
      assert.equal(secondEnd.toolCalls, 1);
    },
    {
      onAcpMessage: (direction, message) => {
        if (direction === "inbound" && "method" in message && message.method === "session/update") {
          const params = message.params as { update?: { toolCallId?: string } };
          if (params.update?.toolCallId === "PRIVATE_BEFORE_DISPATCH") {
            idleUpdateObserved = true;
          }
        }
      },
    },
  );
});

test("fork observation: update-only and oversized/over-limit tool IDs mark incomplete tracking", async () => {
  await observedFixture(
    "coverage",
    async (f) => {
      await f.runtime.startTurn({ ...input, handle: await f.ensure() }).result;
      const end = await settled(f);
      const tools = f.events.filter((event) => event.type === "tool");
      assert.equal(tools.length, 3);
      assert.equal(tools[0].toolCoverage, "update_only");
      assert.equal(tools[0].toolStatus, "unknown");
      assert.equal(tools[1].toolCoverage, "untracked");
      assert.equal(tools[1].toolId, undefined);
      assert.equal(tools[2].toolCoverage, "untracked");
      assert.equal(end.toolCalls, 1);
      assert.equal(end.trackingTruncated, true);
      assert.equal(end.coverage, "partial");
      assert.equal(end.dropped, 0); // incomplete identity != dropped telemetry
    },
    { observation: { maxToolsPerTurn: 1, sink: () => {} } },
  );
});

test("fork observation: total per-turn output stays bounded with a fast sink and reserves a summary", async () => {
  await observedFixture(
    "flood",
    async (f) => {
      const turn = f.runtime.startTurn({ ...input, handle: await f.ensure() });
      assert.equal((await turn.result).status, "completed");
      const end = await settled(f);
      assert.ok(f.events.length <= 8);
      assert.ok(end.dropped >= 100);
      assert.ok(end.sequence > f.events[f.events.length - 2].sequence + 1);
      assert.equal(end.trackingTruncated, true);
      assert.equal(end.toolCalls, 2);
      assert.ok(
        f.events.reduce((bytes, event) => bytes + Buffer.byteLength(JSON.stringify(event)), 0) <=
          8 * 2048,
      );
      assert.equal(end.coverage, "partial");
      assert.equal(f.runtime.getObservationStats()?.dropped, end.dropped);
    },
    { observation: { maxEventsPerTurn: 8, maxToolsPerTurn: 2, sink: () => {} } },
  );
});

test("fork observation: stalled sink has one call, bounded queue/bytes, timeout and no verdict change", async () => {
  let calls = 0;
  await observedFixture(
    "flood",
    async (f) => {
      const turn = f.runtime.startTurn({ ...input, handle: await f.ensure() });
      assert.equal((await turn.result).status, "completed");
      assert.equal((await turn.assurance)?.businessValidation, "unknown");
      await waitFor(() => f.runtime.getObservationStats()?.disabled === true, "sink disabled");
      const stats = f.runtime.getObservationStats()!;
      assert.equal(calls, 1);
      assert.equal(stats.inFlight, true);
      assert.equal(stats.queued, 0);
      assert.ok(stats.retainedBytes <= 1800);
      assert.ok(stats.dropped > 0);
      assert.equal(stats.sinkFailures, 1);
      assert.equal(stats.delivered, 0);
      await f.runtime.shutdown();
      assert.equal(f.runtime.getObservationStats()?.disabled, true);
      assert.equal(calls, 1);
    },
    {
      observation: {
        maxPendingEvents: 2,
        maxPendingBytes: 1800,
        sinkTimeoutMs: 30,
        sink: () => {
          calls++;
          return new Promise<void>(() => {});
        },
      },
    },
  );
});

for (const failure of ["throw", "reject"]) {
  test(`fork observation: ${failure} sink is disabled, counted, isolated from result and private diagnostics`, async () => {
    let calls = 0;
    await observedFixture(
      "normal",
      async (f) => {
        const turn = f.runtime.startTurn({ ...input, handle: await f.ensure() });
        assert.equal((await turn.result).status, "completed");
        const stats = f.runtime.getObservationStats()!;
        assert.equal(calls, 1);
        assert.equal(stats.sinkFailures, 1);
        assert.equal(stats.disabled, true);
        assert.equal(stats.inFlight, false);
        assert.equal(stats.retainedBytes, 0);
        assert.equal(stats.queued, 0);
        assert.ok(stats.dropped > 0);
        assert.equal(JSON.stringify(stats).includes(secret), false);
      },
      {
        observation: {
          sink: () => {
            calls++;
            if (failure === "throw") {
              throw new Error(secret);
            }
            return Promise.reject(new Error(secret));
          },
        },
      },
    );
  });
}

test("fork observation: a recovering slow sink stays ordered after queue overflow", async () => {
  let release: (() => void) | undefined;
  let active = 0;
  let maximum = 0;
  let count = 0;
  await observedFixture(
    "hold",
    async (f) => {
      const turn = f.runtime.startTurn({ ...input, handle: await f.ensure() });
      await turn.promptStarted;
      await waitFor(
        () => (f.runtime.getObservationStats()?.dropped ?? 0) > 0,
        "bounded queue overflow",
      );
      const stats = f.runtime.getObservationStats()!;
      assert.ok(stats.queued <= 1);
      assert.ok(stats.retainedBytes <= 3000);
      release!();
      await waitFor(() => f.runtime.getObservationStats()?.inFlight === false, "sink drain");
      await fs.writeFile(path.join(f.root, "release"), "synthetic release");
      assert.equal((await turn.result).status, "completed");
      const end = await settled(f);
      assert.ok(end.dropped > 0);
      assert.ok(f.events.every((event, i) => i === 0 || event.sequence > f.events[i - 1].sequence));
      assert.equal(maximum, 1);
      assert.equal(f.runtime.getObservationStats()?.disabled, false);
    },
    {
      observation: {
        maxPendingEvents: 2,
        maxPendingBytes: 3000,
        sinkTimeoutMs: 2000,
        sink: async () => {
          active++;
          maximum = Math.max(maximum, active);
          if (++count === 1) {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          active--;
        },
      },
    },
  );
});

for (const scenario of ["eof", "rpc-error", "before-dispatch"]) {
  test(`fork observation: ${scenario} preserves fixed failure category, delivery and no replay`, async () => {
    await observedFixture(scenario, async (f) => {
      const turn = f.runtime.startTurn({
        ...input,
        handle: await f.ensure(),
        ...(scenario === "before-dispatch"
          ? {
              assertActive: () => {
                throw new Error(secret);
              },
            }
          : {}),
      });
      void turn.promptStarted.catch(() => {});
      assert.equal((await turn.result).status, "failed");
      const end = await settled(f);
      assert.equal(
        end.failureCategory,
        scenario === "eof"
          ? "transport_or_client"
          : scenario === "rpc-error"
            ? "acp_error"
            : "before_dispatch",
      );
      assert.equal(
        end.delivery,
        scenario === "eof" ? "unknown" : scenario === "rpc-error" ? "failed" : "unsent",
      );
      assert.equal(end.backendOutcome, "unknown");
      assert.equal(end.businessValidation, "unknown");
      assert.equal(
        (await f.rows()).filter((row) => row.method === "session/prompt").length,
        scenario === "before-dispatch" ? 0 : 1,
      );
      if (scenario === "eof") {
        assert.equal(
          await fs.readFile(path.join(f.root, "effect"), "utf8"),
          "one synthetic effect",
        );
      }
      assert.equal(JSON.stringify(f.events).includes(secret), false);
    });
  });
}

test("fork observation: ignored cancellation reports intent and write without acknowledgement or native stop", async () => {
  await observedFixture("hold", async (f) => {
    const turn = f.runtime.startTurn({ ...input, handle: await f.ensure() });
    await turn.promptStarted;
    await turn.cancel({ timeoutMs: 1000 });
    await waitFor(
      () => f.events.some((event) => event.type === "cancellation_written"),
      "cancel notification write",
    );
    await fs.writeFile(path.join(f.root, "release"), "synthetic release");
    assert.equal((await turn.result).status, "completed");
    const end = await settled(f);
    assert.equal(end.cancelRequested, true);
    assert.equal(end.cancelWritten, true);
    assert.equal(end.cancelAcknowledged, false);
    assert.equal(end.nativeToolsStopped, "unknown");
    assert.ok(f.events.some((event) => event.type === "cancellation_requested"));
    const before = f.events.length;
    await turn.cancel();
    await delay(5);
    assert.equal(f.events.length, before); // settled owner cannot notify a later turn
  });
});

test("fork observation: shutdown does not wait for sink and late resolution cannot restart delivery", async () => {
  let release: (() => void) | undefined;
  let calls = 0;
  await observedFixture(
    "normal",
    async (f) => {
      await f.runtime.startTurn({ ...input, handle: await f.ensure() }).result;
      const began = performance.now();
      await f.runtime.shutdown();
      assert.ok(performance.now() - began < 2000);
      assert.equal(f.runtime.getObservationStats()?.disabled, true);
      assert.equal(f.runtime.getObservationStats()?.queued, 0);
      assert.ok((f.runtime.getObservationStats()?.dropped ?? 0) > 0);
      release!();
      await waitFor(
        () => f.runtime.getObservationStats()?.inFlight === false,
        "late sink resolved",
      );
      assert.equal(f.runtime.getObservationStats()?.retainedBytes, 0);
      assert.equal(calls, 1);
    },
    {
      observation: {
        sinkTimeoutMs: 5000,
        sink: () => {
          calls++;
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      },
    },
  );
});

test("fork observation: tiny byte limit drops even first record without affecting a turn", async () => {
  await observedFixture(
    "normal",
    async (f) => {
      assert.equal(
        (await f.runtime.startTurn({ ...input, handle: await f.ensure() }).result).status,
        "completed",
      );
      assert.equal(f.events.length, 0);
      const stats = f.runtime.getObservationStats()!;
      assert.equal(stats.retainedBytes, 0);
      assert.equal(stats.inFlight, false);
      assert.equal(stats.delivered, 0);
      assert.ok(stats.dropped >= 5);
      assert.equal(stats.disabled, false);
    },
    { observation: { maxPendingBytes: 1, sink: () => {} } },
  );
});

test("fork observation: finalization failure preserves finished transport with a failed turn", async () => {
  let rejectSaves = false;
  await observedFixture(
    "normal",
    async (f) => {
      const handle = await f.ensure();
      const save = f.store.save.bind(f.store);
      f.store.save = async (record) => {
        if (rejectSaves) {
          throw new Error(secret);
        }
        await save(record);
      };
      try {
        const turn = f.runtime.startTurn({ ...input, handle });
        assert.equal((await turn.result).status, "failed");
        const end = await settled(f);
        assert.equal(end.delivery, "finished");
        assert.equal(end.transport, "response");
        assert.equal(end.turnStatus, "failed");
        assert.equal(end.failureCategory, "client_finalization");
        assert.equal(JSON.stringify(f.events).includes(secret), false);
      } finally {
        rejectSaves = false;
        f.store.save = save;
      }
    },
    {
      onAcpMessage: (direction, message) => {
        if (direction === "inbound" && "result" in message) {
          const result = message.result as { stopReason?: string } | null;
          if (result?.stopReason) {
            rejectSaves = true;
          }
        }
      },
    },
  );
});

test("fork observation: timed-out sink late rejection is counted once and releases retained bytes", async () => {
  let rejectSink: ((error: Error) => void) | undefined;
  let calls = 0;
  await observedFixture(
    "normal",
    async (f) => {
      assert.equal(
        (await f.runtime.startTurn({ ...input, handle: await f.ensure() }).result).status,
        "completed",
      );
      assert.equal(f.runtime.getObservationStats()?.sinkFailures, 1);
      const dropped = f.runtime.getObservationStats()?.dropped;
      rejectSink!(new Error(secret));
      await waitFor(
        () => f.runtime.getObservationStats()?.inFlight === false,
        "late rejected sink",
      );
      assert.equal(f.runtime.getObservationStats()?.sinkFailures, 1);
      assert.equal(f.runtime.getObservationStats()?.dropped, dropped);
      assert.equal(f.runtime.getObservationStats()?.retainedBytes, 0);
      assert.equal(calls, 1);
    },
    {
      observation: {
        sinkTimeoutMs: 10,
        sink: () => {
          calls++;
          return new Promise<void>((_resolve, reject) => {
            rejectSink = reject;
          });
        },
      },
    },
  );
});

test("fork observation: nonfinite options use defaults and output minimum reserves settlement", async () => {
  await observedFixture(
    "normal",
    async (f) => {
      assert.equal(
        (await f.runtime.startTurn({ ...input, handle: await f.ensure() }).result).status,
        "completed",
      );
      const end = await settled(f);
      assert.deepEqual(
        f.events.map((event) => event.type),
        ["turn_started", "turn_settled"],
      );
      assert.equal(end.toolCalls, 1);
      assert.equal(end.trackingTruncated, false);
      assert.ok(end.dropped > 0);
    },
    {
      observation: {
        maxPendingEvents: Number.NaN,
        maxPendingBytes: Infinity,
        maxToolsPerTurn: Number.NaN,
        maxEventsPerTurn: -1,
        sinkTimeoutMs: Infinity,
        sink: () => {},
      },
    },
  );
});

test("fork observation: session aliases distinguish client records and runtime salts prevent cross-runtime joins", async () => {
  const aliases: Array<{ sessionId: string; requestId: string }> = [];
  for (let i = 0; i < 2; i++) {
    await observedFixture("normal", async (f) => {
      for (const key of ["PRIVATE_ONE", "PRIVATE_TWO"]) {
        const handle = await f.ensure(key);
        await f.runtime.startTurn({ ...input, handle }).result;
      }
      await waitFor(
        () => f.events.filter((event) => event.type === "turn_settled").length === 2,
        "two client records",
      );
      const ends = f.events.filter((event) => event.type === "turn_settled");
      assert.notEqual(ends[0].sessionId, ends[1].sessionId);
      assert.notEqual(ends[0].turnId, ends[1].turnId);
      assert.equal(ends[0].requestId, ends[1].requestId);
      // Both synthetic processes deliberately use the same native session string.
      assert.equal(ends[0].backendSessionId, ends[1].backendSessionId);
      aliases.push(ends[0]);
    });
  }
  assert.notEqual(aliases[0].requestId, aliases[1].requestId);
});
