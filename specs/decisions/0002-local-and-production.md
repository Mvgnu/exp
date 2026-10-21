# ADR 0002: one PostgreSQL dialect, two execution modes

Accepted. Production uses PostgreSQL through pg, with separate API/workers. Local development uses PGlite embedded in one API process and the same SQL migration. The local database is never concurrently opened by the standalone worker/CLI. Blob bytes use SHA-256 addressed filesystem storage, compatible with a shared mounted volume. The repository interface supports an object store adapter without exposing storage to domain packages.

Next.js static exports provide operations and public reading surfaces; the workbench can connect to the authenticated API. Offline workbench uses a checked-in generated demonstration snapshot. There is no fake backend and no implicit live API expenditure.
