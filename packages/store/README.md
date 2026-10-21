# @deeplake/store

One PostgreSQL schema for local and production evidence, runs, jobs and budget reservations. This is durable storage, not a memory-only queue behind an SQL-shaped interface.

```ts
import { createStore, FileBlobStore } from '@deeplake/store';
const repository = await createStore({ dataDir: '.deeplake/db' });
const blobs = new FileBlobStore('.deeplake/blobs');
// Production: createStore({ databaseUrl: process.env.DATABASE_URL })
// Isolated tests: createStore({ memory: true })
await repository.close();
```

## Local ownership and production concurrency

PGlite is a single-process PostgreSQL runtime. The API and its embedded worker share one Repository. A directory lock rejects another local owner; a dead process's lock can be recovered on the next open. Do not run a standalone worker against the same PGlite directory. PostgreSQL is required when the API and workers are separate processes.

Production connections use a bounded pg pool. Root `Repository.transaction` callbacks run at **SERIALIZABLE** isolation and must contain database-only state transitions. Serialization or deadlock conflicts become `RetryableTransactionError` (`retryable=true`, `DEEPLAKE_SERIALIZATION_CONFLICT`); retry the whole state transition against fresh data. The repository never automatically re-executes an arbitrary callback. Nested transactions use savepoints. Transaction handles become invalid when their callback ends.

Checked-in migrations are checksum-verified. Startup serializes PostgreSQL migrations with an advisory transaction lock under READ COMMITTED; normal application transactions remain SERIALIZABLE. Editing an applied migration is refused. Add the next migration instead.

## Records

Every write and read is validated through the collection's Zod schema. A mutable write returns its revision; `expectedRevision` implements compare-and-swap, with revision zero meaning create only. Identical retries return the existing revision. IDs cannot be moved between projects. Immutable collections refuse changed overwrite even inside a transaction. `insertOnly` allows an identical retry and rejects replacement.

`list` has project filters, validated top-level JSON filters and deterministic insertion/ID ordering. `limit` and `offset` are optional; callers doing a full snapshot should consider dataset size. `snapshot()` reads a consistent transaction and includes actual queued/leased/terminal jobs.

## Queue

The `(projectId, key)` pair is an idempotency key. Reusing it with different kind/payload/attempt policy is an error. Claims atomically select ready work with `FOR UPDATE SKIP LOCKED`; each claim gets a new random fencing token and increments the attempt. Heartbeat, completion and failure all require the current unexpired token. Cancellation invalidates it. Expired leases can be reclaimed; a final expired attempt becomes a visible terminal failure. Failure stores a bounded error and schedules a bounded-delay retry until `maxAttempts` is reached.

A fence protects queue state, not arbitrary external side effects. The engine still must give its writes deterministic identities and perform schema/publication changes transactionally. Workers should heartbeat long operations and abort publication if lease ownership is lost.

## Budget ledger

Budgets are scoped to a run, not the lifetime of the project. Reserve an estimated maximum before invoking a paid provider. Reservations are transactional, idempotent and cannot concurrently oversubscribe the run. Settle them with actual/estimated provider usage after a call. Settlement is immutable; repeated identical settlement is safe. If the provider reports an unexpected overrun, the ledger preserves it truthfully and denies later reservations. This is an accounting gate, not a guarantee about an external provider's billing.

## Blob storage

`FileBlobStore` accepts only SHA-256 keys, shards files by the first two characters, writes temporary files and atomically renames them, and verifies bytes when read. The store never interprets user input as an arbitrary filesystem path. Production workers require the same mounted blob volume; an S3 implementation can implement the frozen `BlobStore` interface later.

## Tests

The normal suite executes real PGlite SQL, transactions, immutable/CAS behavior, restart and exclusive ownership, queue fencing, retry/cancel/expiry, concurrent budget reservations and blob integrity. Set `TEST_DATABASE_URL` to a disposable PostgreSQL database to run the additional multi-connection queue/budget gate. Without it, that test is explicitly skipped rather than counted as a production concurrency pass.
