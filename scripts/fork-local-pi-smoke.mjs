import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createScriptedModel } from "./fork-local-pi-model.mjs";

// Origin-only, foreground, no provider credentials, no package installation or
// live service changes. --plan inspects files only and never starts Pi.
const root = fileURLToPath(new URL("../", import.meta.url));
const local = path.join(root, ".local-verification");
const piRoot =
  "/Users/aias/.local/share/ctask-agent-clis/node_modules/@earendil-works/pi-coding-agent";
const adapterRoot = "/Volumes/data/.research/acp-route-validation-20261118/node_modules/pi-acp";
const pi = path.join(piRoot, "dist/bundle/cli.js");
const adapter = path.join(adapterRoot, "dist/index.js");
const driver = fileURLToPath(new URL("./fork-local-pi-driver.mjs", import.meta.url));
const hash = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quote = (text) => "'" + text.replaceAll("'", "'\\''") + "'";

async function plan() {
  assert.equal(process.version, "v24.22.1", "use the fixed Node installation");
  const piPackage = JSON.parse(await fs.readFile(path.join(piRoot, "package.json"), "utf8"));
  const adapterPackage = JSON.parse(
    await fs.readFile(path.join(adapterRoot, "package.json"), "utf8"),
  );
  assert.equal(piPackage.version, "1.5.2");
  assert.equal(adapterPackage.version, "0.0.34");
  assert.equal(await hash(pi), "e79626f2dd6f94aa45d30f3fa63cd84319a6eefcd150b353cfaf274366926774");
  assert.equal(
    await hash(adapter),
    "324aeb8bba1228937e16b1326fb3e014e2a625b2dea549dbcd49b006cd5df6a2",
  );
  assert.equal(
    await hash(path.join(piRoot, "dist/bundle/rpc-entry.js")),
    "790ab617fafc044f7c13922f838906e90cd75eb1c19c0889efce441804564550",
  );
  return {
    node: {
      path: process.execPath,
      version: process.version,
      sha256: await hash(process.execPath),
    },
    pi: {
      path: pi,
      version: piPackage.version,
      sha256: await hash(pi),
      rpcEntrySha256: await hash(path.join(piRoot, "dist/bundle/rpc-entry.js")),
    },
    adapter: { path: adapter, version: adapterPackage.version, sha256: await hash(adapter) },
    promptAdmissionLimit: 2,
    authorizationPromptLimit: 4,
    modelHttpLimit: 4,
    activeSecondsLimit: 180,
    realProviderCalled: false,
    nativeRun: false,
  };
}

// Only use rows for the fresh foreground driver's proven descendants. Do not
// persist the system process table or signal a PID without rechecking identity.
function processTable() {
  const result = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,lstart=,command="], {
    encoding: "utf8",
    timeout: 2000,
    maxBuffer: 4 * 1024 * 1024,
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
  });
  assert.equal(result.status, 0, "host process inspection is required");
  return result.stdout.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/);
    return match
      ? [{ pid: Number(match[1]), parent: Number(match[2]), start: match[3], command: match[4] }]
      : [];
  });
}

function rememberTree(pid, owned) {
  const table = processTable();
  const ids = new Set([pid]);
  for (let pass = 0; pass < table.length; pass++) {
    const oldSize = ids.size;
    for (const row of table) {
      if (ids.has(row.parent)) {
        ids.add(row.pid);
      }
    }
    if (ids.size === oldSize) {
      break;
    }
  }
  for (const row of table) {
    if (ids.has(row.pid)) {
      owned.set(row.pid, row);
    }
  }
}

function stillOwned(owned) {
  return processTable().filter((row) => {
    const saved = owned.get(row.pid);
    return saved && saved.start === row.start && saved.command === row.command;
  });
}

async function cleanupProcesses(owned) {
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    // Leaf-first; the identities come from observed ancestry, not a name match.
    const rows = stillOwned(owned).toReversed();
    for (const row of rows) {
      const fresh = stillOwned(new Map([[row.pid, row]]));
      if (fresh.length) {
        try {
          process.kill(row.pid, signal);
        } catch (error) {
          if (error.code !== "ESRCH") {
            throw error;
          }
        }
      }
    }
    if (!stillOwned(owned).length) {
      break;
    }
    await delay(300);
  }
  return stillOwned(owned).length === 0;
}

function acknowledgeNativeLaunches(scratch, owned) {
  const requests = path.join(scratch, "native-launch-requests.txt");
  if (!fsSync.existsSync(requests)) {
    return;
  }
  const raw = fsSync.readFileSync(requests, "utf8");
  const complete = raw.slice(0, raw.lastIndexOf("\n") + 1);
  const table = processTable();
  for (const line of complete.split("\n").filter(Boolean)) {
    const match = line.match(/^(\d+) (\d+) (rpc|version)$/);
    assert.ok(match, "invalid private native launch request");
    const pid = Number(match[1]);
    const parent = Number(match[2]);
    const ack = path.join(scratch, `native-launch-ack-${pid}`);
    if (fsSync.existsSync(ack)) {
      continue;
    }
    const row = table.find((entry) => entry.pid === pid && entry.parent === parent);
    // The wrapper waits before exec. Capture its birth identity on the trusted
    // host: macOS refuses setuid /bin/ps inside the child sandbox.
    assert.ok(row && owned.has(parent) && row.command.includes(path.join(scratch, "bin/pi")));
    owned.set(pid, row);
    fsSync.appendFileSync(
      path.join(scratch, "native-launches.txt"),
      `${pid} ${parent} ${row.start} ${match[3]}\n`,
      { mode: 0o600 },
    );
    fsSync.writeFileSync(ack, "host-identity-recorded\n", { mode: 0o600, flag: "wx" });
  }
}

async function rememberNativeLaunches(scratch, owned, driverReceipt) {
  const raw = await fs.readFile(path.join(scratch, "native-launches.txt"), "utf8").catch(() => "");
  const launches = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line
        .trim()
        .match(/^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+) (rpc|version)$/);
      assert.ok(match, "invalid private launcher identity record");
      return { pid: Number(match[1]), parent: Number(match[2]), start: match[3], role: match[4] };
    });
  const parents = new Set(
    driverReceipt?.processes
      ?.filter((event) => event.event === "spawned")
      .map((event) => event.pid),
  );
  const table = processTable();
  for (const launch of launches) {
    // The host records the waiting launcher's birth identity before exec. A fast
    // adapter crash cannot hide a surviving native child between poll ticks.
    assert.ok(parents.has(launch.parent) || owned.has(launch.parent));
    const row = table.find((entry) => entry.pid === launch.pid && entry.start === launch.start);
    if (row) {
      assert.ok(row.command.startsWith(process.execPath + " " + pi + " ") || owned.has(row.pid));
      owned.set(row.pid, row);
    }
  }
  return launches;
}

async function requestBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    assert.ok(Buffer.byteLength(body) <= 2 * 1024 * 1024, "model request too large");
  }
  return JSON.parse(body);
}

function serverFor(scratch, key, model, errors) {
  let requests = 0;
  return http.createServer((req, res) => {
    void (async () => {
      assert.ok(++requests <= 4, "model HTTP request budget exhausted");
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/v1/chat/completions");
      assert.equal(req.headers.authorization, `Bearer ${key}`);
      const body = await requestBody(req);
      const effect = await fs
        .readFile(path.join(scratch, "work/effect.txt"), "utf8")
        .catch(() => undefined);
      const response = model.respond(body, effect);
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.end(response);
    })().catch(() => {
      if (errors.length < 8) {
        errors.push("scripted_http_contract_failed");
      }
      res.writeHead(400);
      res.end("scripted fixture rejected request; do not retry");
    });
  });
}

function profile(scratch, port) {
  // Default deny prevents provider access even if a CLI ignores config. HOME,
  // XDG and Pi state are replaced; real credential/config directories are denied
  // reads as a second boundary. The fixed installations remain read-only.
  const denied = [".pi", ".codex", ".claude", ".config", ".aws", ".ssh", "Library/Keychains"];
  return [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow signal)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow file-read*)",
    `(allow file-write* (subpath ${JSON.stringify(scratch)}) (literal "/dev/null"))`,
    // Seatbelt's address grammar accepts localhost, not a numeric loopback
    // literal. The model listener and client URL still use 127.0.0.1 only.
    `(allow network-outbound (remote ip "localhost:${port}"))`,
    ...denied.map((name) => `(deny file-read* (subpath ${JSON.stringify("/Users/aias/" + name)}))`),
  ].join("\n");
}

async function prepare(scratch, metadata, port, nonce, key) {
  const candidate = JSON.parse(await fs.readFile(path.join(local, "candidate.json"), "utf8"));
  const artifact = await fs.realpath(candidate.artifact);
  assert.ok(artifact.startsWith(local + path.sep));
  assert.equal(await hash(artifact), candidate.sha256);
  const fingerprint = spawnSync(
    "/Volumes/data/.ctask-runtime/acp-process-live-20261119T022710Z/.venv/bin/python",
    ["/Volumes/data/.build-logs/acpx-fork-hardening-20261119/acceptance.py", "fingerprint"],
    { cwd: root, encoding: "utf8", timeout: 15000 },
  );
  assert.equal(fingerprint.status, 0);
  assert.equal(candidate.source_sha256, JSON.parse(fingerprint.stdout).source_sha256);
  for (const name of ["work", "home", "agent", "sessions", "bin", "tmp", "xdg", "installed"]) {
    await fs.mkdir(path.join(scratch, name), { mode: 0o700 });
  }
  const extracted = spawnSync(
    "/usr/bin/tar",
    ["-xzf", artifact, "-C", path.join(scratch, "installed")],
    { timeout: 10000 },
  );
  assert.equal(extracted.status, 0);
  // Candidate dependencies are already installed and locked. No download or
  // install scripts; use their read-only directory for this extracted package.
  await fs.symlink(
    path.join(root, "node_modules"),
    path.join(scratch, "installed/node_modules"),
    "dir",
  );
  await fs.writeFile(
    path.join(scratch, "agent/models.json"),
    JSON.stringify({
      providers: {
        "fork-loopback": {
          api: "openai-completions",
          apiKey: key,
          baseUrl: `http://127.0.0.1:${port}/v1`,
          models: [
            {
              id: "fork-loopback",
              name: "Scripted local fixture",
              reasoning: false,
              input: ["text"],
              contextWindow: 32768,
              maxTokens: 1024,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    }),
  );
  await fs.writeFile(
    path.join(scratch, "agent/settings.json"),
    JSON.stringify({
      defaultProvider: "fork-loopback",
      defaultModel: "fork-loopback",
      defaultThinkingLevel: "off",
      retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0, timeoutMs: 30000 } },
      compaction: { enabled: false },
      cacheWarming: { enabled: false },
    }),
  );
  const piArgs = [
    pi,
    "--offline",
    "--no-extensions",
    "--no-mcp",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-themes",
    "--tools",
    "read,write",
    "--provider",
    "fork-loopback",
    "--model",
    "fork-loopback",
    "--thinking",
    "off",
    "--session-dir",
    path.join(scratch, "sessions"),
  ];
  await fs.writeFile(
    path.join(scratch, "bin/pi"),
    '#!/bin/sh\nif [ "$#" -eq 1 ] && [ "$1" = "--version" ]; then\n  role=version\nelif [ "$1" = "--mode" ] && [ "$2" = "rpc" ] && [ "$3" = "--no-themes" ]; then\n  role=rpc\nelse\n  exit 1\nfi\nprintf \'%s %s %s\\n\' "$$" "$PPID" "$role" >> ' +
      quote(path.join(scratch, "native-launch-requests.txt")) +
      "\ntries=0\nwhile [ ! -f " +
      quote(path.join(scratch, "native-launch-ack-")) +
      '"$$" ]; do\n  tries=$((tries + 1))\n  [ "$tries" -lt 200 ] || exit 1\n  /bin/sleep 0.05\ndone\nexec ' +
      [process.execPath, ...piArgs].map(quote).join(" ") +
      ' "$@"\n',
    { mode: 0o700 },
  );
  await fs.writeFile(path.join(scratch, "driver-config.json"), JSON.stringify({ adapter, nonce }));
  const env = {
    PATH: path.join(scratch, "bin") + ":/usr/bin:/bin",
    HOME: path.join(scratch, "home"),
    TMPDIR: path.join(scratch, "tmp"),
    XDG_CONFIG_HOME: path.join(scratch, "xdg"),
    XDG_CACHE_HOME: path.join(scratch, "xdg"),
    XDG_DATA_HOME: path.join(scratch, "xdg"),
    PI_CODING_AGENT_DIR: path.join(scratch, "agent"),
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
    PI_ACP_PI_COMMAND: path.join(scratch, "bin/pi"),
    NO_PROXY: "127.0.0.1",
    no_proxy: "127.0.0.1",
    LC_ALL: "C",
    CI: "1",
  };
  metadata.candidate = candidate;
  metadata.pi.argv = [process.execPath, ...piArgs, "--mode", "rpc", "--no-themes"];
  return env;
}

async function run() {
  const metadata = await plan();
  assert.equal(process.platform, "darwin", "this fixed origin harness requires macOS sandbox-exec");
  await fs.access("/usr/bin/sandbox-exec");
  processTable(); // Fail before prompt admission when cleanup cannot be inspected.
  await fs.mkdir(local, { recursive: true });
  const scratch = await fs.realpath(await fs.mkdtemp(path.join(local, "pi-smoke-")));
  await fs.chmod(scratch, 0o700);
  const started = performance.now();
  const nonce = randomUUID();
  const key = "dummy-fork-" + randomUUID();
  const model = createScriptedModel(nonce);
  const errors = [];
  const server = serverFor(scratch, key, model, errors);
  const owned = new Map();
  let monitor;
  let child;
  let driverReceipt;
  let failure;
  let cleanup = false;
  let nativeLaunches = [];
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = server.address().port;
    const env = await prepare(scratch, metadata, port, nonce, key);
    const argv = ["-p", profile(scratch, port), process.execPath, driver, scratch];
    const preflight = spawnSync(
      "/usr/bin/sandbox-exec",
      ["-p", profile(scratch, port), process.execPath, "--eval", ""],
      { cwd: path.join(scratch, "work"), env, stdio: "ignore", timeout: 10000 },
    );
    metadata.sandboxProfilePreflight = { exitCode: preflight.status };
    assert.equal(preflight.status, 0, "sandbox profile preflight failed before native admission");
    metadata.driverArgv = ["/usr/bin/sandbox-exec", ...argv];
    metadata.nativeRun = true;
    child = spawn("/usr/bin/sandbox-exec", argv, {
      cwd: path.join(scratch, "work"),
      env,
      stdio: "ignore",
    });
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    rememberTree(child.pid, owned);
    monitor = setInterval(() => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      try {
        rememberTree(child.pid, owned);
        acknowledgeNativeLaunches(scratch, owned);
      } catch {
        if (errors.length < 8) {
          errors.push("process_inspection_failed");
        }
      }
    }, 250);
    const remaining = Math.max(1, 160000 - (performance.now() - started));
    let timer;
    const exit = await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("active_time_limit")), remaining);
      }),
    ]).finally(() => clearTimeout(timer));
    driverReceipt = JSON.parse(
      await fs.readFile(path.join(scratch, "driver-receipt.json"), "utf8"),
    );
    assert.equal(exit.code, 0);
    assert.equal(driverReceipt.qualified, true);
    assert.equal(driverReceipt.promptAdmissions, 2);
    assert.equal(model.trace.length, 4);
    assert.equal(errors.length, 0);
    assert.equal(await fs.readFile(path.join(scratch, "work/effect.txt"), "utf8"), nonce + "\n");
  } catch {
    failure = "local_smoke_failed_no_automatic_retry";
    driverReceipt ??= await fs
      .readFile(path.join(scratch, "driver-receipt.json"), "utf8")
      .then(JSON.parse)
      .catch(() => undefined);
  } finally {
    clearInterval(monitor);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    try {
      nativeLaunches = await rememberNativeLaunches(scratch, owned, driverReceipt);
      cleanup = await cleanupProcesses(owned);
    } catch {
      cleanup = false;
    }
  }
  const elapsedMs = performance.now() - started;
  const receipt = {
    schemaVersion: 1,
    qualified:
      !failure &&
      cleanup &&
      nativeLaunches.length === 4 &&
      nativeLaunches.filter((entry) => entry.role === "rpc").length === 2 &&
      nativeLaunches.filter((entry) => entry.role === "version").length === 2 &&
      elapsedMs <= 180000,
    source_sha256: metadata.candidate?.source_sha256,
    artifact_sha256: metadata.candidate?.sha256,
    promptAdmissions: driverReceipt?.promptAdmissions ?? 0,
    elapsedMs,
    realProviderCalled: false,
    liveRuntimeActivated: false,
    metadata,
    driver: driverReceipt,
    modelTrace: model.trace,
    nativeLaunches,
    errors,
    failure,
    cleanup: {
      ownedProcessesGone: cleanup,
      loopbackClosed: !server.listening,
      scratchRemoved: false,
    },
  };
  // Do not delete private state until all observed owned processes are gone.
  if (cleanup) {
    await fs.rm(scratch, { recursive: true, force: true });
    receipt.cleanup.scratchRemoved = true;
  } else {
    receipt.privateScratchForOriginCleanup = scratch;
  }
  const receiptFile = path.join(local, `pi-smoke-receipt-${nonce}.json`);
  await fs.writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  console.log(
    JSON.stringify({
      qualified: receipt.qualified,
      receipt: receiptFile,
      promptAdmissions: receipt.promptAdmissions,
    }),
  );
  if (!receipt.qualified) {
    process.exitCode = 1;
  }
}

if (process.argv[2] === "--plan") {
  console.log(JSON.stringify(await plan(), null, 2));
} else if (process.argv[2] === "--run") {
  await run();
} else {
  throw new Error(
    "origin only: use --plan for read-only inspection or --run for the bounded local smoke",
  );
}
