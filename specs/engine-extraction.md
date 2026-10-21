# Ownership and integration plan

| Bubble | Owned paths | Contract consumers | User outcome |
|---|---|---|---|
| Evidence | packages/core, packages/store except PM files | All | Trace a value back to immutable evidence and survive a worker restart |
| Acquisition | packages/providers, packages/ingest except PM files | Engine | Obtain original usable documents and bounded typed provider results |
| Engine | packages/engine except PM files | Composition apps | Complete topic → evidence → audit → schema replay → published view |
| Workbench | sites/workbench except PM files | Operators | Find and resolve the next meaningful issue without guessing |
| Catalog | sites/catalog except PM files | Readers | Narrow records and inspect exactly why each fact is supported |
| PM | apps, fixtures, root config, contracts, specs, ops, integration | Everything | Runnable, integrated product with reliable commands |

Wave 1 freezes contracts/specs then builds evidence, acquisition and engine concurrently. PM builds app composition, fixtures, infrastructure and site foundations. Wave 2 delegates site completion and any contract-approved followups. Wave 3 runs fresh artifact critics, repairs, onboarding drill and full verification. The empty repository is initialized directly on main, preserving all subsequent history; no unrelated files are removed.
