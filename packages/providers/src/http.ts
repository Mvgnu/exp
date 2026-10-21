import { z } from 'zod';
import { ProviderError } from './contract.js';
import type { ProviderOptions } from './contract.js';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
export function credential(value: string, label: string): string {
  if (!value.trim()) throw new ProviderError(`${label} is not configured`);
  return value;
}
export function endpoint(base: string, path: string): string {
  const url = new URL(base.replace(/\/$/, '') + path);
  if (url.protocol !== 'https:' || url.username || url.password) throw new ProviderError('Provider endpoint must be HTTPS without embedded credentials');
  return url.toString();
}
export function publicUrl(value: string): string {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new ProviderError('Source URL must be HTTP(S) without credentials');
  url.hash = '';
  return url.toString();
}
export async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new ProviderError('Provider response exceeds byte limit');
  }
  if (!response.body) throw new ProviderError('Provider returned an empty response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new ProviderError('Provider response exceeds byte limit');
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new ProviderError('Provider returned invalid JSON'); }
}
export async function requestJson(label: string, url: string, init: RequestInit, options: ProviderOptions): Promise<unknown> {
  const transport = options.fetch ?? globalThis.fetch;
  const retries = Math.min(3, Math.max(0, options.maxRetries ?? 2));
  const timeoutMs = Math.min(120_000, Math.max(1, options.timeoutMs ?? 30_000));
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await transport(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        const retryAfter = response.headers.get('retry-after');
        await response.body?.cancel();
        if (retryable && attempt < retries) {
          const seconds = retryAfter === null ? NaN : Number(retryAfter);
          const millis = Number.isFinite(seconds) ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : 200 * 2 ** attempt;
          await wait(Math.min(5_000, Math.max(0, Number.isFinite(millis) ? millis : 200 * 2 ** attempt)));
          continue;
        }
        throw new ProviderError(`${label} request failed (HTTP ${response.status})`, retryable, response.status);
      }
      return await boundedJson(response);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (attempt === retries) throw new ProviderError(`${label} transport failed or timed out`, true);
      await wait(200 * 2 ** attempt);
    }
  }
  throw new ProviderError(`${label} retry limit reached`, true);
}
export function parseResponse<T>(schema: z.ZodType<T>, value: unknown, provider: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const paths = result.error.issues.slice(0, 4).map((issue) => issue.path.join('.') || 'root').join(', ');
    throw new ProviderError(`${provider} response has an invalid shape (${paths})`);
  }
  return result.data;
}
