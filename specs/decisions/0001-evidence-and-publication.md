# ADR 0001: immutable evidence, explicit publication

Accepted. Sources, parsed artifacts, observations, schema versions and publications are append-only. Mutable project pointers designate current research schema and current public release independently. Contradictions are multiple scoped observations, not last-write-wins. Source removal and failed fetch do not assert that facts disappeared. Public releases expose evidence references and disagreements; only supported observations are eligible.

This permits historical replay and rollback without silently rewriting the past. It costs more storage and requires cleanup/retention policy later. Raw content is private to operators by default; public projections expose relevant evidence excerpts and original source links.
