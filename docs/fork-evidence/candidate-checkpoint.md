# Candidate-ready checkpoint

Scope: final candidate preparation on `feat/ato-client-reliability`, preserving
upstream base `48c1615057ae43893f80868f81cd3ee0445eb0ae`. This stage does not
complete the overall fork task or authorize worker native execution/publication.

- Delivery guide: [delivery.md](delivery.md), covering exact public behavior,
  opt-in defaults, library/sink/adapter use, ATO boundaries, upstream sync,
  artifact integrity, isolated install/rollback and unsupported capabilities.
- Origin-only foreground smoke: `scripts/fork-local-pi-smoke.mjs`,
  `scripts/fork-local-pi-driver.mjs`, `scripts/fork-local-pi-model.mjs`. Fixed
  installed Pi/adapter read-only, extracted candidate CLI/runtime, numeric
  loopback/dummy key, private scratch, two ACP admissions/four HTTP exchanges,
  exact native load and actual write/read effects, birth-identity cleanup,
  <=180 seconds. No worker native prompt or independent review was run.
- Provider-free model contract tests: `test/fork-pi-smoke.test.ts`, three passing
  cases covering exchange/admission bounds, actual-effect prerequisite, exact
  phase/tool correlation and structured user text; zero failures/skips/todos.
- The unchanged `pnpm run check` passed format/typecheck/type-aware Oxlint, then
  failed at the known tsx `listen EPERM` worker socket restriction. No bypass,
  repeated known failure, skipped test, coverage reduction or script alteration.
  Full inherited regression/coverage remains frozen host compatibility work.
- Unchanged `pnpm run check:docs` passed format, Markdown lint and docs-site
  build/link checks. New nested docs receive explicit formatting checks too.
- The original `pnpm pack --pack-destination .local-verification` passed with
  its original prepack build. Candidate tarball, exact source/artifact digest
  receipt and transient logs remain under ignored `.local-verification/`.
  The package keeps `dist/cli.js`, `dist/runtime.js`, public declarations,
  original metadata and MIT license, excluding private/task/auth state.
- Read-only `node scripts/fork-local-pi-smoke.mjs --plan` verified fixed Node
  24.22.1, Pi 1.5.2 and adapter 0.0.34 metadata and executable hashes. It does
  not start native processes or consume a prompt admission.

Host must run the unchanged external `acceptance.py compatibility` and `package`
for the final receipt fingerprint. No host pass is claimed here. The worker
returns `ready_for_checks`, not `needs_host`; the dedicated final origin task
alone requests the explicitly authorized P2 review, bounded installed-Pi sample,
feature-branch commit/push to the own fork and verified remote delivery receipt.
Review/sample findings require fixes, regenerated package/fingerprint and fresh
qualification before publication. Original attempts, unknown delivery, STOP,
ownership and notification preferences remain intact. No scheduler/task state,
live ATO/service/config/auth/session, global install, provider, commit/push,
release or upstream PR was changed or performed by this worker.
