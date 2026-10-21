---
name: core
description: "Evidence semantics"
paths:
  owned: [packages/core/src/, packages/core/migrations/, packages/core/README.md]
  tests: [packages/core/test/]
exports: [see src/index.ts and src/contract.ts]
consumes: [see package.json]
verification:
  check: pnpm --filter @deeplake/core check
  test: pnpm --filter @deeplake/core test
  build: pnpm --filter @deeplake/core build
bar:
  reference: "W3C PROV-DM"
  property: "A reader can trace each published value through an observation to a source version and exact passage, without silently merging scope or losing disagreement."
---

# Evidence semantics

Stable canonical serialization, SHA-256 content hashes, stable identifiers, scope-sensitive entity identity, domain schema semantic validation, schema compatibility diff, evidence validation, conservative projection. Export stableStringify(value), hash(value:string|Uint8Array), stableId(prefix,...parts), entityId(projectId,type,identity,scope), validateDomainSchema(schema), diffSchemas(before,after), validateEvidence(evidence,segment), buildPublication(input). No silent estimates or null facts. For conflicts use value:null plus alternatives; identical values merge evidence. Publication must exclude wrong-schema, invalid-evidence, rejected or estimated observations. JSON fields validate their declared JSON schema.

## Write gate

`src/contract.ts` and `package.json` remain PM-owned even inside the listed paths. Read `specs/00_engine.md` and `.agent/lop.md` / `.agent/gauntlet.md`. Any additional external dependency requires a PM manifest change. Own SPEC may be updated to report actual exports and limitations.

## Required verification

Meaningful adversarial tests and a usable integration surface; no mirror-only tests. Run the listed commands and `pnpm test:architecture` after integration. Record actual outcomes, disagreements, and remaining broken behavior. A fresh critic inspects real behavior.
