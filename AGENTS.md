# Deeplake development

Read `specs/00_engine.md`, `.agent/lop.md`, `.agent/gauntlet.md`, and your domain's SPEC before editing. This project uses Lop write bubbles and independent Gauntlet judgement. PM owns root configuration, manifests, contracts, cross-domain architecture tests and composition apps. Bubble agents work on their own git branch/worktree and must not edit outside assigned paths. Never commit secrets, node_modules, .next, out, .deeplake or generated evaluation screenshots.

Report four things: changed paths; actual commands and results; disagreements; remaining failures. Do not weaken a test or invent a check result. Raise contract defects to PM. Domain behavior belongs in registry/fixtures/config, not core packages. Use Zod at IO boundaries and type imports across layers.
