import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

// Local synthetic stdio only. No network, model, auth or native CLI.
type Message = {
  id?: string | number;
  method?: string;
  params?: { sessionId?: string; cwd?: string };
};
const root = process.argv[2];
const scenario = process.argv[3];
const profile = process.argv[4];
const sessionId = "reliability-session";
const lines = readline.createInterface({ input: process.stdin });
let pending: Message | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let receipts = 0;

function send(value: object) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...value })}\n`);
}
function finish(message: Message, stopReason = "end_turn") {
  send({ id: message.id, result: { stopReason } });
}
function update(value: object) {
  send({ method: "session/update", params: { sessionId, update: value } });
}
function hold(message: Message) {
  pending = message;
  timer = setInterval(() => {
    if (pending && fs.existsSync(path.join(root, "release"))) {
      finish(pending);
      pending = undefined;
      clearInterval(timer);
    }
  }, 10);
}
function prompt(message: Message) {
  switch (scenario) {
    case "eof":
      fs.writeFileSync(path.join(root, "effect"), "one effect");
      process.exit(0);
      break;
    case "rpc-error":
      send({ id: message.id, error: { code: -32603, message: "Synthetic error" } });
      finish(message);
      break;
    case "untrusted":
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "ERROR success failed SYNTHETIC_SECRET" },
      });
      send({
        id: message.id,
        result: { stopReason: "end_turn", _meta: { trusted: true, nativeOutcome: "success" } },
      });
      break;
    case "tools":
    case "flood": {
      update({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "SYNTHETIC_SECRET" },
      });
      const count = scenario === "flood" ? 100 : 1;
      for (let i = 0; i < count; i++) {
        const toolCallId = `PRIVATE_TOOL_${i}`;
        update({
          sessionUpdate: "tool_call",
          toolCallId,
          title: "PRIVATE_PATH",
          status: "in_progress",
          kind: "other",
          rawInput: { key: "SYNTHETIC_SECRET" },
        });
        update({
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "completed",
          rawOutput: { text: "SYNTHETIC_SECRET" },
        });
      }
      finish(message);
      break;
    }
    case "hold":
    case "cancel-ack":
    case "cancel-ignored":
    case "cancel-late-updates":
      hold(message);
      break;
    default:
      finish(message);
  }
}
try {
  for await (const line of lines) {
    const message = JSON.parse(line) as Message;
    if (++receipts > 128) {
      throw new Error("Fixture receipt limit");
    }
    fs.appendFileSync(
      path.join(root, "receipts.ndjson"),
      `${JSON.stringify({ method: message.method, id: message.id, sessionId: message.params?.sessionId, projectMatches: message.params?.cwd === root })}\n`,
    );
    switch (message.method) {
      case "initialize":
        send({
          id: message.id,
          result: {
            protocolVersion: scenario === "incompatible" ? 2 : 1,
            agentCapabilities: profile === "basic" ? { loadSession: false } : { loadSession: true },
            authMethods:
              scenario === "incompatible" ? [{ id: "never-authenticate", name: "Synthetic" }] : [],
          },
        });
        break;
      case "session/new":
        send({ id: message.id, result: { sessionId } });
        if (scenario === "blocked") {
          lines.pause();
          process.stdin.pause();
          timer = setInterval(() => {}, 1000);
        }
        break;
      case "session/load":
        if (profile === "basic" || fs.existsSync(path.join(root, "reject-load"))) {
          send({ id: message.id, error: { code: -32603, message: "Synthetic load refusal" } });
        } else if (message.params?.sessionId !== sessionId) {
          send({ id: message.id, error: { code: -32002, message: "Unknown synthetic session" } });
        } else {
          send({ id: message.id, result: {} });
        }
        break;
      case "session/prompt":
        prompt(message);
        break;
      case "session/cancel":
        if ((scenario === "cancel-ack" || scenario === "cancel-late-updates") && pending) {
          finish(pending, "cancelled");
          pending = undefined;
          clearInterval(timer);
          if (scenario === "cancel-late-updates") {
            for (let i = 0; i < 20; i++) {
              update({
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: `late-${i}` },
              });
            }
          }
        }
        break;
      default:
        if (message.id !== undefined) {
          send({
            id: message.id,
            error: { code: -32601, message: "Unsupported synthetic method" },
          });
        }
    }
  }
} finally {
  clearInterval(timer);
}
