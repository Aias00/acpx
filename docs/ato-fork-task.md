# ACP client fork: reliability and observability

## User goal and delivery

The user requested on 2026-11-19: “fork我们自己的acp客户端 把问题处理或者优化一下”.
Own fork: <https://github.com/Aias00/acpx>. Upstream: <https://github.com/openclaw/acpx>.
The fixed starting commit is `48c1615057ae43893f80868f81cd3ee0445eb0ae`.
Implement on `feat/ato-client-reliability` in `/Volumes/data/acpx`.

Deliver an actual usable, tested client candidate and reviewed changes in the
user's fork. Keep upstream attribution and MIT license. No npm release or tags,
upstream PR, live ATO/client replacement, existing session migration, business
request, production service change, new model provider or permission expansion.
Do not modify an existing ATO workflow, launcher, installed skill or controller.
This conversation remains origin and hub; no new coordinating conversation.

## Audit first

Audit current source rather than assuming the preceding discussion proves bugs.
Upstream already implements substantial persistence, request ownership,
explicit resume, cancellation and process cleanup. For each category below,
record one of: reproduced gap, already satisfied with evidence, or unsupported
backend/protocol limitation. Record concrete file/line, observed behavior,
regression or subprocess fixture, fix and remaining limitation. Do not add a
second orchestration framework or replace sound upstream behavior.

Relevant source includes `src/acp/client.ts`, `src/runtime/public/contract.ts`,
`src/runtime/public/events.ts`, `src/runtime/engine/controls.ts`,
`src/runtime/engine/prompt-turn.ts`, `src/runtime/engine/reconnect.ts`, and
`src/session/execution/`. Read applicable `AGENTS.md`, `VISION.md` and
`CONTRIBUTING.md` before implementing. Preserve all inherited tests/fixtures,
lockfiles, release workflow and original development instructions byte-for-byte.
Add focused tests and new fixtures, rather than weakening old expectations.

## Required observable behavior

1. Capability reporting distinguishes local client methods, peer-advertised
   capabilities and actually qualified behavior. Missing evidence is unknown,
   not permission or proven support. Preserve existing API compatibility and
   negotiate supported protocol versions; explicitly reject incompatible
   versions. v1 is the compatibility target; v2 draft support is not implied.
2. Turn transport completion, backend outcome and independent business
   validation remain separate. `end_turn`, EOF, an empty response or the
   presence of output cannot certify a completed business task. Explicit ACP
   errors or trusted, correctly correlated backend failure evidence cannot be
   overwritten by a later normal transport stop. Do not infer error/success
   from arbitrary model prose, treat untrusted `_meta` as native authority, or
   make every ordinary v1 completion fail because an optional receipt is absent.
   Additive opt-in assurance metadata/strict policy should preserve legacy
   result shapes and default exit semantics where those only describe a turn.
3. Reconnect/resume must preserve exact native session, project and request
   ownership. No silent fresh session when exact resume was requested. Explicit
   checkpoint reconstruction must identify the new session and its provenance,
   never claim native continuation or transfer hidden context between agents.
   Existing safe behavior may be retained with directed coverage.
4. Distinguish unsent, submitted, finished, failed and ambiguous delivery at the
   relevant public boundary. EOF/crash after possible dispatch must not cause
   automatic prompt replay. Enforce existing per-session serialization and
   exclusive ownership. No exactly-once business side-effect claim.
5. Cancellation requested, acknowledged and owned-process cleanup are distinct.
   Cover ignored cancel, blocked writes, crash, late completion and stale/wrong
   identity. Never kill unrelated processes or report a request as proof that
   native tools stopped. Preserve permission and filesystem/terminal policy;
   ACP approval is not an OS sandbox.
6. Provide an opt-in bounded, sanitized observation path suitable for ATO.
   Correlate session/request/turn/tool lifecycle, source, monotonic ordering,
   time/duration and fixed failure categories when available. Track updates of
   one tool as one call and label missing/dropped/partial coverage. Default safe
   telemetry must not retain prompt/thought bodies, raw arguments/output,
   credentials, raw stderr, or private configuration. Bound memory/storage and
   slow/failing sinks; observer failure cannot change task outcome. Preserve
   existing rich opt-in runtime events for compatibility; do not silently call
   them privacy-safe telemetry. No unsolicited user notifications or new daemon.

Keep client improvements reusable across backends. Vendor-specific evidence
readers must be explicit, narrow and separately tested. Do not add arbitrary
command/config hooks as a convenience. Do not implement a remote server or v2
draft stack within this task; document these residuals honestly.

The user's 2026-11-19 clarification requires generality and extensibility.
Read [the extension boundaries](fork-extensibility.md) before implementing or
reviewing the client and observation stages. These refine the existing goal:
neutral public contracts, existing adapter interfaces, caller-owned bounded
sinks, compatibility and runnable multi-profile extension examples. They do not
change the frozen workflow, privileges or live deployment scope.

## Validation

Add `test/fork-reliability.test.ts` and `test/fork-observability.test.ts` using the
actual exported runtime/client and real local ACP fixture subprocesses. Cover
the happy paths and the failure/unknown/privacy cases above. Tests must check
effects, receipts and identities, not merely assert an implementation string.
Inherited tests and fixtures are protected; new fixture files are allowed.

Run the repository's unchanged `pnpm run check` and `pnpm run check:docs` for
code plus docs. Do not lower coverage, skip old checks, modify pinned lockfiles,
or report a whole-repository coverage claim from a narrower coverage gate.
Keep changes limited; update affected API docs and user-facing changelog. If
changing a built-in harness, synchronize its `agents/{Agent}.md` and
`skills/acpx/SKILL.md` as required by upstream.

Reports under `docs/fork-evidence/`: `audit.json`, `reliability.json`,
`observability.json` and `delivery.md`. They must be sanitized, factual, include
commands and residual limits, and separate fixture, actual CLI/local model,
cloud provider and real user evidence. A report is not a substitute for tests.

Prepare a local installable package using the existing package configuration,
record exact SHA256 and installation/rollback/ATO integration guidance in
`docs/fork-evidence/delivery.md`. Keep the tarball outside Git. No global install.

## Origin-only final handoff

The workflow explicitly reserves these final actions to origin. Worker returns
`needs_host` only after source, regressions, docs and candidate are ready:

- Independent P2 review via the canonical upstream autoreview helper at
  `/Volumes/data/.research/acpx-fork-review-skills-20261119/autoreview/scripts/autoreview`.
  Its skill and required references are in the same installed directory. Follow
  its isolation and result rules; do not bypass a failed review. Review is
  explicitly required by upstream AGENTS.md, not a request for a hosted bot.
- A bounded installed-Pi/local-scripted-model interoperability sample through
  this fork, at most four prompt admissions and 180 seconds of active test time,
  using fresh private scratch session/config, numeric loopback and dummy key.
  Do not read/copy native auth, call a real provider, replay an ambiguous turn,
  use old observation quotas, or invoke live business. Record exact CLI and
  adapter versions/hashes, tool effects, turn/session identity and cleanup.
  Worker may implement the smoke script; origin alone runs it. Installed fixed
  Pi and local adapter may be read from the prior isolated installation without
  changing that installation. This proves CLI/protocol integration, not model
  intelligence or real-cloud reliability.
- After review findings are addressed and the final source is qualified,
  origin commits and pushes this feature branch only to `Aias00/acpx`, and
  verifies the remote head. No upstream submission, npm publication or release.

The frozen host verifier is outside this repository at
`/Volumes/data/.build-logs/acpx-fork-hardening-20261119/acceptance.py`.
Do not change that verifier, its baseline, or `.codex/tasks` state/checks.
Keep STOP, unknown-delivery and attempt histories intact. There is no need for
additional user approval for the exact authorized fork delivery above.
