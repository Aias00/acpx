import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Origin-only. The controller launches this inside an OS sandbox with a clean
// environment. Import the extracted candidate, never an installed live acpx.
const scratch = process.argv[2];
const config = JSON.parse(await fs.readFile(path.join(scratch, "driver-config.json"), "utf8"));
const { createAcpRuntime, createAgentRegistry, createFileSessionStore } = await import(
  pathToFileURL(path.join(scratch, "installed/package/dist/runtime.js")).href
);
const work = path.join(scratch, "work");
const cli = path.join(scratch, "installed/package/dist/cli.js");
const cliResult = spawnSync(process.execPath, [cli, "--version"], {
  cwd: work,
  env: process.env,
  encoding: "utf8",
  timeout: 10000,
  maxBuffer: 4096,
});
assert.equal(cliResult.status, 0, "candidate CLI --version failed");
assert.equal(cliResult.stdout.trim(), "0.22.0");
const report = {
  schemaVersion: 1,
  qualified: false,
  promptAdmissions: 0,
  cli: { argv: [process.execPath, cli, "--version"], version: cliResult.stdout.trim() },
  turns: [],
  wire: [],
  processes: [],
  nativeSessions: [],
};
let runtime;
const save = () => fs.writeFile(path.join(scratch, "driver-receipt.json"), JSON.stringify(report));
const watchdog = setTimeout(() => {
  // No retry or reconstruction on timeout. The controller performs identity-checked cleanup.
  report.failure = "active_time_limit";
  void save().finally(() => process.exit(1));
}, 150000);

function createRuntime() {
  return createAcpRuntime({
    cwd: work,
    sessionStore: createFileSessionStore({ stateDir: path.join(scratch, "client-state") }),
    agentRegistry: createAgentRegistry({
      overrides: { pi: [process.execPath, config.adapter] },
    }),
    permissionMode: "approve-all",
    fs: false,
    terminal: false,
    agentProcessEnvAllow: [],
    agentProcessEnv: { ...process.env },
    timeoutMs: 45000,
    observation: { maxEventsPerTurn: 32, sink: () => {} },
    processLifecycle: {
      onSpawned: async ({ pid }) => {
        report.processes.push({ pid, event: "spawned" });
        await save();
      },
      onExit: ({ pid }) => {
        report.processes.push({ pid, event: "exit" });
      },
    },
    onAcpMessage(direction, message) {
      if (
        direction === "outbound" &&
        ["session/new", "session/load", "session/prompt"].includes(message.method)
      ) {
        report.wire.push({
          method: message.method,
          id: message.id,
          sessionId: message.params?.sessionId,
        });
      }
    },
  });
}

async function runPrompt(handle, phase) {
  assert.ok(report.promptAdmissions < 2, "ACP admission budget exhausted");
  report.promptAdmissions++;
  await save(); // Record admission before dispatch, including ambiguous failures.
  const turn = runtime.startTurn({
    handle,
    mode: "prompt",
    requestId: `fork-smoke-${phase}`,
    text: `fork-smoke-${phase}:${config.nonce}`,
    assurance: true,
  });
  const tools = new Map();
  let text = "";
  const consume = (async () => {
    for await (const event of turn.events) {
      if (event.type === "text_delta") {
        text += event.text;
      }
      if (event.type === "tool_call" && event.toolCallId) {
        tools.set(event.toolCallId, event.status);
      }
    }
  })();
  const result = await turn.result;
  const receipt = await turn.assurance;
  await consume;
  report.turns.push({ phase, result, receipt, tools: [...tools] });
  await save();
  assert.equal(result.status, "completed");
  assert.equal(receipt.delivery, "finished");
  assert.equal(receipt.backendOutcome, "unknown");
  assert.equal(receipt.businessValidation, "unknown");
  assert.equal(text, `fork-smoke-${phase}-ack:${config.nonce}`);
  assert.ok(tools.size > 0 && [...tools.values()].every((status) => status === "completed"));
  assert.equal(await fs.readFile(path.join(work, "effect.txt"), "utf8"), config.nonce + "\n");
  return receipt.identity.backendSessionId;
}

async function nativeSession(id) {
  const map = JSON.parse(
    await fs.readFile(path.join(scratch, "home/.pi/pi-acp/session-map.json"), "utf8"),
  );
  const entry = map.sessions[id];
  assert.equal(entry?.sessionId, id);
  assert.equal(entry.cwd, work);
  const real = await fs.realpath(entry.sessionFile);
  assert.ok(real.startsWith(path.join(scratch, "sessions") + path.sep));
  const header = JSON.parse((await fs.readFile(real, "utf8")).split("\n")[0]);
  assert.equal(header.type, "session");
  assert.equal(header.id, id);
  report.nativeSessions.push({ acpSessionId: id, nativeSessionId: header.id, file: real });
  return real;
}

try {
  runtime = createRuntime();
  let handle = await runtime.ensureSession({
    sessionKey: "fork-pi-smoke",
    agent: "pi",
    mode: "persistent",
  });
  const id = await runPrompt(handle, "one");
  assert.ok(id);
  const firstFile = await nativeSession(id);
  await runtime.shutdown();
  runtime = createRuntime();
  handle = await runtime.ensureSession({
    sessionKey: "fork-pi-smoke",
    agent: "pi",
    mode: "persistent",
    resumeSessionId: id,
  });
  assert.equal(await runPrompt(handle, "two"), id);
  assert.equal(await nativeSession(id), firstFile);
  assert.equal(report.wire.filter((event) => event.method === "session/new").length, 1);
  assert.ok(report.wire.some((event) => event.method === "session/load" && event.sessionId === id));
  assert.equal(report.wire.filter((event) => event.method === "session/prompt").length, 2);
  report.qualified = true;
} catch {
  report.failure = "driver_assertion_or_runtime_failure"; // No raw stderr, prose classification or credentials.
  process.exitCode = 1;
} finally {
  try {
    await runtime?.shutdown();
    report.runtimeShutdownSettled = true;
  } catch {
    report.runtimeShutdownSettled = false;
    report.qualified = false;
    process.exitCode = 1;
  }
  await save();
  clearTimeout(watchdog);
}
