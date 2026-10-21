---
name: engine
description: "Discovery, audit, replay, publication"
paths:
  owned: [packages/engine/src/, packages/engine/migrations/, packages/engine/README.md]
  tests: [packages/engine/test/]
exports: [see src/index.ts and src/contract.ts]
consumes: [see package.json]
verification:
  check: pnpm --filter @deeplake/engine check
  test: pnpm --filter @deeplake/engine test
  build: pnpm --filter @deeplake/engine build
bar:
  reference: "Temporal replay principles and OpenAlex provenance browsing"
  property: "An operator can discover a representation gap, approve one versioned change, replay original evidence and publish the improved view while history and a second domain continue to work."
---

# Discovery, audit, replay, publication

Implement createEngine(dependencies):Engine and createProject(input,clock?):Project. Complete bounded search/bootstrap/ingest/extract/two-stage audit/proposal/approval/replay/publish loops with visible runs/events/usage/findings. Live schema bootstrap uses diverse samples and answerability. All model output validated via Zod. Extraction per record segment/type with identity and scope, compiled field instructions; safe evidence validation; no null/estimate publication. LLM representation audit first sees source/schema but not extracted values, second checks source/schema/observations. Schema gap finding may yield evidence-backed proposed candidate; unsupported concepts never disappear. Approve checks base version, explicit breaking flag, validates candidate, saves immutable schema, updates project and enqueues conservative replay. Maintain hashes/conditional fetches; duplicate extraction key includes schema/parser/model/spec/segment source. Source/family and query/source/iteration/cost budgets. Model roles/task contracts must be documented for deterministic demo providers. Public projection through core.buildPublication; no publication side effect in ordinary runCycle. Rollback pins earlier same-project release. Job executor propagates failures for retry, logs run state. Export helper workflow schemas as needed but do not alter contract.ts without PM.

## Write gate

`src/contract.ts` and `package.json` remain PM-owned even inside the listed paths. Read `specs/00_engine.md` and `.agent/lop.md` / `.agent/gauntlet.md`. Any additional external dependency requires a PM manifest change. Own SPEC may be updated to report actual exports and limitations.

## Required verification

Meaningful adversarial tests and a usable integration surface; no mirror-only tests. Run the listed commands and `pnpm test:architecture` after integration. Record actual outcomes, disagreements, and remaining broken behavior. A fresh critic inspects real behavior.

## Implemented public surface

Exports `createEngine`, `createProject`, `BudgetExceededError`, `LeaseLostError`, `WorkflowError`, `extractStructuredRecord`, runtime reasoning-task schemas, task names and the untrusted-evidence prompt. Contract exports remain unchanged. The engine consumes the complete core deterministic helper surface, Repository/BlobStore, injected capability interfaces, and ingest canonicalization/collection enumeration.

The PM-approved additive `Engine.reparse` contract applies the configured parser to verified preserved bytes, selects current versions by default, stores immutable parsed history, checks the source pointer inside a serializable transaction, rejects same-version parser behavior drift, and reinterprets under the approved schema. Historical reparsing never regresses a current source pointer. Failed/unusable parsing leaves the pointer intact and reports a failed run with an actionable acquisition finding. Publication remains explicit.

Explicit ingest processes only its requested canonical URLs, including duplicate/fragment normalization. It leaves unrelated registry sources pending. Cycle and maintenance continue to process the broader known frontier.

## Verification record

2026-10-21: domain typecheck/build passed and 25 real-store integration/adversarial tests passed. Tests cover discovery → schema gap → approval → replay → publication, preserved raw/version history, unchanged retry deduplication, source changes, scope separation, disagreement, stale/breaking approval, rollback version monotonicity, budget/source caps, invalid audit quarantine, missing identity, lease cancellation, database restart, escape-aware JSON evidence offsets, numeric-value grounding, ambiguous structured types, actual model lineage, and sibling HTML article/list plus Markdown numbered-list/table records through the real parser and publication. Reparse tests cover durable jobs, no source acquisition, preserved publication/history, current-only defaults, historical pointer guards, repeated reparse deduplication, parser failure/unusable output, parser-version drift rejection, cancellation before persistence, and truthful cancellation events without overwriting a replacement worker's run. A controlled real-store interleaving verifies that run status updates preserve concurrent schema approval, public rollback, and pause. The article regression failed against parser 1.0.0; list/table cases failed against 1.1.0; all pass against versioned parser 1.2.0. Root architecture/build gates run after PM integration.

The approved ingest-scope follow-up passed typecheck/build and its focused durable-store regression: the acquisition boundary receives only the selected canonical URL, an unrelated known source remains pending, and subsequent maintenance fetches both. The root combined gate includes this additional test (26 engine tests total).

## Explicit remaining limits

Provider-cost preflight uses conservative estimates; recorded usage is reconciled but is not a guaranteed invoice ceiling. Provider calls can repeat after unknown remote outcomes; immutable evidence effects are idempotent. Schema replay uses preserved parser segments; a parser upgrade requires explicit reparse with a versioned parser. An approved proposal does not automatically resolve audit findings or publish. References remain explicit source identifiers; ambiguous canonical linkage is withheld for domain-specific resolution rather than guessed.
