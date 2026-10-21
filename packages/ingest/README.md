# Acquisition and parsing

## Public acquisition

`createAcquirer(options)` fetches public HTTP(S) sources. `canonicalizeUrl` removes fragments and known tracking parameters, preserves meaningful queries, rejects credentials and non-web protocols. Acquisition checks every DNS result, rejects non-public/reserved networks (including IPv4-mapped IPv6), and pins the validated address into the actual socket's resolver. Every redirect and robots request passes the same guard. A hostname allowlist can narrow access but cannot authorize private addresses.

The fetcher honors robots by default, spaces requests per host, validates redirects, refuses HTTPS downgrades, bounds redirects/bytes/time and transient retries, and supports ETag/Last-Modified conditional requests. A 304 result is explicitly `notModified` with no new bytes. Robots errors fail closed and should be rescheduled. It does not bypass authentication or anti-bot challenges and does not run JavaScript.

## Parsed artifacts

`createParser(options)` supports HTML, XML, JSON, text, Markdown and PDFs with embedded text. HTML becomes a deterministic text artifact with headings and labelled table rows. Scripts/navigation are removed; each table row remains a separate record with column labels. Structured JSON/XML repeated object records become individual parseable JSON segments; wrapper metadata remains in segment context. XML DTD/entities are rejected.

Sibling HTML articles, list items and data-table rows keep independent boundaries. Markdown uses the Marked lexer to preserve ordered/unordered lists, nested items, blockquotes and GFM tables; no generated HTML is rendered. A nested list of distinct single `label: value` fields remains with its enclosing article or list item. Top-level items always remain separate, including items with different labels. Repeated sibling headings are separated at their own depth, and closed article/list/table headings cannot become the next record's context. Table records end before following prose; nested layout tables cannot combine inner data rows. Merged-cell tables retain their text but are blocked until a layout-aware extension can reconstruct their mapping. Literal fenced/indented code examples are also blocked pending explicit applicability review.

Parser implementation `deeplake-parser/1.2.0` invalidates the previous segmentation result. The returned version appends a stable fingerprint of effective `maxSegmentChars` and `maxPdfPages`; normalized equivalent settings share an identity. The runtime-only PDF timeout does not change successful output identity. Historical artifacts require an explicit reparse operation, not mutation. Structure cannot prove identity binding in arbitrary unstructured prose; repeated subsection headings or ambiguous field lists may conservatively fragment a record.

`ParsedDocument.text` is the canonical parsed artifact. Every segment's `start`/`end` selects its exact `text` from that artifact. Extraction evidence offsets are local to the segment. `context` is useful interpretation context, never a replacement for a quote inside the segment. Oversized sections/records are explicitly flagged; a chunk cannot be treated as a complete structured record.

Text PDFs use installed `pdfinfo` and `pdftotext` via argument arrays, in a private temporary directory cleaned in `finally`. Pages, process time, input/output size are bounded. Page numbers survive as segment metadata. PDF layout extraction is always flagged for audit, and pages with insufficient embedded text are marked as requiring OCR. There is no silent OCR fallback and no claim that a scanned page contains no facts. Empty/unsupported/broken inputs produce explicit diagnostics.

`enumerateCollection(document)` is synchronous and returns de-duplicated canonical URLs from sitemap XML, relevant HTML links and JSON URL/href records. It does not fetch those URLs itself. The caller owns relevance, frontier and source budgets.

## Installation and verification

Install Poppler for PDFs (`apt-get install poppler-utils` on Debian/Ubuntu, `brew install poppler` on macOS). The 35-test suite includes a generated text PDF processed by the real binaries and adversarial extraction that chooses the first identity and last quantity across list/table structures while requiring exact source spans. Network paths are tested with mocked transport/DNS, including address pinning, private redirects, robots and stream byte limits. A live corpus and OCR quality require a separate evaluation.

Run `pnpm --filter @deeplake/ingest check` and `pnpm --filter @deeplake/ingest test`.
