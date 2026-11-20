# General-purpose client and extension boundaries

## User clarification

On 2026-11-19 the user clarified the active fork task:
“实现的时候需要考虑通用性和拓展性”. This refines the existing requirement
to keep the client reusable across backends. It does not authorize additional
providers, live deployment, a remote service, or a larger orchestration product.

## Implementation constraints

- Keep generic lifecycle, identity, delivery, cancellation, assurance and
  observation contracts independent of ATO, Pi and individual business domains.
  ATO is a consumer of the client, not a dependency of its public runtime.
  Do not require ATO files, workflow state, private paths or a running ATO
  service for standalone CLI/library use.
- Reuse the existing agent registry and runtime extension interfaces. Put
  backend-specific normalization and evidence readers behind explicit adapter
  boundaries. Do not spread agent-name conditionals through generic lifecycle
  code or introduce a second plugin/runtime framework.
- Make observations usable through a caller-provided bounded sink, with a
  documented neutral event schema. A particular database, server, exporter or
  notification destination must not be mandatory. Storage ownership and state
  location remain caller-controlled through existing supported interfaces.
- Keep fields and capability semantics explicit and forward-compatible. Distinct
  values for unsupported, unknown and qualified must remain meaningful.
  Version a persisted or exported schema when necessary; unknown optional fields
  must not become approval or success. Preserve upstream default CLI/result
  compatibility and provide migration guidance for intentional changes.
- A backend extension may register known local adapter behavior and translate
  evidence; registration cannot manufacture capability, user authority, sandbox
  access or trusted native success. Missing optional evidence remains unknown.
  Do not implement unrestricted dynamic imports, executable strings or remote
  code loading merely to advertise extensibility.
- Keep extensions narrow and demonstrated. Do not add speculative transports,
  backends, services, queues or configuration layers just to create abstraction.

## Demonstration and final review obligations

The existing reliability/observability suites must exercise at least two local
synthetic backend profiles with different capability sets or event behavior
through the actual public registry/runtime. Check shared behavior and truthful
unsupported/unknown results, not just a single Pi-shaped fixture. No new real
provider calls are needed or authorized by this clarification.

Provide a minimal standalone library example, an observation-sink example and
an adapter-registration example using the existing interfaces. Demonstrate
that another local fixture backend can be added without changing generic
lifecycle code. Keep examples runnable with synthetic data and document the
parts that require backend-specific qualification.

The final origin review must assess dependency direction, public compatibility,
adapter isolation, schema evolution, sink failure isolation and whether the
examples actually use the exported APIs. Relate these checks to the existing
audit, reliability, observability, compatibility and package acceptance, without
rewriting the frozen workflow checks or claiming this document itself is proof.
