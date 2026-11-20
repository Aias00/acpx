import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AcpClient } from "../../src/acp/client.js";
import { AsyncEventQueue } from "../../src/runtime/engine/turn.js";
import {
  collectForkAuditTurn,
  forkAuditPeer,
  readForkAuditReceipts,
  withForkAuditRuntime,
} from "../fork-audit-helpers.js";

// One-time baseline characterization, deliberately outside the regression suite.
// It reports observed gaps without making acceptance of a bug a test requirement.
const observations: Record<string, unknown> = {};
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "acpx-fork-handshake-"));
const root = await fs.realpath(directory);
const client = new AcpClient({
  cwd: root,
  agentCommand: process.execPath,
  agentArgv: [process.execPath, forkAuditPeer, root, "incompatible-version"],
  permissionMode: "deny-all",
  fs: false,
  terminal: false,
  agentProcessEnvAllow: [],
});
try {
  let accepted = false;
  let sessionCreated = false;
  try {
    await client.start({ signal: AbortSignal.timeout(3_000) });
    accepted = true;
    sessionCreated = (await client.createSession()).sessionId === "fork-audit-session";
  } catch {
    // A fixed client is expected to reject before session creation.
  }
  const receipts = await readForkAuditReceipts(root);
  observations.protocol = {
    offered: receipts.find((row) => row.method === "initialize")?.protocolVersion,
    peerReturned: 2,
    accepted,
    sessionCreated,
    storedProtocolVersion: client.initializeResult?.protocolVersion,
    methodsReceived: receipts.map((row) => row.method),
  };
} finally {
  await client.close();
  await fs.rm(root, { recursive: true, force: true });
}

let wireContainsPrompt = false;
let pendingSinkCalls = 0;
await withForkAuditRuntime(
  "rich-events",
  async ({ runtime, ensure, store }) => {
    const before = await runtime.getCapabilities();
    const handle = await ensure();
    const after = await runtime.getCapabilities({ handle });
    const record = await store.load(handle.acpxRecordId!);
    const { result, events } = await collectForkAuditTurn(
      runtime.startTurn({
        handle,
        text: "SYNTHETIC_PRIVATE_PROMPT",
        mode: "prompt",
        requestId: "audit-reproduction",
      }),
    );
    assert.equal(result.status, "completed");
    const tools = events.filter((event) => event.type === "tool_call");
    observations.capabilities = {
      beforeConnection: before,
      afterConnection: after,
      advertisedByFixture: record?.agentCapabilities,
      controlQualificationAttempted: false,
    };
    observations.observation = {
      wireContainsPrompt,
      richEventsContainThought: events.some(
        (event) => event.type === "text_delta" && event.text === "SYNTHETIC_PRIVATE_THOUGHT",
      ),
      richEventsContainRawInput: tools.some(
        (event) => JSON.stringify(event.rawInput) === '{"token":"SYNTHETIC_PRIVATE_ARGUMENT"}',
      ),
      richEventsContainRawOutput: tools.some(
        (event) => JSON.stringify(event.rawOutput) === '{"text":"SYNTHETIC_PRIVATE_OUTPUT"}',
      ),
      toolEvents: tools.length,
      uniqueToolIds: new Set(tools.map((event) => event.toolCallId)).size,
      pendingSinkCallsAtCompletedTurn: pendingSinkCalls,
      turnStatus: result.status,
    };
  },
  {
    onAcpMessage: (_direction, message) => {
      wireContainsPrompt ||= JSON.stringify(message).includes("SYNTHETIC_PRIVATE_PROMPT");
      pendingSinkCalls += 1;
      // An unresolved synthetic sink has no timers/resources. Runtime must not await it.
      return new Promise<void>(() => {});
    },
  },
);

const queue = new AsyncEventQueue();
for (let index = 0; index < 512; index += 1) {
  queue.push({ type: "text_delta", text: "synthetic" });
}
queue.close();
let retainedEvents = 0;
for await (const event of queue.iterate()) {
  assert.equal(event.type, "text_delta");
  retainedEvents += 1;
}
observations.unconsumedRichQueue = { producedEvents: 512, retainedEvents };

process.stdout.write(`${JSON.stringify(observations, null, 2)}\n`);
