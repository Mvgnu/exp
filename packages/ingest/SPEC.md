---
name: ingest
description: "Safe document acquisition and segmentation"
paths:
  owned: [packages/ingest/src/, packages/ingest/migrations/, packages/ingest/README.md]
  tests: [packages/ingest/test/]
exports: [see src/index.ts and src/contract.ts]
consumes: [see package.json]
verification:
  check: pnpm --filter @deeplake/ingest check
  test: pnpm --filter @deeplake/ingest test
  build: pnpm --filter @deeplake/ingest build
bar:
  reference: "Exa full contents and Poppler text extraction"
  property: "A document retains meaningful section/table context and exact text spans, and malformed/scanned inputs cannot quietly become empty factual records."
---

# Safe document acquisition and segmentation

Implement createAcquirer(options), createParser(options), canonicalizeUrl(url), enumerateCollection(document). Public HTTP fetch DNS resolves and pins safe addresses including redirect and robots requests, rejects private/loopback/mapped/reserved IPs and credentials; bound time bytes redirects retries. Per-host spacing and robots policy. Conditional ETag/Last-Modified handling. HTML removes boilerplate/scripts, preserves tables/headings/links, typed JSON and XML deterministic representations, text/markdown and PDF via pdftotext (no shell, timeout, temp cleanup); report scanned/empty/unsupported. Segment at repeated-record boundaries and preserve document context/offset/page maps; no cross-record mixing. Enumerate sitemaps/XML and relevant HTML collection links deterministically. No domain names or fixture content in implementation.

## Write gate

`src/contract.ts` and `package.json` remain PM-owned even inside the listed paths. Read `specs/00_engine.md` and `.agent/lop.md` / `.agent/gauntlet.md`. Any additional external dependency requires a PM manifest change. Own SPEC may be updated to report actual exports and limitations.

## Required verification

Meaningful adversarial tests and a usable integration surface; no mirror-only tests. Run the listed commands and `pnpm test:architecture` after integration. Record actual outcomes, disagreements, and remaining broken behavior. A fresh critic inspects real behavior.

## Implemented surface and limits

Exports: createAcquirer, createParser, canonicalizeUrl, enumerateCollection (synchronous), AcquisitionError, PARSER_VERSION and contract types. 35 tests cover SSRF/pinned DNS, conditional fetch, robots, body limits, heading/article/list/table record boundaries, structured JSON/XML, sitemap/API collections, immutable option-aware parser identity and a real Poppler PDF execution. Parser 1.2.0 isolates sibling articles, repeated headings at every depth, list items and data-table rows; prior structural siblings cannot become current-record context. Markdown uses the Marked lexer, including nested/quoted/loose lists and GFM tables. Nested lists of distinct singular fields stay inside their enclosing record. Merged-cell tables and literal code examples are blocked for explicit reconstruction/applicability review. Effective maxSegmentChars/maxPdfPages participate in the returned parserVersion fingerprint. Arbitrary unstructured prose remains semantically ambiguous; conservative segmentation may fragment a record. Scanned pages require an OCR extension; PDFs with embedded text remain flagged for layout audit. JavaScript-only pages require a separately authorized rendering/acquisition adapter.
