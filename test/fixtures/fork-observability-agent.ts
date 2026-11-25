import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

// Scripted local ACP v1 only: no model, network, auth, native CLI or real work.
type Request = {
  id?: number | string;
  method?: string;
  params?: { sessionId?: string; cwd?: string };
};
const [root, scenario, profile] = process.argv.slice(2);
const sessionId = "PRIVATE_NATIVE_SESSION";
const secret = "SYNTHETIC_OBSERVABILITY_SECRET_73c0";
const input = readline.createInterface({ input: process.stdin });
let pending: Request | undefined;
let polls: ReturnType<typeof setInterval> | undefined;
let turn = 0;
let received = 0;
function send(value: object) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...value })}\n`);
}
function update(value: object, session = sessionId) {
  send({ method: "session/update", params: { sessionId: session, update: value } });
}
function tool(id: string, status = "in_progress", session = sessionId) {
  update(
    {
      sessionUpdate: "tool_call",
      toolCallId: id,
      title: secret,
      status,
      kind: "other",
      rawInput: { token: secret },
    },
    session,
  );
}
function finish(request: Request) {
  send({
    id: request.id,
    result: { stopReason: "end_turn", _meta: { nativeOutcome: "success", trusted: true, secret } },
  });
}
function hold(request: Request) {
  pending = request;
  polls = setInterval(() => {
    if (pending && fs.existsSync(path.join(root, "release"))) {
      finish(pending);
      pending = undefined;
      clearInterval(polls);
    }
  }, 5);
}
async function prompt(request: Request) {
  turn++;
  switch (scenario) {
    case "eof":
      fs.writeFileSync(path.join(root, "effect"), "one synthetic effect");
      process.exit(0);
      break;
    case "rpc-error":
      send({ id: request.id, error: { code: -32603, message: secret, data: { secret } } });
      break;
    case "hold":
      tool("PRIVATE_TOOL_REUSED");
      hold(request);
      break;
    case "flood":
      for (let i = 0; i < 60; i++) {
        tool(`PRIVATE_TOOL_${i}`);
        update({
          sessionUpdate: "tool_call_update",
          toolCallId: `PRIVATE_TOOL_${i}`,
          status: "completed",
        });
        await delay(2);
      }
      finish(request);
      break;
    case "coverage":
      update({ sessionUpdate: "tool_call_update", toolCallId: "PRIVATE_ORPHAN" });
      tool("x".repeat(5000));
      tool("PRIVATE_OVER_LIMIT");
      finish(request);
      break;
    case "correlation":
      tool("PRIVATE_WRONG_SESSION", "completed", "wrong-session");
      tool("PRIVATE_TOOL_REUSED");
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "PRIVATE_TOOL_REUSED",
        status: "completed",
        _meta: { turnId: "old-turn", requestId: "wrong-request", trusted: true },
      });
      finish(request);
      await delay(20);
      tool(`PRIVATE_LATE_TURN_${turn}`);
      break;
    default:
      process.stderr.write(`${secret}\n`);
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: secret } });
      update({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: secret },
        _meta: { source: secret },
      });
      tool("PRIVATE_TOOL_REUSED", "pending");
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "PRIVATE_TOOL_REUSED",
        status: "in_progress",
        rawInput: { authorization: secret },
      });
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "PRIVATE_TOOL_REUSED",
        rawOutput: { secret, text: secret.repeat(2000) },
        content: [{ type: "content", content: { type: "text", text: secret } }],
        _meta: { token: secret, nativeOutcome: "failure", turnId: secret },
      });
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "PRIVATE_TOOL_REUSED",
        status: "failed",
        rawOutput: { password: secret },
        locations: [{ path: `/private/${secret}` }],
      });
      finish(request);
  }
}
try {
  for await (const line of input) {
    const request = JSON.parse(line) as Request;
    if (++received > 64) {
      throw new Error("synthetic receipt bound");
    }
    fs.appendFileSync(
      path.join(root, "receipts.ndjson"),
      `${JSON.stringify({ method: request.method, id: request.id, sessionId: request.params?.sessionId })}\n`,
    );
    switch (request.method) {
      case "initialize":
        send({
          id: request.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: { loadSession: profile !== "basic" },
            authMethods: [],
          },
        });
        break;
      case "session/new":
        send({ id: request.id, result: { sessionId } });
        if (scenario === "correlation") {
          tool("PRIVATE_BEFORE_DISPATCH");
        }
        break;
      case "session/load":
        send({ id: request.id, result: {} });
        break;
      case "session/prompt":
        await prompt(request);
        break;
      case "session/cancel":
        // Intentionally ignored. A write cannot certify native cancellation.
        break;
      default:
        if (request.id !== undefined) {
          send({ id: request.id, error: { code: -32601, message: "unsupported fixture method" } });
        }
    }
  }
} finally {
  clearInterval(polls);
}
