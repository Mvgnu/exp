---
name: providers
description: "Provider boundaries"
paths:
  owned: [packages/providers/src/, packages/providers/migrations/, packages/providers/README.md]
  tests: [packages/providers/test/]
exports: [see src/index.ts and src/contract.ts]
consumes: [see package.json]
verification:
  check: pnpm --filter @deeplake/providers check
  test: pnpm --filter @deeplake/providers test
  build: pnpm --filter @deeplake/providers build
bar:
  reference: "Exa Contents and Cloudflare Clairic official API"
  property: "The exact source text reaches extraction; unsupported or truncated output becomes a visible error instead of invented facts."
---

# Provider boundaries

Implement createExaSearch, createBraveSearch, createAnthropicReasoner, createClairicExtractor with frozen option interfaces. Exa search returns URLs, never summary evidence; contents text true, fresh maxAgeHours:0, no generated answer. Validate all responses; max bounded retries for transient errors, bounded timeouts and response sizes. Anthropic JSON schema/tool output validation per role with supplied model IDs; no tool execution from content. Clairic state+fields and optional text companion evidence per non-text field; reject guesses when value null, catch truncation, verify offsets and typed fields. Preserve reported token usage and estimated cost. Unsupported json/reference structures explicitly surfaced. APIs must allow injected HTTP transport for tests; credential strings never included in errors.

## Write gate

`src/contract.ts` and `package.json` remain PM-owned even inside the listed paths. Read `specs/00_engine.md` and `.agent/lop.md` / `.agent/gauntlet.md`. Any additional external dependency requires a PM manifest change. Own SPEC may be updated to report actual exports and limitations.

## Required verification

Meaningful adversarial tests and a usable integration surface; no mirror-only tests. Run the listed commands and `pnpm test:architecture` after integration. Record actual outcomes, disagreements, and remaining broken behavior. A fresh critic inspects real behavior.
