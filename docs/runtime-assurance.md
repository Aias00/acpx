# Runtime assurance and safe observation

The in-process `createAcpRuntime()` export provides optional factual receipts and
a separate sanitized observation sink. These additions target ACP v1 stdio. They
do not implement the v2 draft, a remote service, native session portability,
business orchestration or a native outcome reader. Shared runtime and CLI result
interfaces retain their existing contracts; the new assurance APIs apply to the
in-process runtime.

## Capability evidence

`runtime.getCapabilities()` remains the legacy inventory of local controls and
last-advertised configuration keys. It is not proof that the peer implements each
control. `await runtime.getCapabilityEvidence({ handle })` separates:

- `local`: implemented client methods, not permission grants.
- `peer`: the saved initialize advertisement, explicitly marked `stored`, with
  protocol version when known. Explicit false means `unsupported`; an advertised
  feature means `advertised`; missing evidence means `unknown`.
- `qualification`: currently `unknown`, source `none`. A successful initialize
  does not qualify tools, model outcomes, every advertised method or native state.

The query neither starts a process nor probes a control. Returned objects are
caller-owned snapshots. A stored advertisement may be stale. The client offers
protocol v1 and rejects a different returned version before authentication or
session creation, using detail code `ACP_PROTOCOL_VERSION_MISMATCH`.

## Turn receipts

Pass `assurance: true` to `startTurn()`. The legacy `turn.result` is unchanged.
`await turn.assurance` resolves after that turn's finalization attempts, alongside
the result. `await turn.getAssurance()` returns a detached live snapshot when
assurance is enabled. The versioned receipt includes private caller/backend/RPC
identities; it is **not sanitized telemetry** and should stay in caller-controlled
storage. It never contains prompt, thought, raw tool payload, stderr or `_meta`.

| Field                                  | Meaning                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `delivery: unsent`                     | No prompt transport write was attempted by this turn yet; final unsent is proven before dispatch.                      |
| `delivery: submitted`                  | Live snapshot: the writable transport accepted this exact prompt. No peer/business acknowledgement is implied.         |
| `delivery: unknown`                    | A write may be partial, or a dispatched turn ended without a correlated response. Do not automatically replay.         |
| `delivery: finished`                   | A correlated ACP response arrived. Check the separate turn result, stop reason and independent business evidence.      |
| `delivery: failed`                     | A correlated ACP RPC error arrived; a later duplicate success cannot replace it.                                       |
| `transport`                            | `not_dispatched`, `no_response`, `response` or `rpc_error`; no model-text parsing.                                     |
| `backendOutcome`, `businessValidation` | Both remain `unknown`: this client has no trusted native receipt or independent business verifier.                     |
| `cancellation`                         | Separates intent, accepted notification write and a `cancelled` response. Native tool termination remains `unknown`.   |
| `cleanup`                              | `retained`, owned close `attempted`/`owned_close_settled`, or `not_started`. It does not certify native tools stopped. |
| `failureCategory`                      | Fixed client categories: `none`, `before_dispatch`, `acp_error`, `transport_or_client`, `client_finalization`.         |

Ordinary empty v1 `end_turn` still returns `{ status: "completed" }` with its stop
reason. That describes an ACP turn, not completion of a business task. Model
prose and peer `_meta` cannot establish native outcome authority. Receipt failure
categories describe client/transport facts rather than guessing backend outcomes
from human-readable errors. A finalization failure can leave `delivery: finished`
while `turnStatus: failed`; the receipt preserves both facts.

Exact recovery remains upstream behavior: supply `resumeSessionId` again when
attaching through a new runtime, preserve the project/record, and fail if that
native session cannot load/resume. No prompt replay or silent replacement is
added. The existing explicit CLI retry policy is unchanged. An explicit
fresh-session/reset operation retains its existing separate
semantics and cannot claim native continuity or transfer hidden context.

`turn.cancel({ timeoutMs: 1000 })` bounds only the caller's wait. The optional
positive finite timeout must be at most `2147483647`; omission preserves the
existing wait behavior. A timeout does not retract a queued notification, prove
cancellation or terminate tools. The turn can still complete late. To retire
owned client processes, use the existing `close()`/`shutdown()` lifecycle; those
preserve stored sessions. No PID-only process killing or broader permissions are
introduced. ACP permission approval and disabled filesystem/terminal callbacks
are protocol policies, not an OS sandbox.

## Sanitized bounded sink

Set `observation: { sink }` in `createAcpRuntime()` options. This is independent
of the existing sensitive `turn.events`, `onAcpMessage` and persisted journals.
Those rich interfaces keep their prior behavior and buffering contracts.

The sink receives `AcpSafeObservation` schema version 1 with a runtime-local
monotonic sequence/time, source (`client` or `acp_peer`), opaque session/request/
turn/tool identifiers, fixed lifecycle/status/failure fields, duration and tracked
tool counts. It observes the existing ordered ACP message path before asynchronous
rich-event processing; it does not scrape text or add a second transport.
One tool's updates share one identifier and count as one tracked call. Updates
without a status preserve the last observed status; unfamiliar statuses become
`unknown`. There are no arbitrary strings, prompt/thought bodies, titles/paths,
raw arguments/output, credentials, private configuration or raw stderr. Salted
identifiers are local to this runtime and cannot join private identities across
restarts. A tool identifier alone is not evidence that a tool ran successfully.

`sessionId` aliases the admitted client record; `requestId` aliases the caller's
request ID. Each admission has a distinct `turnId`, even if the caller reuses a
request ID. At dispatch, `backendSessionId` aliases the actual native session and
`rpcRequestId` aliases the actual RPC ID scoped to that turn. Join these fields
with `sessionId` and `turnId`; peers can reuse native or RPC IDs on different
connections. Aliases are correlation hints, never permission or native authorship
proof. Raw private identities remain available only in the separate assurance
receipt and rich interfaces.

When both observation and `assurance: true` are enabled, the private receipt's
optional `observationIdentity` maps those real caller/native/RPC identities to
their safe aliases. Live snapshots include native/RPC aliases only after actual
dispatch. Use this caller-owned mapping to associate concurrent ATO requests;
never copy the full private receipt into the safe sink. Receipt snapshots are
detached, and disabling observation omits the mapping entirely.

Lifecycle types are `turn_started`, `prompt_dispatching`, `prompt_submitted`,
`prompt_response`, `cancellation_requested`, `cancellation_written`, `tool` and
`turn_settled`. A dispatch attempt starts as unknown delivery; accepted writes
are submitted; only correlated RPC responses become finished or failed.
Settlement preserves the separate fixed transport/failure category, turn result,
cancel intent/write/acknowledgement and owned cleanup state. Backend outcome,
business validation and native tool termination stay `unknown`.

Tool updates must match the active owner's native session after dispatch and
before the prompt response. Wrong-session and out-of-window tool updates are
excluded, with `ignoredUpdates` counted in later observations. Idle/setup and
replay-suppressed updates are outside this channel. ACP v1 updates carry no native
turn/request ID: `toolCorrelation: active_session_window` explicitly describes
the available evidence. A delayed update from a previous turn that arrives during
the next same-session window cannot be distinguished. `_meta` turn/request hints
are ignored, and this channel never claims authenticated per-turn native activity.

Coverage always says `partial`: client/ACP observations cannot see hidden native
activity. `trackingTruncated` flags absent, oversized or over-limit tool IDs.
`toolCoverage` distinguishes `from_call`, `update_only` and `untracked`; a first
update without the initial call cannot imply complete tool lifecycle coverage.
`toolDurationMs` measures elapsed time since the first observed update, not native
execution duration. `toolCalls` counts tracked distinct IDs, not an exhaustive
backend total. Events include cumulative `dropped` counts;
`runtime.getObservationStats()` exposes current queue/bytes/in-flight/drop/failure/
disabled counters and locally resolved sink calls (`delivered`) without starting a
manager. This counts callback resolution, not durable external storage or
downstream delivery. Query the counters even when a sink cannot receive a final
event. Drops count queue/output overflow, disabled-sink admissions and failed/
timed-out calls; ignored updates and incomplete tool tracking have separate
counters/markers.

| Option             | Default | Hard maximum |
| ------------------ | ------- | ------------ |
| `maxPendingEvents` | 64      | 1024         |
| `maxPendingBytes`  | 65536   | 1048576      |
| `maxToolsPerTurn`  | 128     | 2048         |
| `maxEventsPerTurn` | 256     | 4096         |
| `sinkTimeoutMs`    | 1000    | 60000        |

Queue limits include the in-flight event; values are clamped to positive integers
and non-finite values use defaults. `maxEventsPerTurn` has a minimum of two and
reserves one admission slot for settlement. Every safe event is also capped at
2048 serialized bytes, so accepted output is at most 512 KiB per turn by default
and 8 MiB at the hard maximum. Total output across turns and external storage
retention remain caller-owned. Bytes measure serialized JSON; event/tool limits
also bound object/tracking overhead. Overflow drops incoming events, so gaps and a
missing terminal observation are possible even with the reserved output slot
when the pending queue/byte limit is full. A throwing/rejecting sink is isolated
and disabled after the first failure, without exporting its private error text.
Only one sink call can be in flight. A timed-out async sink disables further calls
and drops pending events; an unresolved call never opens another concurrency
slot. A failed/timed-out in-flight call counts as one drop even if it resolves or
rejects later. Outcome settlement never awaits telemetry. Shutdown drops pending
telemetry and records the drop count, without awaiting the sink. The caller owns
any external storage/retention and must enforce its own bound there. No daemon,
notifications, telemetry service or automatic export is started.

The callback is trusted local JavaScript: it must return promptly. A synchronous
infinite loop cannot be preempted inside the same process. Use a bounded external
consumer if callback isolation is required. The client supplies no delivery,
exhaustive-coverage or exactly-once guarantee for observations.

## Runnable synthetic example

After `pnpm run build`, run `node examples/runtime-assurance.mjs` on Node 24.
The example imports the public runtime, registers two local scripted profiles
through the existing agent registry, uses caller-owned scratch state and a
sanitized sink, and deletes its scratch directory after shutdown. It needs no
provider, native agent or credentials. Adding another fixture is a registry
override, not a generic lifecycle change. Qualification of a real backend remains
separate from these synthetic receipts.
