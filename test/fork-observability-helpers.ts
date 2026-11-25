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
  type AcpSafeObservation,
} from "../src/runtime.js";
import { InMemorySessionStore } from "./runtime-test-helpers.js";

const peer = fileURLToPath(
  new URL(
    `./fixtures/fork-observability-agent.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`,
    import.meta.url,
  ),
);
export const secret = "SYNTHETIC_OBSERVABILITY_SECRET_73c0";
export const input = {
  text: secret,
  requestId: "PRIVATE_REQUEST",
  mode: "prompt",
  assurance: true,
} as const;
export type ObservationFixture = {
  root: string;
  runtime: ReturnType<typeof createAcpRuntime>;
  store: InMemorySessionStore;
  events: AcpSafeObservation[];
  ensure: (key?: string) => ReturnType<ReturnType<typeof createAcpRuntime>["ensureSession"]>;
  rows: () => Promise<Array<{ method: string; id?: number | string; sessionId?: string }>>;
};
export async function waitFor(predicate: () => boolean, label: string) {
  const deadline = performance.now() + 3000;
  while (!predicate() && performance.now() < deadline) {
    await delay(5);
  }
  assert.ok(predicate(), label);
}
export async function observedFixture(
  scenario: string,
  run: (fixture: ObservationFixture) => Promise<void>,
  options: Partial<AcpRuntimeOptions> = {},
  profile = "resumable",
) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "acpx-observability-")));
  const events: AcpSafeObservation[] = [];
  const store = new InMemorySessionStore();
  const runtime = createAcpRuntime({
    cwd: root,
    sessionStore: store,
    agentRegistry: createAgentRegistry({
      overrides: { synthetic: [process.execPath, peer, root, scenario, profile] },
    }),
    agentProcessEnvAllow: [],
    permissionMode: "deny-all",
    fs: false,
    terminal: false,
    timeoutMs: 3000,
    ...options,
    observation:
      Object.hasOwn(options, "observation") && !options.observation
        ? undefined
        : {
            ...options.observation,
            sink: (event) => {
              events.push(event);
              return options.observation?.sink(event);
            },
          },
  });
  async function rows(): ReturnType<ObservationFixture["rows"]> {
    const content = await fs.readFile(path.join(root, "receipts.ndjson"), "utf8");
    return content
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }
  try {
    await run({
      root,
      runtime,
      store,
      events,
      rows,
      ensure: (key = "PRIVATE_SESSION") =>
        runtime.ensureSession({ sessionKey: key, agent: "synthetic", mode: "persistent" }),
    });
  } finally {
    await fs.writeFile(path.join(root, "release"), "synthetic release");
    await runtime.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
}
export async function settled(f: ObservationFixture) {
  await waitFor(
    () => f.events.some((event) => event.type === "turn_settled"),
    "settlement observation",
  );
  return f.events.findLast((event) => event.type === "turn_settled")!;
}
