# Operations

## Modes

| Mode                 | Store and worker                            | Intended use                                                |
| -------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| Static demonstration | Generated synthetic JSON; no API needed     | Inspect the workflow and public catalog without credentials |
| Local connected      | PGlite on disk; API embeds one worker       | One operator on one machine                                 |
| PostgreSQL           | External database; separate API and workers | Durable deployment and concurrent workers                   |

`pnpm demo` runs an isolated in-memory pipeline and writes only the two static demonstration datasets. `pnpm cli demo --persist` seeds the configured operational database. It refuses to add demo data to a database containing live projects. It does not replace an existing live corpus.

## Configuration

Run `pnpm cli init` to create a private `.env` from the template. The initializer refuses overwrites. `process.loadEnvFile` loads this file for CLI/API/worker entry points; exported environment variables can configure deployments.

| Setting                                                                                    | Purpose                                                                             |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `DEEPLAKE_DATA_DIR`                                                                        | Local database and content-addressed blob directory                                 |
| `DATABASE_URL`                                                                             | PostgreSQL URL; empty selects PGlite                                                |
| `DEEPLAKE_API_TOKEN`                                                                       | Random operator bearer token, minimum 24 characters                                 |
| `DEEPLAKE_HOST`, `DEEPLAKE_PORT`                                                           | API bind address and port; default localhost:4310                                   |
| `DEEPLAKE_CORS_ORIGINS`                                                                    | Comma-separated exact workbench origins                                             |
| `SEARCH_PROVIDER`                                                                          | `exa` or `brave`                                                                    |
| `EXA_API_KEY`, `EXA_SEARCH_MODE`                                                           | Exa credentials and `auto`/`lite` mode                                              |
| `EXA_CONTENTS_FALLBACK`                                                                    | Explicit Exa source-text fallback after eligible origin 5xx failures; default false |
| `BRAVE_API_KEY`                                                                            | Brave search credentials                                                            |
| `ANTHROPIC_API_KEY`                                                                        | Reasoning provider credentials                                                      |
| `MODEL_PLANNER`, `MODEL_ARCHITECT`, `MODEL_AUDITOR`, `MODEL_RESOLVER`                      | Independent role model IDs                                                          |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`                                            | Workers AI account and token                                                        |
| `LLM_INPUT_USD_PER_MILLION`, `LLM_OUTPUT_USD_PER_MILLION`, `CLAIRIC_INPUT_USD_PER_MILLION` | Configurable cost estimates, not guaranteed prices                                  |
| `DEEPLAKE_USER_AGENT`                                                                      | Crawler identity; configure a real contact URL                                      |
| `NEXT_PUBLIC_CATALOG_URL`                                                                  | Public catalog origin at static-build time                                          |

Review supported model IDs and your account permissions before live evaluation. Provider adapters fail explicitly on unavailable or malformed responses. No provider secret is a `NEXT_PUBLIC_` setting.

## PostgreSQL deployment

The checked-in Compose stack uses PostgreSQL 18, a shared blob volume, independent API/worker containers and Nginx static hosts. Startup waits for the database health check. Migrations are checksum verified and serialized across service startup; add a migration instead of modifying an applied one.

```bash
docker compose up --build -d
docker compose logs -f api worker
docker compose ps
```

The stack binds operator/public development ports to loopback. Place your chosen HTTPS reverse proxy in front of services for public hosting. Set workbench/API origins explicitly, and keep the operator token out of URLs and committed configuration. There is no built-in multi-user role system.

To seed the demonstration into an empty Docker database:

```bash
docker compose exec api pnpm cli demo --persist
```

Unlike PGlite, PostgreSQL supports the CLI and API in separate processes. A live setup can create a project directly through the connected workbench.

To refresh the public catalog from a published live release, export its minimal public bundle, run `scripts/import-catalog.ts`, and rebuild the catalog image. Do not copy `WorkspaceSnapshot` into a publicly hosted file.

## Local ownership

The API and its embedded worker share one local repository instance. Stop the API before using CLI commands that open the same PGlite data directory. A directory lock rejects a second owner and can recover a dead process's lock on the next open. An unreadable lock is an explicit error requiring inspection, not automatic deletion.

## Recovery

- A crashed worker's lease expires. Another worker may claim the job with a new fencing token and bounded remaining attempts.
- Repeated internal writes have stable IDs and cannot mutate immutable evidence. A provider request with an unknown remote outcome can still be billed twice when retried.
- Cancel a job through the workbench or API. Cancellation invalidates the lease; it cannot retract an already-sent provider request.
- Review terminal failures and their run events before enqueueing new work. Budget exhaustion is a visible run state, not an empty success.
- A schema approval queues replay. A parser upgrade requires explicit **reparse** of stored originals. Failed reparse does not move the source's current version.
- Roll back a publication by selecting a previous release. No data deletion is needed.

## Backups

PostgreSQL records and the blob volume form one evidence system. Back up both. A database backup without preserved bytes cannot support reparsing or original downloads.

For PostgreSQL, use your normal `pg_dump`/restore or managed-database backup procedure and a coordinated snapshot of the blob volume. For local PGlite, stop the process and copy the whole configured data directory, including `db` and `blobs`. Test restoration into a separate location before relying on backups. Never delete blobs based only on the currently published release: historical observations and releases reference them.

There is intentionally no destructive cleanup/retention command in this release. Add one only with reference accounting and an explicit retention policy.

## Capacity and observability

The workbench reads a full authenticated snapshot. The catalog filters a static published collection in the browser. These are useful for bounded niche datasets; large corpora need paginated server read models, incremental site generation or a search index. The engine's separation of evidence and published projection allows those changes without rewriting observations.

Inspect runs, events, findings, jobs and usage in the workbench. Original bytes are content addressed and verified on read. Provider errors are sanitized rather than returning raw credential-bearing request material. There is no pretend scheduler: maintenance is explicit through API/CLI, and an external scheduler can enqueue it later.

## Verification and live evaluation

CI provisions a disposable PostgreSQL database and runs check, unit/integration tests, architecture tests, deterministic demo regeneration, both static builds and desktop/mobile browser journeys. The local development workflow can additionally set `TEST_DATABASE_URL` to exercise actual multi-connection behavior.

Credential-free verification does not measure live search recall, extraction precision, PDF layout diversity, provider latency or real spend. Use the evaluation protocol in [quality.md](quality.md) before expanding a paid corpus crawl. No deployment or paid crawl is performed merely by creating this repository.
