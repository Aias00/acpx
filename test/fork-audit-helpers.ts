import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  createAcpRuntime,
  createAgentRegistry,
  type AcpRuntimeOptions,
  type AcpRuntimeTurn,
} from "../src/runtime.js";
import { InMemorySessionStore } from "./runtime-test-helpers.js";

export const forkAuditPeer = fileURLToPath(
  new URL("./fixtures/fork-audit-agent.js", import.meta.url),
);

export type ForkAuditReceipt = {
  method: string;
  id?: string | number;
  sessionId?: string;
  projectMatches?: boolean;
  protocolVersion?: number;
};

export async function readForkAuditReceipts(root: string): Promise<ForkAuditReceipt[]> {
  const contents = await fs.readFile(path.join(root, "receipts.ndjson"), "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  });
  return contents.trim()
    ? contents
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
}

export async function waitForForkAuditMethod(root: string, method: string): Promise<void> {
  const deadline = performance.now() + 3_000;
  while (performance.now() < deadline) {
    if ((await readForkAuditReceipts(root)).some((row) => row.method === method)) {
      return;
    }
    await delay(10);
  }
  assert.fail(`Synthetic peer did not record ${method}`);
}

export async function withForkAuditRuntime(
  scenario: string,
  run: (fixture: {
    root: string;
    runtime: ReturnType<typeof createAcpRuntime>;
    store: InMemorySessionStore;
    ensure: () => ReturnType<ReturnType<typeof createAcpRuntime>["ensureSession"]>;
    receipts: () => Promise<ForkAuditReceipt[]>;
  }) => Promise<void>,
  overrides: Partial<AcpRuntimeOptions> = {},
): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "acpx-fork-audit-"));
  const root = await fs.realpath(directory);
  const store = new InMemorySessionStore();
  const runtime = createAcpRuntime({
    cwd: root,
    sessionStore: store,
    agentRegistry: createAgentRegistry({
      overrides: { fixture: [process.execPath, forkAuditPeer, root, scenario] },
    }),
    permissionMode: "deny-all",
    fs: false,
    terminal: false,
    agentProcessEnvAllow: [],
    timeoutMs: 3_000,
    ...overrides,
  });
  try {
    await run({
      root,
      runtime,
      store,
      ensure: () =>
        runtime.ensureSession({ sessionKey: "audit", agent: "fixture", mode: "persistent" }),
      receipts: () => readForkAuditReceipts(root),
    });
  } finally {
    await fs.writeFile(path.join(root, "release"), "release");
    await runtime.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
}

export async function collectForkAuditTurn(turn: AcpRuntimeTurn) {
  const events = [];
  for await (const event of turn.events) {
    events.push(event);
  }
  return { result: await turn.result, events };
}
