import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAcpRuntime, createAgentRegistry, createFileSessionStore } from "acpx/runtime";

// Run from this source checkout after building. Synthetic peers only, no provider.
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "acpx-assurance-example-")));
const peer = fileURLToPath(
  new URL("../test/fixtures/fork-observability-agent.ts", import.meta.url),
);
const runtime = createAcpRuntime({
  cwd: root,
  sessionStore: createFileSessionStore({ stateDir: path.join(root, "state") }),
  agentRegistry: createAgentRegistry({
    overrides: {
      resumable: [process.execPath, peer, root, "normal", "resumable"],
      basic: [process.execPath, peer, root, "normal", "basic"],
    },
  }),
  permissionMode: "deny-all",
  fs: false,
  terminal: false,
  agentProcessEnvAllow: [],
  timeoutMs: 3000,
  observation: {
    maxPendingEvents: 8,
    maxPendingBytes: 8192,
    maxEventsPerTurn: 8,
    sinkTimeoutMs: 100,
    sink: (event) => console.log(JSON.stringify(event)),
  },
});
try {
  for (const agent of ["resumable", "basic"]) {
    const handle = await runtime.ensureSession({ sessionKey: agent, agent, mode: "persistent" });
    const capabilities = await runtime.getCapabilityEvidence({ handle });
    const turn = runtime.startTurn({
      handle,
      text: "synthetic",
      requestId: agent,
      mode: "prompt",
      assurance: true,
    });
    const result = await turn.result;
    const receipt = await turn.assurance;
    // Print only fixed fields; the full receipt has private caller/backend identities.
    console.log(
      JSON.stringify({
        loadSession: capabilities.peer.loadSession,
        turnStatus: result.status,
        delivery: receipt.delivery,
        backendOutcome: receipt.backendOutcome,
        businessValidation: receipt.businessValidation,
        observationIdentity: receipt.observationIdentity,
      }),
    );
  }
} finally {
  await runtime.shutdown();
  await fs.rm(root, { recursive: true, force: true });
}
