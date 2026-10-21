# Provider adapters

`createExaSearch`, `createBraveSearch`, `createAnthropicReasoner`, and `createClairicExtractor` implement the core ports. Every adapter accepts an injected HTTP transport for credential-free testing. Adapters validate responses, bound response bytes and retries, disable redirects carrying credentials, and return sanitized errors.

## Evidence and typed responses

Exa search is URL discovery only. `contents(url)` requests `text: true` with `maxAgeHours: 0`; it rejects summary-only responses. The artifact is labelled `exa-contents`, not original HTML. It preserves the provider request ID and, if present, reported cost in acquisition metadata. Exa content text still needs downstream parsing and evidence checks.

Anthropic uses configured role model IDs and a single `emit_result` response envelope with `tool_choice: auto`. Current Opus/Sonnet 5.5 reject forced tool choice. The model never receives executable tools. Exactly one envelope is accepted, followed by the caller's Zod validation. Truncated, refused, wrong-tool and malformed responses fail visibly. Generic schema tool use is intentional: the domain schema's arbitrary JSON sub-schemas need not conform to every restriction of a constrained-output API.

The reasoner's stable `name` includes adapter version 1.1.0 and a fingerprint of all four configured role model IDs. A model change therefore invalidates engine caches keyed by that name, while credential changes do not. Response usage retains the actual model reported by the provider.

Clairic sends one record segment, with extraction-only instructions. Text values require exact matching spans. Number/date/list values request companion source passages. Numbers must occur lexically in their evidence; dates must match an explicit ISO date or an unambiguous day-month-year numeric date. More elaborate date normalization goes to an audited resolver. Lists require all items within the cited passage. Boolean fields copy an explicit true/false or yes/no token before deterministic conversion. `json` and `reference` fields return visible unsupported findings for the engine's structured reasoning/identity path. A null `value` never falls back to `guess`; empty lists do not assert absence. Truncation or altered response state invalidates the whole extraction while preserving usage.

Source spans are UTF-16 JavaScript string offsets into `segment.text`, not into an LLM summary. The adapter verifies the actual substring before accepting any span. If a provider's offsets cannot be mapped exactly, the result remains unresolved.

## Costs

Reported provider costs are kept separate from estimates. Search estimates are documented assumptions, not an invoice. Anthropic rates are configurable and default to conservative $4/$20 per million input/output tokens; configure them for the chosen models. Clairic defaults to $0.10 per million reported input tokens. Provider retries may incur charges even if the final request fails; the engine must retain its reservation on ambiguous failures. Exa Contents' cost is returned in `headers['x-deeplake-provider-cost-usd']` because the acquisition contract has no usage object.

## Primary API references

Verified 2026-10-21; API payloads are tested against representative documented shapes, not certified by live paid calls.

- [Exa search](https://exa.ai/docs/reference/search)
- [Exa contents](https://exa.ai/docs/reference/get-contents)
- [Brave web search](https://api-dashboard.search.brave.com/documentation/services/web-search)
- [Claude tool definitions and model restrictions](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)
- [Cloudflare Clairic](https://developers.cloudflare.com/workers-ai/models/clairic/)
- [Cloudflare extraction model semantics](https://developers.cloudflare.com/workers-ai/concepts/extraction-models/)

Run `pnpm --filter @deeplake/providers check` and `pnpm --filter @deeplake/providers test`.
