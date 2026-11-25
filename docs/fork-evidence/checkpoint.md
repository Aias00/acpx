# Fork audit checkpoint

The audit stage is ready for the scheduler's frozen `audit` acceptance. This
stage adds evidence and local synthetic fixtures; it changes no production
behavior and does not complete the fork delivery.

Baseline: `48c1615057ae43893f80868f81cd3ee0445eb0ae`, branch
`feat/ato-client-reliability`, Node `24.22.1`, pnpm `11.27.1`.
The complete requirements remain in [the task contract](../ato-fork-task.md).
The origin-added [extension boundaries](../fork-extensibility.md) also apply:
keep generic client contracts independent of ATO and backend-specific evidence
behind explicit existing adapter/registry interfaces. Later qualification must
include two distinct local synthetic backend profiles and runnable standalone,
sink and adapter-registration examples through the exported APIs.

## Evidence and verified behavior

- `docs/fork-evidence/audit.json` classifies all six categories with source locations,
  exact upstream semantics, a compatibility plan and residual limits.
- `docs/fork-evidence/audit-observations.json` records the sanitized
  baseline measurements. No raw private payload or credential is retained.
- `test/fork-audit.test.ts` adds 13 local subprocess cases. All 13 passed,
  with zero failed, cancelled, skipped or todo cases. It uses actual exported
  runtime behavior and observable method/identity/effect receipts.
- `test/fixtures/fork-audit-agent.ts` is a scripted stdio peer. It uses a
  private temporary workspace, no model/network/auth and bounded identity-only
  receipts. Client filesystem and terminal callbacks are disabled.
- `test/fixtures/fork-audit-reproduce.ts` characterizes the baseline through
  the actual client/runtime. It is outside the regression test glob so future
  fixes need not preserve a known bug. Its observations may change after fixes;
  the stored baseline report is historical evidence.

The reproduced client bug is acceptance of returned protocol v2 after offering
v1, followed by `session/new`. The observation requirement also has a concrete
gap: existing opt-in rich/wire interfaces expose raw synthetic payloads, retain
an unconsumed event queue without a configured cap, and admit multiple pending
sink calls. Rich interfaces are intentionally sensitive; this is not evidence
that default logging leaks user content.

Already-correct safety behavior must survive: exact resume and refusal to
replace it, no replay after EOF with possible effects, host authority before
dispatch, per-session serialization, RPC failure precedence, no prose or
untrusted metadata as native truth, and cancel request versus acknowledgement.
Process identity, CLI queue custody, configuration replay and abandoned stream
cleanup have substantial inherited implementation and tests; do not replace
them with simpler mechanisms.

## Reproduction commands

```bash
pnpm run build
pnpm run build:test
node --test --test-reporter=tap --test-concurrency=1 dist-test/test/fork-audit.test.js
node dist-test/test/fixtures/fork-audit-reproduce.js
```

Build before compiling tests because an inherited test imports the package's
built runtime export. Running `build:test` first in an unbuilt tree initially
reported that missing self export; the normal build sequence resolved it.
The deliberate duplicate success after an RPC error emits an SDK unknown-request
diagnostic; the corresponding test verifies that failure remains authoritative.
The build, test compilation, targeted type-aware lint, explicit formatting
checks and unchanged `pnpm run check:docs` passed. All 310 protected file hashes
and original package scripts matched the fixed baseline. The docs-site check
initially rejected links to JSON artifacts that it does not publish; referring
to those repository artifacts as code paths fixed the links without changing
the docs builder or checks.

## Next implementation stage

1. Reject incompatible initialize responses before auth/session dispatch and
   retain initialization cleanup. Target v1 only.
2. Add opt-in assurance for local versus peer versus qualified capabilities,
   transport versus backend versus independent business outcome, delivery
   certainty, and cancellation/cleanup evidence. Keep legacy result shapes,
   event streams, controls and default CLI exit behavior. Missing receipts are
   unknown; neither prose nor arbitrary `_meta` supplies native authority.
3. Retain exact resume and ownership mechanisms. Extend directed tests for
   failed/unknown delivery, blocked cancellation and stale identities without
   replaying prompts or signaling unrelated processes. A partially failed
   write is ambiguous; a raw outbound observation is not a delivery receipt.
4. Add the separate bounded sanitized observer described in the audit, with
   source/correlation, monotonic ordering/durations, tool update deduplication,
   dropped/partial accounting and bounded slow/failing sink behavior. Preserve
   existing rich opt-in events and their sensitive-data contract.
5. Add the required `test/fork-reliability.test.ts` and
   `test/fork-observability.test.ts`, the corresponding reports, API docs and
   user-facing changelog entries in their assigned stages. Keep all inherited
   tests, conformance files, locks, scripts, release workflow and instructions.

The full unchanged repository checks remain part of later integrated
qualification. Do not repeat known sandbox socket/source-loader failures or
weaken checks; the scheduler runs host checks. This worker has not run the
frozen acceptance or independent review, native-agent prompts, installed-Pi
sample, cloud calls, publication or live activation. The final origin task
alone owns P2 review, the bounded local-Pi sample and publication to the own
fork branch after true qualification. STOP, unknown-delivery history, user
notification preferences and live ATO remain untouched.
