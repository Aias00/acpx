import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

// Synthetic ACP peer only. No model, network, native agent or inherited auth.
// The bounded trace stores method/identity receipts, never prompt or tool bodies.
type Message = {
  id?: string | number;
  method?: string;
  params?: { sessionId?: string; cwd?: string; protocolVersion?: number };
};

const root = process.argv[2];
const scenario = process.argv[3];
const sessionId = "fork-audit-session";
let traced = 0;
let pending: Message | undefined;
let releaseTimer: ReturnType<typeof setInterval> | undefined;

function trace(message: Message): void {
  if (traced++ >= 64) {
    throw new Error("Fixture receipt limit exceeded");
  }
  fs.appendFileSync(
    path.join(root, "receipts.ndjson"),
    `${JSON.stringify({
      method: message.method,
      id: message.id,
      sessionId: message.params?.sessionId,
      projectMatches: message.params?.cwd === undefined ? undefined : message.params.cwd === root,
      protocolVersion: message.params?.protocolVersion,
    })}\n`,
  );
}

function send(message: object): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function finish(message: Message, stopReason = "end_turn"): void {
  send({ id: message.id, result: { stopReason } });
}

function update(value: object): void {
  send({ method: "session/update", params: { sessionId, update: value } });
}

function hold(message: Message): void {
  pending = message;
  releaseTimer = setInterval(() => {
    if (fs.existsSync(path.join(root, "release")) && pending) {
      finish(pending);
      pending = undefined;
      clearInterval(releaseTimer);
    }
  }, 10);
}

function prompt(message: Message): void {
  switch (scenario) {
    case "eof":
      // A durable fixture effect proves dispatch, not receipt by any business system.
      fs.writeFileSync(path.join(root, "effect"), "one synthetic effect");
      process.exit(0);
      break;
    case "rpc-error":
      send({ id: message.id, error: { code: -32603, message: "Synthetic peer failure" } });
      // A duplicate later success must not replace an already settled RPC error.
      finish(message);
      break;
    case "untrusted-meta":
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "ERROR: fixture prose is not an outcome receipt" },
      });
      send({
        id: message.id,
        result: { stopReason: "end_turn", _meta: { nativeOutcome: "failed", trusted: true } },
      });
      break;
    case "rich-events":
      update({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "SYNTHETIC_PRIVATE_THOUGHT" },
      });
      update({
        sessionUpdate: "tool_call",
        toolCallId: "fixture-tool-1",
        title: "Synthetic tool",
        kind: "other",
        status: "in_progress",
        rawInput: { token: "SYNTHETIC_PRIVATE_ARGUMENT" },
      });
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "fixture-tool-1",
        status: "completed",
        rawOutput: { text: "SYNTHETIC_PRIVATE_OUTPUT" },
      });
      finish(message);
      break;
    case "cancel-ignored":
    case "cancel-ack":
    case "hold":
      hold(message);
      break;
    default:
      finish(message);
  }
}

try {
  for await (const line of readline.createInterface({ input: process.stdin })) {
    const message = JSON.parse(line) as Message;
    trace(message);
    switch (message.method) {
      case "initialize":
        send({
          id: message.id,
          result: {
            protocolVersion: scenario === "incompatible-version" ? 2 : 1,
            agentCapabilities: { loadSession: true },
            authMethods: [],
          },
        });
        break;
      case "session/new":
        send({ id: message.id, result: { sessionId } });
        break;
      case "session/load":
        if (fs.existsSync(path.join(root, "reject-load"))) {
          send({ id: message.id, error: { code: -32603, message: "Synthetic load failure" } });
        } else if (message.params?.sessionId !== sessionId) {
          send({ id: message.id, error: { code: -32002, message: "Unknown fixture session" } });
        } else {
          send({ id: message.id, result: {} });
        }
        break;
      case "session/prompt":
        prompt(message);
        break;
      case "session/cancel":
        if (scenario === "cancel-ack" && pending) {
          finish(pending, "cancelled");
          pending = undefined;
          clearInterval(releaseTimer);
        }
        break;
      default:
        if (message.id !== undefined) {
          send({ id: message.id, error: { code: -32601, message: "Unsupported fixture method" } });
        }
    }
  }
} finally {
  clearInterval(releaseTimer);
}
