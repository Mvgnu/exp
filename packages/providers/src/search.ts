import { z } from 'zod';
import type { AcquiredDocument, ModelUsage, SearchProvider } from '@deeplake/core';
import type { BraveOptions, ExaOptions, ExaSearch } from './contract.js';
import { ProviderError } from './contract.js';
import { credential, endpoint, parseResponse, publicUrl, requestJson } from './http.js';

const CostSchema = z.object({ total: z.number().nonnegative() }).optional();
const HitSchema = z.object({ url: z.string().url(), title: z.string().optional(), publishedDate: z.string().optional() });
const ExaResultsSchema = z.object({ results: z.array(HitSchema), costDollars: CostSchema });
const ExaContentsSchema = z.object({ results: z.array(HitSchema.extend({ text: z.string().optional() })), requestId: z.string().optional(), costDollars: CostSchema, statuses: z.array(z.object({ id: z.string(), status: z.string(), source: z.string().optional() })).optional() });
const BraveSchema = z.object({ web: z.object({ results: z.array(z.object({ url: z.string().url(), title: z.string() })) }).optional() });
function queryLimit(limit: number, maximum: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) throw new ProviderError(`Search limit must be between 1 and ${maximum}`);
  return limit;
}
function usage(provider: string, model: string, estimated: number, reported: number | null): ModelUsage {
  return { provider, model, inputTokens: 0, outputTokens: 0, estimatedCostUsd: estimated, reportedCostUsd: reported };
}
export function createExaSearch(options: ExaOptions): ExaSearch {
  const key = credential(options.apiKey, 'EXA_API_KEY');
  const base = options.baseUrl ?? 'https://api.exa.ai';
  const mode = options.mode ?? 'auto';
  const headers = { 'content-type': 'application/json', 'x-api-key': key };
  return {
    name: `exa:${mode}`,
    async search(query, limit) {
      const count = queryLimit(limit, 100);
      const raw = await requestJson('Exa', endpoint(base, '/search'), { method: 'POST', headers, body: JSON.stringify({ query: query.query, type: mode, numResults: count }) }, options);
      const data = parseResponse(ExaResultsSchema, raw, 'Exa');
      const hits = data.results.slice(0, count).flatMap((hit) => {
        try { return [{ url: publicUrl(hit.url), title: hit.title ?? hit.url, family: query.family, ...(hit.publishedDate ? { publishedAt: hit.publishedDate } : {}) }]; }
        catch { return []; }
      });
      return { data: hits, usage: usage('exa', mode, (mode === 'lite' ? 0.004 : 0.007) * Math.ceil(count / 10), data.costDollars?.total ?? null) };
    },
    async contents(url): Promise<AcquiredDocument> {
      const sourceUrl = publicUrl(url);
      const raw = await requestJson('Exa Contents', endpoint(base, '/contents'), { method: 'POST', headers, body: JSON.stringify({ urls: [sourceUrl], text: true, maxAgeHours: 0 }) }, options);
      const data = parseResponse(ExaContentsSchema, raw, 'Exa Contents');
      const result = data.results[0];
      if (!result?.text?.trim()) throw new ProviderError('Exa Contents returned no full source text; summaries are not evidence');
      if (data.statuses?.some((status) => status.status !== 'success')) throw new ProviderError('Exa Contents could not acquire the requested source');
      const bytes = new TextEncoder().encode(result.text);
      return { url: publicUrl(result.url), status: 200, bytes, mediaType: 'text/plain; charset=utf-8', acquisition: 'exa-contents', acquiredAt: new Date().toISOString(), notModified: false, headers: { 'x-deeplake-artifact': 'provider-extracted-text', ...(data.requestId ? { 'x-exa-request-id': data.requestId } : {}), ...(data.costDollars ? { 'x-deeplake-provider-cost-usd': String(data.costDollars.total) } : {}) } };
    },
  };
}
export function createBraveSearch(options: BraveOptions): SearchProvider {
  const key = credential(options.apiKey, 'BRAVE_API_KEY');
  return {
    name: 'brave',
    async search(query, limit) {
      const count = queryLimit(limit, 20);
      const url = new URL(endpoint(options.baseUrl ?? 'https://api.search.brave.com', '/res/v1/web/search'));
      url.searchParams.set('q', query.query); url.searchParams.set('count', String(count));
      const raw = await requestJson('Brave', url.toString(), { headers: { accept: 'application/json', 'X-Subscription-Token': key } }, options);
      const data = parseResponse(BraveSchema, raw, 'Brave');
      return { data: (data.web?.results ?? []).slice(0, count).flatMap((hit) => {
        try { return [{ url: publicUrl(hit.url), title: hit.title, family: query.family }]; } catch { return []; }
      }), usage: usage('brave', 'web-search', 0.005, null) };
    },
  };
}
