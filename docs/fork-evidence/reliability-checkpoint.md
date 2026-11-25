# Reliability stage checkpoint

Baseline `48c1615057ae43893f80868f81cd3ee0445eb0ae`; branch
`feat/ato-client-reliability`; Node 24.22.1 / pnpm 11.27.1.

Implementation is ready for frozen host `reliability` acceptance. This stage
does not complete the fork delivery. The report is
`docs/fork-evidence/reliability.json`; sanitized directed TAP is
`docs/fork-evidence/reliability-local.tap` (20 passed, no failures/skips).

Retry diagnosis: the previous host source-directed run actually passed all 20
cases (zero failures, cancellations, skips and todos). Node 24 emitted its spec
reporter summary, while the frozen verifier expects TAP summary comments. Keep
the verifier and acceptance command unchanged; the host must select Node's
built-in TAP reporter in the command environment:

```bash
NODE_OPTIONS=--test-reporter=tap \
  /Volumes/data/.ctask-runtime/acp-process-live-20261119T022710Z/.venv/bin/python \
  /Volumes/data/.build-logs/acpx-fork-hardening-20261119/acceptance.py reliability
```

Preserve any existing required `NODE_OPTIONS` when adding this reporter option.
This changes reporting only: it neither alters assertions nor manufactures
counts. The new local compiled run uses that environment with no reporter CLI
argument and passes all 20 actual cases; genuine TAP is retained in
`reliability-retry.tap`. Test compilation, source typecheck, direct type-aware
Oxlint and all 310 protected hashes/original package scripts were rechecked and
passed. Source-loader/socket acceptance remains host-owned; the worker did not
repeat the known restriction or run the external verifier. No production source
repair was warranted by this reporting failure, and no project/toolchain config
change is retained. Full host acceptance is still pending.

The subsequent host log `reliability-1795134799369761000.log` repeated the
same reporting mismatch: all 20 actual cases passed, with no failures,
cancellations, skips or todos, but the default spec summary is not TAP.
The current worker recheck again passed all 20 compiled runtime/subprocess
cases using genuine Node TAP output, retained in
`docs/fork-evidence/reliability-worker-recheck.tap` (15880.161791 ms).
Source typecheck, test compilation, type-aware Oxlint, targeted formatting,
the 310 protected hashes and 43 original scripts passed again. The `.npmrc`
is unchanged; no reporter/config hook, assertion changes, generated count
lines, verifier changes or extra test runner were added. The scheduler's
host acceptance process needs the reporter environment shown above before
starting Node. A worker test file cannot change its parent runner's reporter.

- Reject mismatched protocol before auth/new; historical baseline proof remains
  in `audit-observations.json` and the fixed behavior has a subprocess regression.
- New opt-in capability/turn evidence and safe bounded sink are exported from
  the in-process runtime. Native/business outcomes stay unknown; default results
  and ordinary empty v1 completion remain compatible.
- Preserve exact resume, no replay, serialization, ownership and existing process
  cleanup. Test blocked writes, finite cancel waits, late/acknowledged cancel,
  revoked admission, stale turn cancellation and two peer capability profiles.
- API docs: `docs/runtime-assurance.md`. Runnable built-library/registry/sink
  example: `examples/runtime-assurance.mjs` (both profiles verified).
- Typecheck, build/test compilation, direct type-aware Oxlint, formatting,
  docs checks, diff whitespace and all 310 protected hashes/original scripts pass.

Worker limits: unchanged lint's `tsx` IPC socket is denied. An attempted inherited
process-cleanup suite also denied `ps`; 44 cases passed and 15 process-inspection
cases failed in that combined run. Do not rerun these restrictions in the worker
or weaken checks. The failed teardown could not verify/retire its synthetic
descendants. A private temporary receipt at
`/tmp/acpx-reliability-worker-cleanup.json` records exactly those 15 test fixture
directories/PID files and timestamps. Host must freshly verify their identity
before any cleanup; saved PIDs alone are not authority. No unrelated process was
signaled. The host needs the unchanged original checks and fresh test-owned
cleanup inspection; process-tree qualification is not claimed here.

Next assigned stage still needs the dedicated observability suite/report with
at least eight cases and broader coverage for drops, truncation, sink rejection,
partial/missing telemetry and profile variation. Then complete inherited host
qualification, package preparation and the final origin-only review/local-Pi/
own-fork publication handoff. Do not run native prompts, providers, schedulers,
subagents, review tools, Git publication or live service/session mutation in this
worker. Full requirements and authorization remain in `docs/ato-fork-task.md` and
`docs/fork-extensibility.md`; all earlier STOP/notification/unknown-delivery
preferences and history remain intact.
