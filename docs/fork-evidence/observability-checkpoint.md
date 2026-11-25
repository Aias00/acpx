# Fork observability checkpoint

Stage implementation is ready for the scheduler's frozen host `observability`
acceptance. This is not completion of the overall fork delivery.

Baseline `48c1615057ae43893f80868f81cd3ee0445eb0ae`; source branch
`feat/ato-client-reliability`; Node `24.22.1`, pnpm `11.27.1`.
The requirements in [the task contract](../ato-fork-task.md) and
[extension boundaries](../fork-extensibility.md) remain in force.

The safe sink now uses the existing ordered per-owner ACP message path. It
correlates real native-session/RPC dispatch with opaque record/request/turn/tool
aliases, with a detached mapping in the opt-in private assurance receipt. It
preserves rich runtime events separately. Tool updates have fixed statuses,
one tracked identity per call, partial/update-only/untracked coverage, timing,
ignored-update and dropped/truncated markers. Wrong-session and out-of-window
reports are excluded. ACP v1 cannot disambiguate a delayed previous-turn update
that arrives during a later same-session prompt window; this is explicitly
`active_session_window`, never authenticated native turn proof.

Queue count/bytes, tracked IDs and per-turn accepted output are bounded. There
is one sink call in flight; errors/timeouts disable the sink and are counted
without retaining diagnostic text or changing outcomes. Shutdown never awaits
telemetry. The safe path has no disk storage, exporter, daemon or notifications;
external retention is caller-owned. Native/business results remain unknown.

Evidence: `observability.json`, `observability-local.tap` (22 passing cases),
`observability-reliability.tap` (20 predecessor cases), and
`observability-inherited.tap` (117 inherited runtime event/manager cases), all in
`docs/fork-evidence/`. No skipped, cancelled, failed or todo cases. The built
`acpx/runtime` example runs two synthetic registry profiles, emits only bounded
safe records/fixed summaries and removes private scratch after shutdown.
Typecheck, test compilation, direct installed build command, type-aware lint,
formatting, Markdown lint and docs-site checks passed. All 310 protected files
and 43 original package scripts match the frozen baseline.

The pnpm build wrapper stopped before the script at an automatic dependency
status/install attempt without a TTY; no install/config/lock changes were made.
The unchanged installed build-script executable/arguments passed directly.
Do not claim `pnpm run check`, `pnpm run check:docs`, source-loader acceptance,
coverage or process-tree/OS cleanup qualification from these component checks.
Known sandbox socket/ps failures were not repeated or weakened. The scheduler
runs the fixed external `acceptance.py observability` outside this worker;
its unchanged TAP parser needs the already established TAP reporter environment.

Later stages still own full inherited checks, installable candidate/evidence,
canonical independent P2 review, bounded installed-Pi numeric-loopback sample and
reviewed feature-branch publication to the own fork. Only the final origin task
may perform that authorized handoff. No provider/native-agent prompt, live ATO,
auth/config/session mutation, task-state modification, nested scheduler, subagent,
commit/push/release or user notification occurred in this stage.
