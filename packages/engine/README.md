# @deeplake/engine

The engine composes durable evidence storage, bounded acquisition, deterministic structured mappings, extraction providers and reasoning tasks. It has no project/domain-specific data. `createEngine(dependencies)` accepts explicit capabilities; missing live credentials must be handled by the composition app, never replaced by demonstration behavior here.

## Public operations

- `createProject(input, clock?)`: validate an answerability contract and budgets, producing a project to save through the repository.
- `runCycle(projectId, options?)`: query planning, search frontier, diverse sampling, schema bootstrap, interpretation, audits and a proposed schema change. Does **not** publish.
- `ingest(projectId, urls)`: ingest explicit sources without search.
- `maintain(projectId)`: conditional fetch, immutable changed snapshots and interpretation under the current schema.
- `replay(projectId, sourceVersionIds?)`: interpret preserved source segments under the current approved schema without fetching again.
- `reparse(projectId, sourceVersionIds?)`: apply the configured parser to preserved original bytes, then interpret under the current schema. With no IDs, select only current source versions. Preserve original segments and releases; a historical reparse cannot move the latest pointer backward. Does **not** publish.
- `approveProposal(id, rationale, allowBreaking?)`: atomically approve an evidence-backed candidate, move the research-schema pointer and enqueue conservative historical replay.
- `rejectProposal(id, rationale)`: retain the candidate and record a rejection.
- `publish(projectId)`: atomically save an immutable publication and update its public pointer, with unsupported observations withheld and disagreements unresolved.
- `rollback(projectId, publicationId)`: change only the public pointer; preserve all evidence and current research schema.
- `executeJob(claimedJob)`: run a leased job. The worker owns heartbeat, completion and retry. The engine fences stages against cancellation and token loss. A failed workflow throws for the worker; budget exhaustion is a visible terminal run outcome, not an infinite retry.

## Reasoning task contracts

`workflows.ts` exports runtime Zod schemas for every task. All requests carry an untrusted-content boundary, a role, task name, structured input, and bounded output tokens. Providers must parse the supplied output schema.

| Task | Role | Input | Output |
|---|---|---|---|
| `plan-queries` | planner | `project: {id,contract}`, iteration, coverage/family counts/known URLs/open findings, remaining queries | `QueryPlanSchema`: queries with query, objective, family and exploratory flag |
| `bootstrap-schema` | architect | project, representative source metadata, segments | `SchemaDraftSchema`: name, description, entityTypes, rationale |
| `audit-representation` | auditor | project, approved schema, sourceVersion, full segment batch | `AuditResultSchema`: evidence-backed finding drafts |
| `audit-extraction` | auditor | same input plus actual observations | `AuditResultSchema` |
| `propose-schema` | architect | project, schema, evidence-backed schema-gap findings | `SchemaDraftSchema` |
| `extract-structured` | resolver | project, schema, entityType, segment, requested json/reference fields | `StructuredExtractionSchema`: values with typed value and exact source span |

Schema metadata, IDs, version numbers, compatibility classification and decisions are engine-controlled. The representation audit runs before extraction and is never given extracted observations. An auditor cannot approve its own schema proposal. Invalid audit spans and foreign entity references produce quarantine findings.

## Evidence and identity

Source snapshots are content addressed. Parser/segment/schema/extraction-spec/provider identity and the prompt protocol participate in extraction cache keys. Retrying an unchanged source reuses source versions and immutable observations; completed record extractions are checkpointed even when no value exists. Each inferred observation records the model ID returned by its provider, rather than just the adapter name. Configure pinned model IDs and include model configuration in adapter names so model changes invalidate caches before the next call.

Each entity requires supported identity fields and declared applicability fields. Project-level scope supplements the record; it does not fabricate a source claim. Cross-source equality is exact normalized identity+scope, not fuzzy name matching. References remain explicit source identifiers and require domain-specific resolution policy if a canonical relation is needed.

Intact JSON/XML-derived record objects can map exact schema field names deterministically. An escape-aware scanner records exact JSON value spans. No coercion, aliases, positional array joins or nested lookalike keys are used. A structured record that matches multiple schema types is withheld with an identity finding until the ambiguity is resolved. Other inputs use the extractor. `json`/`reference` fields use an explicit structured reasoning task if the source was not deterministically mapped. Final publication revalidates all values against schema, including JSON Schema.

A null value is omitted, not converted into absence. Estimates and derived values are not created by this path. Truncated extraction results are withheld. Numeric values must occur as a numeric token in their cited passage; exact offsets alone cannot justify an unrelated number. The independent audit still checks whether a passage actually supports the field and its identity, units and qualifications. Disagreements preserve both values and are visible in the publication.

## Durability and budgets

Run state, source snapshots, findings, proposals, usage and completion checkpoints persist in the repository. Queued work is idempotent and leased. Side effects are checked against the live lease between stages. Publication and approval use real serializable database transactions, with bounded retry on serialization conflicts. No model or network call occurs inside those transactions.

Budgets cap sources, search calls, iterations and estimated spend per run. Provider calls reserve conservatively before execution, then settle reported cost where available or provider-estimated cost. Unknown call outcomes retain their reservation because a provider may have billed. The initial conservative preflight rates are $10/M input bytes and $50/M maximum output tokens for reasoning, $0.02/search and $0.01/acquisition (allowing a paid contents fallback). Extraction uses a conservative input estimate. These limits are application accounting controls, **not a guaranteed provider invoice ceiling**; changed provider pricing or unknown tokenization must be reconciled with recorded usage. Demo mode has zero-cost injected providers and no implicit network fallback.

Bootstrap audits every newly seen source/schema/provider combination. Subsequent runs include a deterministic 5% random sample keyed by run and source, plus all new combinations; explicit replay reaudits every selected source. This keeps apparently successful output in the audit population. Source-level failures retain original history and do not imply facts disappeared.

Parser repair uses explicit reparse, separately from schema replay. The engine verifies preserved bytes against their original hash and length, stores a new immutable parsed version, and advances the latest-source pointer only if the input version is still current. Acquired timestamps, headers and content-addressed bytes retain their original meaning. A failed or unusable parse leaves that pointer unchanged and fails the run with an actionable finding; unusable parsed output remains available for inspection. A parser that changes its output without changing its version is rejected. Reparse does not fetch the source, while any extraction and audit calls still use the normal provider budget.

## Deliberate boundaries

- There is no globally complete ontology or automatic certainty score. Coverage is scoped to the answerability contract and acquired source families.
- Parser repair and OCR remain acquisition work. Replaying a schema uses preserved segments; applying a repaired parser is an explicit `reparse` operation with versioned output.
- Provider requests can be repeated after an unknown remote outcome. Durable evidence effects are idempotent; billing cannot be exactly-once across a remote service without provider-side idempotency.
- An approved change is not automatically published. Existing schema-gap findings stay open until resolved by a reviewer or a later supported audit decision; approval is not evidence that a fix worked.
- Unresolved references are not silently fused into canonical entities. This release preserves explicit reference values and identity/scope; domain-specific reconciliation can be added through the schema/audit boundary.

## Verification

`pnpm --filter @deeplake/engine check`, `pnpm --filter @deeplake/engine test`, and `pnpm --filter @deeplake/engine build`. Integration tests use actual PGlite and content-addressed blobs, deterministic provider boundaries, history-preserving schema replay, restart and adversarial evidence/lease/budget scenarios. Live model accuracy is a separate evaluation.
