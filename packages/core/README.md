# @deeplake/core

The evidence model and deterministic semantics. Import browser-safe Zod contracts from `@deeplake/core/contract`; the package root also exports Node SHA-256 helpers.

## Public helpers

- `stableStringify(value)` produces canonical JSON, rejects cycles and values JSON cannot represent, sorts object keys and preserves array order.
- `hash(string | Uint8Array)` returns a full lowercase SHA-256 digest.
- `stableId(prefix, ...parts)` binds a human-readable prefix to a 160-bit truncated digest of canonical parts.
- `normalizeScope(scope)` sorts keys, NFC-normalizes text and trims leading/trailing whitespace without folding case.
- `entityId(projectId, type, identity, scope)` prevents names, different applicability or different projects from sharing an identity.
- `validateDomainSchema(unknown)` validates both shape and semantic references. It rejects duplicate IDs, dangling identity/scope/reference fields, incoherent units and invalid structured JSON schemas.
- `validateFieldValue(field, unknown)` checks actual field type, enumeration and structured JSON constraints. Null never becomes a fact.
- `diffSchemas(before, after)` reports explicit changes and treats removals, narrowing, new required fields, units, identities, scopes and structure changes conservatively as breaking.
- `validateEvidence(evidence, segment)` verifies source/segment identity and the exact half-open UTF-16 text range. Offsets are relative to the segment, not the whole original document; its document offsets and page remain in the segment.
- `buildPublication(input)` constructs a new immutable publication from an approved current schema and complete source registry. It never mutates inputs or publishes to storage.

## Publication policy

Only explicit, supported, correctly scoped, correctly typed observations under the approved schema contribute. Source pointers select the current source versions; an old value remains in history but does not silently become the current value. Every identity field and schema-defined scope field must be established by a non-conflicting supported observation matching the entity. Missing identity withholds the entity and produces a release warning.

Unresolved critical acquisition, extraction and identity findings with an affected entity/segment suppress the corresponding value. Schema gaps do not erase unrelated observations. Equal values merge evidence; disagreements expose alternatives with a null selected value. A missing current value is described as unresolved, never as an assertion of absence.

Derived values are withheld until the contract can represent derivation provenance. Estimated values are always outside this asserted-fact projection. Exact spans establish what text was used; they do not by themselves prove that a model interpreted the text correctly, which is why the independent audit gate remains necessary.

The release stores the schema, prior-release ID, current contributing source versions, source-family coverage, exclusions and warnings. Historical releases remain independently readable.
