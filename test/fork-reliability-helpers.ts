import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createAcpRuntime, createAgentRegistry, type AcpRuntimeOptions } from "../src/runtime.js";
import { InMemorySessionStore } from "./runtime-test-helpers.js";

// Source tests use Node 24's type stripping; compiled tests use the compiled peer.
const peer = fileURLToPath(
  new URL(
    `./fixtures/fork-reliability-agent.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`,
    import.meta.url,
  ),
);
export type Receipt = {
  method: string;
  id?: string | number;
  sessionId?: string;
  projectMatches?: boolean;
};
export const turnInput = {
  text: "SYNTHETIC_SECRET",
  requestId: "private-request",
  mode: "prompt",
  assurance: true,
} as const;

export async function fixture(
  scenario: string,
  run: (f: {
    root: string;
    runtime: ReturnType<typeof createAcpRuntime>;
    store: InMemorySessionStore;
    ensure: () => ReturnType<ReturnType<typeof createAcpRuntime>["ensureSession"]>;
    rows: () => Promise<Receipt[]>;
    wait: (method: string) => Promise<void>;
  }) => Promise<void>,
  options: Partial<AcpRuntimeOptions> = {},
  profile = "resumable",
) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "acpx-reliability-")));
  const store = new InMemorySessionStore();
  const runtime = createAcpRuntime({
    cwd: root,
    sessionStore: store,
    agentRegistry: createAgentRegistry({
      overrides: { synthetic: [process.execPath, peer, root, scenario, profile] },
    }),
    permissionMode: "deny-all",
    fs: false,
    terminal: false,
    agentProcessEnvAllow: [],
    timeoutMs: 3000,
    ...options,
  });
  async function rows(): Promise<Receipt[]> {
    const text = await fs
      .readFile(path.join(root, "receipts.ndjson"), "utf8")
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          return "";
        }
        throw error;
      });
    return text.trim()
      ? text
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
  }
  async function wait(method: string) {
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      if ((await rows()).some((row) => row.method === method)) {
        return;
      }
      await delay(10);
    }
    assert.fail(`Missing synthetic receipt: ${method}`);
  }
  try {
    await run({
      root,
      runtime,
      store,
      rows,
      wait,
      ensure: () =>
        runtime.ensureSession({
          sessionKey: "private-session",
          agent: "synthetic",
          mode: "persistent",
        }),
    });
  } finally {
    await fs.writeFile(path.join(root, "release"), "release");
    await runtime.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
}
