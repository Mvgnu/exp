# Deeplake: universal evidence engine

Status: implementation contract, 2026-10-21. Owner: PM. This is Magnus's Deeplake project, unrelated to the similarly named vector database.

## Product

Turn a bounded topic into a source-backed, evolving knowledge base and a useful public discovery product. The engine repeatedly discovers sources, snapshots evidence, proposes a domain schema, extracts scoped observations, audits representation and extraction, revises schemas, and publishes immutable projections. A source is evidence of what its publisher stated, not an automatic statement of truth.

The operator must be able to start a topic, see what happened, inspect a claim against its exact source passage, distinguish five failure classes, review an evidence-backed schema change, replay affected sources, and publish a stable version without overwriting historical evidence.

## Architecture and boundaries

`core` (contracts, deterministic semantics) ← `store` (durable records, jobs, blobs); `core` ← `providers` (Exa, Brave, Anthropic, Clairic) and `ingest` (safe acquisition and parsing); `engine` composes those packages. Apps compose engine; sites only import core contracts and published/read models. No network/DB import in a site's client bundle. No site/domain words or fixture heuristics in engine packages. All domain-specific fixtures and deterministic demonstration providers belong in `fixtures/` and `apps/cli/`.

Use pnpm, TypeScript strict mode, Zod runtime boundaries, Next.js 16 static exports. PostgreSQL is the multi-worker production backend; PGlite is the single-process local backend using the same migration and repository. The local API embeds one worker; do not open its PGlite directory from another process. Production runs API and worker separately against PostgreSQL. Original bytes live in a content-addressed blob store. A relational evidence graph is sufficient; no separate graph database is required.

## Frozen public contracts

`packages/*/src/contract.ts` and all manifests are PM-owned. Implementations import the lowest owning package's types. A contract defect is raised to the PM, never worked around with parallel types or casts. Each package exports its contract through its root index. Paths and scopes are in each package's SPEC.md.

## Invariants

1. Original source versions, parsed segments, schemas, observations and publications are immutable. Re-fetches and interpretations create new records; identical retries are idempotent.
2. A claim includes project, entity type/identity, scope, source version, parser/model/schema/spec versions, exact evidence location and extraction mode. Null means unresolved/missing, never proof of absence. Estimates cannot enter the asserted-fact path.
3. Domain schemas contain entities, fields, units, cardinality, identity and applicability. They compile into extraction requests; they are not one giant extraction call. Unsupported structured fields go to an explicitly identified structured reasoning path or become a visible finding; never silently disappear.
4. Context follows each record segment. Parallel arrays are not entity binding. Scope participates in identity and comparison; different model years/curricula/lots must not be merged by name.
5. Audit classes are acquisition, extraction, schema_gap, identity_scope and disagreement. Every finding cites evidence and an action. Representation discovery examines source text before extraction output; extraction audit checks the existing representation.
6. Schema proposals are inert until approval; breaking changes require explicit operator approval. Approval checks the current base version, validates the candidate, records a decision and creates conservative replay jobs. Never overwrite source history or automatically publish experiments.
7. Publication is an explicit operation over validated observations under an approved schema, with unresolved disagreements visible and unsupported values withheld. The published schema and release are pinned and rollback changes a pointer, not history.
8. All jobs are durable, idempotent, leased and fenced; bounded retries and terminal failure remain visible. Expired leases recover; stale workers cannot complete a replacement worker's job.
9. Search and token/source/iteration budgets bound execution. Search is for URLs; generated search summaries are not evidence. Preserve provider identity, reported usage and estimated cost separately.
10. Fetched documents are untrusted data. They cannot supply credentials, alter instructions, approve migrations or select tool calls. Public fetches reject local/private/reserved addresses, credentials and redirect escapes; limits apply to bytes, time, redirects and PDF parsing. Credentials remain server-side.

## Loops

Discovery: answerability contract → query objectives and exploration reserve → URL frontier → known collection enumeration → diverse source sample → schema bootstrap → expand under budgets.

Interpretation: snapshot → parse/quality report → record segmentation → compile → deterministic structured mappings / Clairic / explicit structured LLM → evidence/type checks → observations → independent representation and extraction audit → findings.

Evolution: finding → proposed schema → compatibility and regression assessment → operator decision → affected-source replay → candidate projection → explicit publication. Maintenance uses conditional fetch/content hashes first and reprocesses changed source versions; model routing is optional, not the sole skip gate.

Parser evolution is an explicit `reparse(projectId, sourceVersionIds?)` operation, separate from schema replay. With no IDs it selects only each source's current version. It reads preserved original bytes without network access, creates an immutable parsed version keyed by content hash and parser version, preserves old segments, and interprets usable new segments under the current approved schema. A historical reparse must never move a source's latest pointer backward. Failed or unusable parsing leaves that pointer unchanged and records an actionable finding. Parser behavior changes require a parser version change. Reparse never publishes automatically.

## Model allocation

Exa Auto for URL discovery, optional Lite and Brave; original fetch first and optional Exa text contents fallback after eligible HTTP 5xx origin failures. Policy/authentication/private-address/rate-limit/size failures must never invoke fallback; provider-extracted text retains its distinct provenance. Exa answers/summaries are never used. Cloudflare `@cf/cloudflare/clairic` extracts explicitly stated values with companion evidence. Anthropic model IDs are configuration: planner, architect, auditor, resolver. Defaults documented from current official docs, overridable independently. Clef is deferred until measured routing savings justify it. Offline demonstration providers are explicitly labelled and never silently substitute for a missing live credential.

## Required usable surfaces

Workbench: overview/projects, source frontier and document evidence, schema versions/proposals, actionable audit findings, run/job history and budget use, publication explorer with URL-persistent filters, connection/configuration and project creation. All buttons perform a real operation or explain the unavailable prerequisite; no pretend scheduling.

Public catalog: thin configurable Next.js site reading a published projection, faceted search with URL persistence, entity detail with sources and caveats, crawlable static entity pages. A second domain must require data/config only, not package edits.

Public projection provenance includes the metadata of contributing source versions and only the parsed segments explicitly cited by the pinned publication. The catalog exposes source identity, a passage locator and preserved context with exact highlighting, including for offline synthetic fixtures. Operator events, unpublished observations, unrelated segments, original blobs and credentials do not enter this export.

## Acceptance

`pnpm check`, `pnpm test`, `pnpm test:architecture`, `pnpm demo`, `pnpm build`, `pnpm test:e2e`. Integration evidence must include duplicate retry, restart-safe state, source change, schema gap → proposal → approval → replay, blocked unsupported claim, two scopes, disagreement preservation, invalid evidence rejection, expired lease fencing, budget exhaustion, API auth and a second domain.

Fresh critics inspect built/served artifacts and exercise behavior. Every round reports one largest gap. The final PM record lists unresolved gaps honestly. Live provider quality is not certified by mock tests; live calls require credentials and a separately measured eval.

## Scope boundaries for this release

Deliver the complete runnable engine, local demonstration, adapters, operations/API/CLI, both sites, deployment configuration, CI and evaluations. Do not pretend synthetic fixtures are a real corpus. OCR, authenticated crawling and domain-specific legal/recognition judgements are extension points; text PDFs and structured/HTML sources are supported. No automatic deployment or paid corpus crawl occurs as part of repository creation.
