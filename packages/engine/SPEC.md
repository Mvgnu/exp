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
