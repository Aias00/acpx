# Own-fork candidate delivery

This is the candidate for <https://github.com/Aias00/acpx>, branch
`feat/ato-client-reliability`, based on upstream
`48c1615057ae43893f80868f81cd3ee0445eb0ae`. Upstream attribution, MIT license,
package name/version, release metadata, original scripts, locks, conformance
cases and inherited tests are retained. This document prepares origin delivery;
it does not certify independent review, installed-Pi execution, publication or
completion of the overall task. Existing ATO, Pi and PR runtimes remain live on
their original versions.

## Changes and compatibility

- ACP stdio offers protocol v1 and rejects a different initialize version before
  authentication or session creation (`ACP_PROTOCOL_VERSION_MISMATCH`). The
  regression fixture reproduces the upstream acceptance of v2 after offering v1.
- The in-process public runtime adds optional `getCapabilityEvidence()` with
  separate local implementation, stored peer advertisements and qualification.
  Advertisement is never permission or tested native capability. Qualification
  remains unknown; the query does not launch an agent.
- `startTurn({ assurance: true, ... })` adds `turn.assurance` and live
  `turn.getAssurance()`. Receipts distinguish unsent/submitted/finished/failed/
  unknown delivery, actual native-session/RPC identity, cancellation intent/
  notification-write/acknowledgement and owned cleanup. They preserve explicit
  RPC failure and ambiguous dispatch. Native outcome and independent business
  validation remain unknown. Model prose and arbitrary `_meta` supply neither.
- `turn.cancel({ timeoutMs })` optionally bounds the caller's cancellation wait.
  It neither retracts a queued notification nor proves native tools stopped.
- `createAcpRuntime({ observation: { sink }, ... })` adds a separate bounded
  schema-v1 sanitized channel, with runtime-local opaque aliases, monotonic
  ordering/timing, tool identity/update counts, partial/truncated/dropped coverage
  and isolated sink failures. Its private assurance mapping enables callers to
  correlate their own identities without publishing those identities.

All additions above are opt-in library features except protocol mismatch
rejection. No new CLI flags/config keys, daemon, notification policy, arbitrary
code-loading hook or backend-specific outcome reader is introduced. Default CLI
exit semantics, ordinary empty v1 `end_turn`, legacy result shapes and rich
events retain their meanings. A completed ACP turn does not certify a completed
business task. Shared runtimes do not gain these in-process assurance APIs.
See [the detailed API and limits](../runtime-assurance.md).

Exact resume, serialization, request ownership, permission policy and process
identity protections reuse upstream code. Supply the exact `resumeSessionId`
again when attaching through another runtime; failure to load that session must
fail rather than silently create a new session. Unknown delivery must never
trigger automatic prompt replay. Explicit fresh-session/reset operations are
separate and do not transfer hidden native context. There is no exactly-once
business-effect claim.

## Library usage and integration boundary

Use the candidate's `acpx/runtime` export from an isolated consumer. The caller
owns storage, permission policy and sink retention. This example requires a
locally configured ACP adapter; it is illustrative and is not a provider test:

```js
import { createAcpRuntime, createAgentRegistry, createFileSessionStore } from "acpx/runtime";

const observations = [];
const runtime = createAcpRuntime({
  cwd: scratchWorkspace,
  sessionStore: createFileSessionStore({ stateDir: scratchState }),
  agentRegistry: createAgentRegistry({ overrides: { local: localAdapterArgv } }),
  permissionMode: "deny-all",
  fs: false,
  terminal: false,
  agentProcessEnvAllow: [],
  observation: {
    maxPendingEvents: 32,
    maxPendingBytes: 32768,
    maxEventsPerTurn: 32,
    sinkTimeoutMs: 100,
    sink(event) {
      if (observations.length === 32) observations.shift();
      observations.push(event);
    },
  },
});
try {
  const handle = await runtime.ensureSession({
    sessionKey: "isolated-example",
    agent: "local",
    mode: "persistent",
  });
  const capabilities = await runtime.getCapabilityEvidence({ handle });
  const turn = runtime.startTurn({
    handle,
    mode: "prompt",
    requestId: "example-1",
    text: "Perform the explicitly authorized local fixture operation",
    assurance: true,
  });
  for await (const event of turn.events) {
    // Existing rich events are sensitive; consume separately without exporting.
  }
  const result = await turn.result;
  const receipt = await turn.assurance;
  // Store capabilities/result/receipt privately and validate actual effects
  // independently. receipt identities are not sanitized telemetry.
} finally {
  await runtime.shutdown();
}
```

`examples/runtime-assurance.mjs` is the runnable provider-free example, after
building this checkout: `node examples/runtime-assurance.mjs`. It uses the
exported library, caller-owned file store and bounded sink, plus two distinct
registry profiles (`resumable` and `basic`) without changing generic lifecycle
code. New backends register through existing `createAgentRegistry` overrides;
registration cannot manufacture capability, native authority or permissions.

ATO may adopt the library and sink explicitly in a later integration. This
candidate does not modify ATO, its launcher/controller, installed skill, existing
task/session history, authentication, ownership or notification preferences.
Consumers must feature-detect optional methods, respect STOP/authority before
dispatch, preserve ambiguous-delivery history and obtain their own independent
business evidence. Neither silence, sink acceptance nor notification enqueue
means approval, durable delivery, user reading or acceptance. Final completion
notification belongs to the authorized origin after all total-task gates pass;
routine stage progress does not generate notifications.

The safe sink defaults to 64 pending records/65536 bytes including in-flight,
128 tracked tools/turn, 256 accepted records/turn and a 1000 ms async timeout.
Hard caps and partial coverage are documented in the API guide. ACP v1 tool
updates correlate only to the active session window; delayed same-session
activity is not authenticated native turn identity. Hidden native tools are
unobservable. Check sink stats and loss counters even when no terminal event
arrives. Rich events, wire callbacks and journals remain sensitive with their
inherited buffering/retention contracts. Trusted synchronous callbacks cannot
be preempted; sinks must return promptly. External total retention is caller-owned.
ACP callback denial is not an OS sandbox for the adapter's native tools.

## Qualification and evidence classes

`audit.json`, `reliability.json` and `observability.json` in this directory record
their stage-specific source, commands, local fixture observations and residuals.
Their recorded passes are directed synthetic evidence, not live-provider proof.
Predecessor suites record 20 reliability cases, 22 observation cases and 117
inherited event/manager cases. This stage adds provider-free scripted-model
contract tests; no inherited test is changed or skipped.

The unchanged `pnpm run check` was invoked with Node 24.22.1 and pnpm 11.27.1.
Formatting, source typecheck and type-aware Oxlint passed; the existing
`lint:persisted-key-casing` tsx helper then hit the worker's known `listen EPERM`
socket restriction. It was not bypassed or repeated. This is **not** a passing
full check, coverage, build matrix or process-cleanup qualification. The frozen
host compatibility command must run the entire unchanged check and docs check.
The coverage gate targets the flows/runtime files specified in the original
script, with all four 85% thresholds; it is not whole-repository coverage.

Local qualification/checkpoint details are in `candidate-checkpoint.md`.
Ignored transient command logs are under `.local-verification/`. The fixed host
verifier, baseline and qualification cache remain outside the repository and
are never edited by workers. Origin's source-loader directed test summaries
need the established built-in TAP reporter environment; no test or verifier
change is implied.

Evidence that remains pending until origin runs it:

1. Frozen host compatibility and package acceptance for this exact fingerprint.
2. Independent P2 review using the canonical helper below and verified resolution
   of every actionable finding, including extension boundaries, compatibility,
   identity/ownership, privacy bounds, actual exported examples and sink isolation.
3. The bounded installed-Pi numeric-loopback sample below, with actual effects,
   exact ACP/native session IDs and cleanup receipt.
4. Commit and feature-branch publication to the own fork, remote-head verification
   and frozen `host` acceptance. No upstream PR, npm publish, tag or live activation.

No real cloud provider, model intelligence or business execution is qualified.
Transport v2 draft, remote/server transport, native-session portability,
checkpoint reconstruction, trusted native outcome readers, independent business
validators and full orchestration remain unsupported by this change.

## Package, isolated installation and rollback

The original package configuration builds an `acpx` package at version `0.22.0`.
It remains an unpublished own-fork candidate, not an upstream release. The
tarball is `.local-verification/acpx-0.22.0.tgz`; the authoritative exact absolute
artifact path, artifact SHA256 and external `acceptance.py fingerprint` source
SHA256 are in ignored `.local-verification/candidate.json`. Inspect them with:

```bash
cat .local-verification/candidate.json
shasum -a 256 .local-verification/acpx-0.22.0.tgz
tar -tzf .local-verification/acpx-0.22.0.tgz
```

Candidate artifact SHA256:
`ea181d761bf141858e8c92de13c77b40783e9b6189d73f1d654afcc96cb15dd0`.
The source digest is recorded separately in `candidate.json` after all delivery
documents are finalized, avoiding a self-referential source digest in this file.

The archive must include `package/dist/cli.js`, `package/dist/runtime.js` and
`package/package.json`. It must exclude tasks, credentials, private state,
native auth/config, dependency directories, source scratch and `.git`. The
existing package `files` allowlist is retained. The package verifier additionally
rejects unsafe paths, symlinks and sensitive names.

For a separate disposable consumer, install the exact tarball locally using an
already hydrated dependency store (no global install or activation):

```bash
candidate_prefix=$(mktemp -d /tmp/acpx-candidate-install.XXXXXX)
pnpm --dir "$candidate_prefix" add --offline --ignore-scripts /Volumes/data/acpx/.local-verification/acpx-0.22.0.tgz
node "$candidate_prefix/node_modules/acpx/dist/cli.js" --version
```

An unhydrated store may fail offline; stop rather than silently download or alter
an existing consumer. Library consumers import `acpx/runtime` from that isolated
prefix. The origin smoke instead extracts the verified archive into private
scratch and resolves dependencies via a read-only link to the already installed
locked checkout dependencies; it executes the packaged CLI `--version` and
packaged runtime without package scripts, downloads or a global install.

Rollback consists of stopping the candidate-owned test processes, then removing
only the disposable candidate prefix/scratch and removing any explicit consumer
reference to that prefix. Existing installed binaries and ATO need no rollback:
they were never changed. Never delete a user's native sessions or configuration.
Any source change after packaging/review requires fresh build, fingerprint,
tarball, candidate receipt and relevant qualification; do not reuse a stale
package or host receipt. Keep all candidate artifacts under the ignored local
verification directory.

## Origin-only installed-Pi sample

The implementation is `scripts/fork-local-pi-smoke.mjs`, with a sandboxed public
runtime driver and a deterministic SSE fixture in adjacent files. Worker has
only run `--plan` and pure wire-fixture unit tests. **No native prompt or actual
installed-Pi sample has been run by the worker.** Origin runs, in this checkout:

```bash
node scripts/fork-local-pi-smoke.mjs --plan
node scripts/fork-local-pi-smoke.mjs --run
```

This fixed macOS-origin harness checks Node 24.22.1, the previously installed
Pi 1.5.2 CLI entry SHA256
`e79626f2dd6f94aa45d30f3fa63cd84319a6eefcd150b353cfaf274366926774`
and research-installed adapter 0.0.34 entry SHA256
`324aeb8bba1228937e16b1326fb3e014e2a625b2dea549dbcd49b006cd5df6a2`.
It reads their executable/package files without changing either installation.
The plan/receipt records absolute entries, Node/Pi/adapter versions and hashes,
Pi RPC-entry hash and exact launch argv. A changed installation fails closed.
The harness is host-specific qualification tooling, not a new core backend hook.

The sample has two prompt admissions (authorization ceiling four), four scripted
model HTTP exchanges, a 150-second driver watchdog, a controller stop at 160
seconds including setup and an overall qualification ceiling of 180 seconds.
No automatic retry, ambiguous replay, fallback provider or extra prompt is
permitted. On failure origin inspects the receipt and remaining budget/history
before deciding any further action; rerunning the script is not a fresh quota.

A numeric `127.0.0.1` server returns scripted OpenAI-compatible SSE tool requests.
The native subtree runs under a default-deny macOS sandbox with only that exact
outbound loopback port and scratch writes allowed. Real native credential/config
directories are read-denied. A replacement HOME, XDG/Pi directories and a fresh
dummy key prevent existing auth/config reuse; only a static clean environment is
passed. Pi offline mode disables startup network; retries, compaction, warming,
telemetry, discovery of extensions/skills/context/prompts, and MCP are disabled.
The wrapper executes only the fixed installed Pi and enables `read,write` tools.
There are no provider credentials or real model services.

Through the extracted candidate runtime and original adapter, the first prompt
writes `effect.txt` in scratch using an actual native Pi tool. After runtime
shutdown, a fresh runtime loads the exact same native/ACP session and native
session file; a second prompt reads that effect. Assertions check actual file
bytes, tool statuses/IDs, correlated RPC/session receipts, one `session/new`,
`session/load` of that exact ID and two prompt dispatches. The native file header,
adapter session map and assurance receipts must agree on identity. Scripted
acknowledgement text is checked only as fixture payload; backend/business outcome
fields must still say `unknown`. This proves local CLI/adapter/protocol/tool
integration only.

The controller captures only the fresh foreground process's descendants and
rechecks start identity and command before any cleanup signal. Runtime shutdown
is attempted first. The private Pi launcher requests admission with its PID and
parent, then waits before exec. The host verifies its owned ancestry and records
the birth identity before acknowledging that request; no setuid process-inspection
tool runs inside the child sandbox. A fast adapter crash therefore cannot conceal
an admitted native child between polling ticks. The controller
closes the loopback server, verifies observed owned
processes are gone and removes private scratch. No detached job is started.
The fixed adapter also invokes two passive Pi version probes when creating the
session; loading that session does not repeat those probes. Qualification requires
exactly two RPC launches and two version probes across the two connections; each
launch has an independently recorded host identity.
On cleanup failure it preserves the private scratch path and fails qualification
for origin inspection; it never kills an unrelated PID. Receipts are private
mode-0600 files named `.local-verification/pi-smoke-receipt-<nonce>.json`, including
admission count, elapsed time, exact identities/effects and cleanup flags. No
raw transcript, stderr, credentials or user config is exported. Do not mark
`local_pi_qualified` unless that receipt is qualified and cleanup is complete.

## Exact origin closeout

After the frozen compatibility/package checks pass, origin reads the full
canonical review skill and its required references at
`/Volumes/data/.research/acpx-fork-review-skills-20261119/autoreview/SKILL.md`, then
invokes its matching helper from this repository with `--max-priority P2`.
Choose the skill's appropriate dirty/local or committed-branch scope and preserve
its isolation, report and status rules. Review outputs/status stay outside the
repository. No worker invokes review or authenticates a native reviewer.

Address actionable findings, regenerate/qualify any changed candidate and run
the origin-only sample within the single existing admission/time budget. After
true qualification, origin commits and pushes only
`feat/ato-client-reliability` to <https://github.com/Aias00/acpx>, and verifies
the remote branch head equals the local commit with the upstream base as an
ancestor. Do not overwrite upstream, publish npm/tags, activate the candidate or
rewrite existing task, permission, ownership, STOP or unknown-delivery history.

The fixed verifier expects origin to create
`/Volumes/data/.build-logs/acpx-fork-hardening-20261119/host-delivery.json` with
these exact keys: `source_sha256`, `artifact_sha256`, `review_qualified: true`,
`review_status_file`, `local_pi_qualified: true`, `local_pi_receipt`,
`local_pi_prompt_admissions` (1–4), `real_provider_called: false`,
`live_runtime_activated: false`, and `published_commit`. Paths must point to
real qualified receipts; booleans cannot substitute for evidence. Origin then
runs the unchanged external `acceptance.py host` and retains its result.

For future upstream sync, keep this base and fork history visible, fetch/review
upstream in a separate authorized maintenance change, resolve compatibility
deliberately and rerun inherited plus fork-directed gates. Do not rebrand the
upstream release workflow or expand the fork's capability claims during sync.
