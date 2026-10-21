# API reference

Default local address: `http://127.0.0.1:4310`. Run `pnpm cli init` once, then `pnpm api`. Except for health and the published dataset route, every endpoint requires:

```http
Authorization: Bearer YOUR_DEEPLAKE_API_TOKEN
Content-Type: application/json
```

Request bodies are validated with Zod. The server bounds body size, rate limits requests, applies an explicit CORS allowlist and sends `Cache-Control: no-store` for operator state. This is a single-operator token boundary, not per-user or per-project authorization.

## Routes

| Method and path                        | Behavior                                                         |
| -------------------------------------- | ---------------------------------------------------------------- |
| `GET /api/health`                      | Public process health and version                                |
| `GET /api/config`                      | Provider availability booleans; never credential values          |
| `GET /api/snapshot`                    | Consistent complete operator snapshot                            |
| `GET /api/projects`                    | Projects and their current schema/release pointers               |
| `POST /api/projects`                   | Create a live project; returns `201`                             |
| `POST /api/projects/:id/run`           | Enqueue a bounded workflow; returns actual job with `202`        |
| `POST /api/projects/:id/publish`       | Explicitly create and select an immutable release; returns `201` |
| `POST /api/projects/:id/rollback`      | Select an earlier same-project publication                       |
| `POST /api/proposals/:id/decision`     | Approve or reject a proposal with a reason                       |
| `PATCH /api/findings/:id`              | Resolve or dismiss a finding with a recorded explanation         |
| `POST /api/jobs/:id/cancel`            | Cancel queued/running work and invalidate its lease              |
| `GET /api/sources/:versionId/original` | Download preserved bytes as an attachment                        |
| `GET /v1/projects/:id/publication`     | Public minimal bundle for the explicitly selected release        |

The run endpoint enqueues work. A `202` response means accepted, not completed. Inspect `jobs`, `runs` and `events` in the refreshed snapshot. Permanent provider failures and exhausted retries remain visible.

## Create a project

```json
{
  "name": "Public research facilities",
  "description": "A bounded, source-backed facility directory.",
  "topic": "Research facilities with publicly documented access conditions",
  "questions": [
    "Which facilities publish their equipment?",
    "Which access conditions vary by program year?"
  ],
  "inclusion": ["Official facility documentation"],
  "exclusion": ["Unattributed marketing summaries"],
  "sourceFamilies": ["facility-directory", "access-policy"],
  "seedUrls": ["https://your-public-source.example/facilities/"],
  "scope": {},
  "budget": { "maxUsd": 2, "maxSources": 20, "maxIterations": 2, "maxSearchQueries": 4 },
  "mode": "live"
}
```

Name, topic and at least one question are required. Replace the example URL before use. API creation supports live mode only; deterministic demo seeding is a separate CLI operation. Creation itself does not call a paid provider.

## Queue work

```json
{ "kind": "cycle" }
```

Available kinds are `cycle`, `ingest`, `maintenance`, `replay` and `reparse`.

```json
{ "kind": "ingest", "sourceUrls": ["https://your-public-source.example/document.pdf"] }
```

```json
{ "kind": "replay", "sourceVersionIds": ["source_version_identifier"] }
```

```json
{ "kind": "reparse", "sourceVersionIds": ["source_version_identifier"] }
```

Ingest requires at least one URL. IDs must belong to the project; the engine validates cross-project relationships. Omitting IDs for replay uses its preserved evidence set; omitting IDs for reparse selects current sources. Reparsing never fetches the source again or publishes automatically.

## Review a schema proposal

```json
{
  "decision": "approve",
  "reason": "The cited source distinguishes alternatives from required combinations.",
  "allowBreaking": false
}
```

The base schema must still be current. A breaking proposal needs `allowBreaking: true`; the UI requires explicit acknowledgement. Approval saves a new schema and enqueues replay in one transaction. Rejection uses `"decision": "reject"` with a reason and leaves the current schema unchanged.

## Resolve an audit finding

```json
{ "status": "resolved", "resolution": "Reviewed both passages and corrected the source mapping." }
```

`dismissed` is also accepted. Resolving a finding records an operator decision; it does not silently alter evidence, approve a proposal or publish a dataset.

## Publish and roll back

Publish with `POST /api/projects/:id/publish`. There is no auto-publication after extraction or approval. The projection gate may reject publication when there is no usable supported evidence.

Rollback body:

```json
{ "publicationId": "previous_release_identifier" }
```

Rollback updates the project pointer; the newer release and its history remain intact.

The public `/v1/projects/:id/publication` route returns `404` until explicit publication. Its response is validated by `PublicDatasetSchema` when imported into a catalog. It omits private project questions, source frontier, raw artifacts, observations, drafts, jobs, findings and usage. It sets a short public cache lifetime and an ETag containing the publication ID.

## Errors and operational semantics

Validation errors return `400` with field paths. Missing operator authentication returns `401`; missing resources return `404`; stale decisions and other state conflicts return `409`. Work accepted into the queue can later fail independently of the HTTP request. The workbench surfaces the actual job/run outcome after refreshing.

Original downloads deliberately use `application/octet-stream` and attachment disposition so untrusted source HTML does not execute as part of the operator application's origin. The server does not expose arbitrary filesystem paths.

For large corpora, add paginated projections before placing complete snapshots behind a public-facing service. Keep the operator API behind HTTPS when it leaves localhost, set exact allowed origins, and rotate the operator token if exposed.
