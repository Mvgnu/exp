import type { AcquiredDocument, Extractor, Reasoner, SearchProvider } from '@deeplake/core';
export interface HttpTransport { (url: string, init?: RequestInit): Promise<Response> }
export interface ProviderOptions { fetch?: HttpTransport; timeoutMs?: number; maxRetries?: number }
export interface ExaOptions extends ProviderOptions { apiKey: string; mode?: 'auto'|'lite'; baseUrl?: string }
export interface BraveOptions extends ProviderOptions { apiKey: string; baseUrl?: string }
export interface AnthropicOptions extends ProviderOptions { apiKey: string; models: { planner: string; architect: string; auditor: string; resolver: string }; baseUrl?: string; inputUsdPerMillion?: number; outputUsdPerMillion?: number }
export interface ClairicOptions extends ProviderOptions { accountId: string; apiToken: string; baseUrl?: string; inputUsdPerMillion?: number }
export interface ExaSearch extends SearchProvider { contents(url: string): Promise<AcquiredDocument> }
export type { Extractor, Reasoner, SearchProvider };
export class ProviderError extends Error { constructor(message: string, public readonly retryable = false, public readonly status?: number) { super(message); this.name = 'ProviderError'; } }
