# Verification and independent quality review

Recorded on 2026-10-21. This is the execution record for the initial Deeplake release. The repository was specified before implementation, built in scoped Lop worktrees, and revised after independent Gauntlet criticism. Passing tests and a useful interface are separate claims.

## Executed gates

| Gate                                                              | Observed result                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check`                                                      | Passed across all ten workspace packages/apps/sites and the tooling TypeScript configuration.                                                                                                                      |
| `TEST_DATABASE_URL=… pnpm test`                                   | Passed all 143 tests in 14 files, including the actual external PostgreSQL gate, the new public-projection boundary tests and all 12 catalog evidence tests.                                                       |
| `pnpm test:architecture`                                          | Passed all 3 architecture checks.                                                                                                                                                                                  |
| `pnpm demo`                                                       | Passed using the actual engine, parser and SQL repository: 2 synthetic projects, 18 sources, 242 observations and 3 immutable publications. One schema proposal is approved and replayed; another remains pending. |
| `pnpm build`                                                      | Passed both Next.js static exports. The catalog generated 23 build entries, including 17 record routes; the workbench generated its static entry and not-found output.                                             |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/chromium pnpm test:e2e` | Passed all 16 desktop/phone tests against served static exports and an actual Fastify API with a real PGlite repository.                                                                                           |
| `git diff --check`                                                | Passed before the final documentation commit.                                                                                                                                                                      |

The rendered checks cover catalog narrowing, numeric and scope constraints, URL reload, conflicting alternatives, both distinguishable source documents, exact highlighted context, empty/reset behavior, detail pages without JavaScript, workbench finding-to-source navigation, schema diffs, disabled demo mutations, and connected creation of a persisted live-mode project. Connection restoration is verified after reload; the operator token is not written to local storage.

Both site type checks were also repeated with their generated `.next` directories temporarily removed and incremental compilation disabled. They passed, so the pre-build CI check does not depend on a prior local Next.js build.

Tests exercise real SQL and blob storage with injected provider boundaries. They cover immutability, restart persistence, duplicate retries, changed sources, expired leases and fencing, concurrent budget reservations, cancellation, schema approval/replay, original-byte reparsing, concurrent operator changes, explicit ingest selection, exact-span rejection, scope separation, disagreement preservation, API authentication and public/private projection separation. Relevant suites live in [core](../packages/core/test/), [store](../packages/store/test/), [ingest](../packages/ingest/test/), [providers](../packages/providers/test/), [engine](../packages/engine/test/), [API](../apps/api/test/), [CLI](../apps/cli/test/), [catalog](../sites/catalog/test/), and [browser journeys](../test/e2e/).

### Execution environment and limits

The local gate used Node.js 24, pnpm 11.25.0, Poppler, PGlite and a disposable native PostgreSQL 18 server. The PostgreSQL gate was actually run; it was not accepted as a skipped test. It initially exposed a serialization conflict in concurrent internal transactions. Bounded retries now apply only to the repository's own database-only operations; arbitrary user transaction callbacks are not automatically rerun.

The standard browser download endpoint was unavailable in this environment. Rendered verification used an actual Chromium 153 executable through the documented optional Playwright executable setting. An initial single-process launch option caused subsequent browser contexts to exit; removing that option restored normal multi-context execution. One mobile assertion began before session restoration was ready; successful API responses and three isolated reruns established that state was saved. The final test explicitly waits for the restored snapshot response and the complete 16-test run passed.

Docker was not installed in the local execution environment. [CI](../.github/workflows/verify.yml) provisions PostgreSQL, runs the full verification sequence, validates Compose configuration and builds the catalog Docker target. Local Docker execution is not claimed here. No paid live provider calls or production deployment were performed.

## Gauntlet: evidence binding and repair

**Bar:** the W3C PROV-DM traceability property in the core spec: trace a published value through its scoped observation to the exact source version and passage without merging applicability or hiding disagreement.

A separate critic exercised the actual engine, parser, Clairic HTTP adapter, core publication gate, durable PGlite repository and content-addressed originals. Provider responses were deliberately injected and adversarial. The critic did not edit implementation files or evaluate a builder's report.

| Round           | Largest gap and response                                                                                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — failed      | Sibling HTML article records could be merged, allowing a correctly quoted value to bind to the wrong record. The parser gained explicit structural record boundaries.                                                                                                                      |
| 2 — failed      | HTML lists and Markdown numbered lists still merged records. Parser repair also needed a lifecycle separate from schema replay. The parser was revised using structural HTML handling and a Markdown lexer; explicit original-byte reparse was specified and implemented.                  |
| 3 — scoped pass | Thirteen adversarial structures were exercised. Eleven supported structures published the correct A1/2026/10 and B1/2027/20 pairings. Ambiguous merged-cell tables and literal code examples were blocked. All exact-span checks passed; 11 releases and 66 observations survived restart. |

The critic then copied the database that had actually failed in the prior round and repaired it from preserved originals. Acquisition was configured to throw, proving that the repair did not refetch the source. New parser versions and releases survived restart; old source versions, segments and published releases remained unchanged. Parser 1.2.0 includes output-affecting options in its identity so different segmentation settings cannot silently share a parser version.

The record-binding regressions are retained in the ingest and engine test suites. The pass applies to the tested structures and repair path. It does not establish that arbitrary prose or live models always bind entities correctly.

## Gauntlet: rendered interfaces

**Workbench bar:** Linear's issue workflow and OpenAlex entity detail, specifically finding the important unresolved issue, inspecting exact evidence and reaching an action in at most three navigations, with URL state surviving reload.

**Catalog bar:** OpenAlex works search, specifically narrowing records, inspecting a value's source and understanding disagreement without marketing copy.

The critic inspected actual exported pages at 1440×900 and 390×844, drove filtering and evidence journeys, and viewed the resulting screenshots. Reachable OpenAlex search/detail pages and Linear's public filters documentation were inspected as references. This was a direct reference review, not a blinded A/B study or an authenticated Linear workspace comparison.

The first interface round passed the scoped workbench read journey and failed the catalog. The conflict display showed only `740000` and `780000` under repeated titles, dates and hostnames. It established disagreement without letting a visitor identify or inspect the two documents.

The resulting amendment added a shared validated public projection with only release-cited parsed passages. The catalog now exposes distinct document paths and immutable versions, heading/page/segment locators, local preserved context and exact highlighting. Synthetic documents remain explicitly labelled and do not rely on dead `.example` links. Older projections without context state that limitation. Only validated matching offsets receive a highlight. Known scope keys use schema field labels; unknown project scope keys receive readable fallback labels.

**Final round: scoped pass.** The independent critic repeated the filtering and conflict journey on both viewports and inspected both local source passages. The source paths `/notices/1` and `/notices/6`, their different immutable versions, the common notice reference `DL-2026-101`, authority and year, and the exact highlighted values made applicability and disagreement inspectable. Workbench project/search/finding-type/detail state survived reload, and the finding → context → connection path still took three interactions. Neither reviewed path overflowed on phone.

The critic's whole-site smoothing judgement also passed: the workbench's unresolved operational finding and the catalog's qualified published record preserve the same uncertainty and use a coherent value-to-highlighted-context interaction. Connected mutations were outside that critic's static-artifact review; they were separately verified by the actual API browser tests. This is a pass for the named journeys, not a claim that every possible domain, source or operator task was evaluated.

## Engine onboarding drill

A fresh critic created a third synthetic domain, **public observatory instruments**, in an isolated throwaway site. Starting from the specs, contracts and package READMEs, the critic used the actual engine, parser, PGlite repository and blob store, with explicit fixture-only adapters. Unknown URLs/tasks threw; search threw if called; there were no network fallbacks or paid calls.

The final drill completed schema bootstrap, explicit ingestion, publication, catalog configuration, static export and desktop/phone browser journeys with **zero edits under `packages/`**. It produced 3 published records from 2 source versions and 3 parser segments, backed by 21 exact-span observations. Structured JSON used deterministic mapping; Markdown used one injected extractor call. The same `RIDGE-40` instrument remained distinct in seasons 2026 and 2027, retaining its correct 400 mm and 450 mm apertures.

Only the throwaway site's data, facet/numeric configuration, introductory/disclaimer copy and external TypeScript base-config path changed. No component behavior, CSS or engine/package changes were required. At 1440 px and 390 px, filters, numeric thresholds, reload, empty/reset, exact detail evidence and collection navigation passed with no overflow or page errors. A minor raw-scope-label issue found by the drill was subsequently corrected in the public site.

The empty finding list came from deterministic fixture audit responses. It is evidence of configurability and data flow, not live audit accuracy.

## Release limits

The bounded, single-operator implementation is the shipped scope. OCR, authenticated crawling, arbitrary browser automation, legal/recognition judgments, large-corpus paginated read models and multi-tenant authorization are not implemented. A shared filesystem is the supplied blob backend. Static catalogs require export/import/rebuild when a new release is selected.

Provider credentials and a measured corpus evaluation are required before making claims about live discovery recall, extraction accuracy, semantic audit quality, cost efficiency or source freshness. Budget reservations use configured estimates and cannot guarantee an external invoice. Search summaries are never evidence, and a quoted source statement is not independent proof of its truth.

These limits are explicit scope decisions, not substitutes for an unrun check. See [the engine spec](../specs/00_engine.md), [operations](operations.md), [API reference](api.md), [Lop](../.agent/lop.md) and [Gauntlet](../.agent/gauntlet.md).
