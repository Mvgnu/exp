# Deeplake

**Turn a bounded topic into an inspectable, evolving knowledge base and a published discovery site.**

Deeplake discovers source URLs, preserves documents, proposes a domain schema, extracts scoped observations, audits what the schema missed, and reprocesses evidence after an approved schema change. Publication is explicit: experiments never silently replace the public dataset.

This is Magnus's evidence engine, unrelated to the similarly named vector database. The repository contains the engine, durable storage, provider adapters, API, worker, CLI, operator workbench, public catalog, deployment configuration, and a reproducible demonstration across two domains.

## Try it without API keys

Requirements: **Node.js 24+** and **pnpm 11.25.0**. Text PDF extraction additionally needs Poppler (`pdftotext` and `pdfinfo`). Browser verification needs Python 3 and Playwright Chromium.

```bash
git clone https://github.com/Mvgnu/exp.git
cd exp
pnpm install --frozen-lockfile
pnpm demo
pnpm dev
```

Open **http://localhost:3000** for the workbench. In another terminal, open the public catalog:

```bash
pnpm --filter @site/catalog dev --port 3001
```

Open **http://localhost:3001**. Both sites also build as static exports; neither requires a Next.js server in production.

The demonstration runs the actual parser, engine, repository, audit/proposal/replay workflow, and publication gate with deterministic adapters. It produces two clearly labelled **synthetic** collections: computer science curricula and municipal procurement. It includes two curriculum scopes for the same module, an approved prerequisite-rule schema change, a pending renewal-option proposal, and conflicting procurement values. The default UI reads this generated snapshot and does not pretend to make live changes.

### Use the local API and real mutation controls

```bash
pnpm cli init
pnpm cli demo --persist
pnpm api
```

`init` creates `.env` with random operator and database credentials and refuses to overwrite an existing file. In the workbench, choose **Connect API**, enter `http://127.0.0.1:4310`, and use `DEEPLAKE_API_TOKEN` from your `.env`. The local API embeds a worker and shares one PGlite database with it. The token is held in the browser session, never in the static export.

Stop the API before running a CLI command against that same local database. For separate API/worker processes, use PostgreSQL as described below.

## What is implemented

| Area             | Behavior                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery        | Answerability questions, source families, seed URLs, planned search queries, exploration queries, bounded collection enumeration and source budgets            |
| Acquisition      | Public-address validation and DNS pinning, robots rules, bounded redirects/bytes/time/retries, conditional fetching, immutable original bytes                  |
| Parsing          | HTML, Markdown, plain text, structured JSON/XML and text PDFs; source offsets, page metadata, quality warnings and structural record boundaries                |
| Extraction       | Typed schema compilation, deterministic structured mappings, Clairic scalar extraction, an explicit structured-reasoning path, exact evidence and value checks |
| Identity         | Entity identity and applicability scope participate in stable IDs; equal names in different curricula, years or lots remain separate                           |
| Audits           | Independent representation audit followed by extraction audit; acquisition, extraction, schema-gap, identity/scope and disagreement findings                   |
| Schema evolution | Evidence-backed proposals, compatibility analysis, explicit approval/rejection, stale-base protection, breaking-change acknowledgement and queued replay       |
| Reprocessing     | Schema replay over preserved segments; explicit reparsing of preserved original bytes after a parser upgrade; maintenance of changed sources                   |
| Publication      | Pinned schema and immutable release, current-source evidence, unsupported-value withholding, visible conflicting alternatives, explicit rollback               |
| Operations       | Durable jobs with leases and fencing, retry/cancel/recovery, usage ledger and transactional per-run reservations, event/run history                            |
| Interfaces       | Authenticated API, CLI, six-view workbench, configurable static public catalog with filters and source passages                                                |

### The evidence rule

A displayed value must survive the publication gate, not merely parse as a plausible JSON value. An observation retains source version, segment, exact quotation, offsets, entity identity, scope, schema version, parser version, model identity and extraction protocol. Invalid or unsupported claims are withheld. Conflicting supported values remain alternatives with no arbitrarily chosen winner.

A quotation establishes what a document says. It does not independently establish that the document is correct. Structural boundaries and deterministic checks reduce false binding; arbitrary prose and ambiguous concepts still require inspection and semantic audits. See [the architecture](docs/architecture.md) and [the quality record](docs/quality.md).

## Start a live topic

Set credentials in `.env` for:

- **Exa**, or Brave when `SEARCH_PROVIDER=brave`, for URL discovery.
- **Anthropic**, with separate planner, architect, auditor and resolver model settings.
- **Cloudflare Workers AI**, account ID and token, for `@cf/cloudflare/clairic`.

Model IDs and cost estimates are configurable in [.env.example](.env.example). A missing live credential causes an explicit error; it never switches a project to synthetic data. Set `EXA_CONTENTS_FALLBACK=true` to use Exa source text after eligible HTTP 5xx origin failures. Robots, authentication, private-address, rate-limit and size failures do not fall back. Such artifacts are labelled provider-extracted text rather than original HTTP bytes.

Create a project in the connected workbench, or use the CLI while the local API is stopped:

```bash
pnpm cli create \
  --name "Public research facilities" \
  --topic "Research facilities with publicly documented access conditions" \
  --question "Which facilities publish their access eligibility and equipment?" \
  --question "Which conditions vary by institution or program year?" \
  --url https://your-public-source.example/facilities/ \
  --max-usd 2
```

Replace the example URL with a real public source. The command returns a project ID. Then:

```bash
pnpm cli run PROJECT_ID
pnpm cli inspect PROJECT_ID
pnpm cli approve PROPOSAL_ID --reason "The evidence requires this representation."
pnpm cli replay PROJECT_ID
pnpm cli publish PROJECT_ID
pnpm cli export PROJECT_ID --out publication.json
```

Approval enqueues replay for a running worker. The direct CLI replay is useful when no worker is running; replay effects are idempotent. Review findings before publication. A new cycle, maintenance run, approval or replay does **not** publish automatically.

```bash
pnpm cli maintain PROJECT_ID
pnpm cli reparse PROJECT_ID
pnpm cli rollback PROJECT_ID PUBLICATION_ID
```

Budgets apply **per run**, with limits for queries, sources, iterations and estimated USD. Provider-reported usage is retained. Reservations prevent internal concurrent oversubscription; estimates cannot guarantee an external vendor's final invoice. Unknown remote outcomes can still incur charges before a job retries.

## Publish a niche catalog

The catalog consumes only a minimal `PublicDataset` bundle, never an operator snapshot:

```bash
node --import tsx scripts/import-catalog.ts publication.json
NEXT_PUBLIC_CATALOG_URL=https://catalog.example pnpm --filter @site/catalog build
```

Deploy `sites/catalog/out/` to any static host. Configure the name, facets and numeric fields in [sites/catalog/lib/catalog.ts](sites/catalog/lib/catalog.ts). The same site can display one or several domains by changing data and configuration; engine packages do not contain niche-specific behavior. Details have static URLs, source passages and release metadata. Synthetic datasets are marked `noindex` and excluded from the sitemap.

The workbench export is `sites/workbench/out/`. It contains only the checked-in synthetic demonstration; live operator state is fetched after an authenticated connection.

## Run with PostgreSQL and Docker

```bash
pnpm cli init                  # only if .env does not exist
docker compose up --build -d
```

The stack includes PostgreSQL, separate API and worker services, the workbench at **http://localhost:8080**, and the public catalog at **http://localhost:8081**. The API is at **http://127.0.0.1:4310**. Connect the workbench to that API with your operator token. A new deployment has an empty operational database; the static example remains available until you connect.

The published Docker catalog uses the data present at build time. Export a release, import it, and rebuild the catalog service to update it. Public internet deployment additionally needs your HTTPS reverse proxy, hostname/CORS configuration and backup policy. See [operations](docs/operations.md).

## Repository map

| Path                                  | Ownership and purpose                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/core`                       | Frozen Zod contracts, identity, compatibility, evidence validation and publication semantics |
| `packages/store`                      | PostgreSQL/PGlite repository, migrations, blob store, queue and budget ledger                |
| `packages/providers`                  | Exa, Brave, Anthropic and Clairic HTTP adapters                                              |
| `packages/ingest`                     | Safe source acquisition, parsing and collection enumeration                                  |
| `packages/engine`                     | Discovery, extraction, audits, proposals, replay, reparse and publication                    |
| `apps/api`, `apps/worker`, `apps/cli` | Composition and operator entry points                                                        |
| `sites/workbench`                     | Operator UI; static snapshot or authenticated API                                            |
| `sites/catalog`                       | Public, published-data-only site                                                             |
| `fixtures`                            | Labelled synthetic source documents and deterministic demo manifest                          |
| `specs`, `.agent`                     | Specs, contracts, Lop boundaries and Gauntlet rules                                          |
| `test`                                | Cross-domain architecture and rendered end-to-end checks                                     |

## Verify it

```bash
pnpm exec playwright install --with-deps chromium
pnpm check
pnpm test
pnpm test:architecture
pnpm demo
pnpm build
pnpm test:e2e
```

For the PostgreSQL multi-worker gate, set `TEST_DATABASE_URL` to a **disposable** database before `pnpm test`. Without it, the external-database test is visibly skipped; PGlite tests still run against actual SQL. CI provisions PostgreSQL and runs the complete gate. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` optionally selects an existing Chromium binary for restricted environments.

Tests cover immutability, restart persistence, conditional source changes, lease recovery and fencing, parallel budget reservations, schema approval/replay, exact-span rejection, scoped identity, disagreements, public/private data separation, API authentication, and both rendered sites. [docs/quality.md](docs/quality.md) records the executed gates and independent critiques without treating green tests as a quality verdict.

## Development workflow

This repository was specified before implementation and built with the requested **Lop + Gauntlet** process. Read [AGENTS.md](AGENTS.md), [the engine spec](specs/00_engine.md), [Lop](.agent/lop.md) and [Gauntlet](.agent/gauntlet.md). Builders own scoped paths in isolated worktrees; the PM owns shared contracts and integration. Fresh critics run real artifacts and return the largest remaining gap. Specs are authoritative about intended behavior; they are not evidence that the result is useful.

## Deliberate limits

There is no OCR, authenticated crawling, arbitrary browser automation, automatic legal/recognition judgment, or automatic production deployment. Text PDFs require Poppler. Source availability and live provider quality need a credentialed evaluation on your intended corpus. The workbench is a single-operator tool, not a multi-tenant authorization system. Full snapshots and static filtering are appropriate for bounded collections; large deployments should add paginated query/read models. The default blob store is a shared filesystem; object-storage support fits the existing `BlobStore` contract.

See [API reference](docs/api.md), [architecture](docs/architecture.md), [operations](docs/operations.md), and [quality/evaluation](docs/quality.md).
