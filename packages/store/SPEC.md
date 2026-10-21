---
name: store
description: "Durable evidence and leased work"
paths:
  owned: [packages/store/src/, packages/store/migrations/, packages/store/README.md]
  tests: [packages/store/test/]
exports: [see src/index.ts and src/contract.ts]
consumes: [see package.json]
verification:
  check: pnpm --filter @deeplake/store check
  test: pnpm --filter @deeplake/store test
  build: pnpm --filter @deeplake/store build
bar:
  reference: "PostgreSQL SKIP LOCKED queue semantics"
  property: "A process can restart without losing evidence, a retry produces no duplicate records, and an expired worker cannot complete another worker’s lease."
---

# Durable evidence and leased work

Implement createStore(options): Promise<Repository> and FileBlobStore(directory). PGlite local/memory and pg production share SQL migration. Typed records validated with CollectionSchemas; immutable collections reject changed overwrite. Transactions are real, no in-memory pretend transaction. list is deterministic with pagination; where keys validated. Blob keys SHA-256 only and writes atomic. Durable jobs unique key, atomic claim, recovery, bounded retries, heartbeat/fence token, cancel. Budget reservations transactional and idempotent. Snapshot collects all records with actual jobs. Export store migrations and document production setup.

## Write gate

`src/contract.ts` and `package.json` remain PM-owned even inside the listed paths. Read `specs/00_engine.md` and `.agent/lop.md` / `.agent/gauntlet.md`. Any additional external dependency requires a PM manifest change. Own SPEC may be updated to report actual exports and limitations.

## Required verification

Meaningful adversarial tests and a usable integration surface; no mirror-only tests. Run the listed commands and `pnpm test:architecture` after integration. Record actual outcomes, disagreements, and remaining broken behavior. A fresh critic inspects real behavior.

## Implementation notes

Repository.transaction runs SERIALIZABLE on PostgreSQL and propagates a retryable conflict instead of repeating arbitrary callbacks. Nested transactions use savepoints. Production migration startup has a separate READ COMMITTED advisory-lock transaction. The optional TEST_DATABASE_URL test exercises multiple PostgreSQL connections; all normal tests use real embedded PGlite. A shared mounted filesystem is the implemented production BlobStore; S3 remains an interface extension.

## PostgreSQL concurrency verification

2026-10-21: the real PostgreSQL 18 multi-connection gate exposed a serialization conflict in simultaneous queue claims. Internal database-only operations now retry a complete transaction with bounded backoff; arbitrary caller callbacks still surface RetryableTransactionError. The regression requires both claim calls to succeed with distinct leases and both budget calls to complete, with exactly one reservation accepted. The focused external gate passed after the fix.
