import { Agent, fetch as undiciFetch } from 'undici';
import robotsParser from 'robots-parser';
import type { AcquiredDocument, Acquirer, FetchOptions } from '@deeplake/core';
import type { AcquisitionOptions } from './contract.js';
import { AcquisitionError, canonicalizeUrl, resolvePublicAddress } from './url.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
interface RawDocument { url: string; status: number; bytes: Uint8Array; headers: Record<string, string> }
export function createAcquirer(options: AcquisitionOptions = {}): Acquirer {
  const userAgent = options.userAgent ?? 'DeeplakeBot/0.1 (+https://github.com/Mvgnu/exp)';
  const nextHostTime = new Map<string, number>();
  const robotsCache = new Map<string, { expires: number; text: string }>();
  const interval = Math.max(0, options.minHostIntervalMs ?? 300);
  const redirectLimit = Math.min(10, Math.max(0, options.maxRedirects ?? 5));
  const maximumBytes = Math.min(50 * 1024 * 1024, Math.max(1, options.maxBytes ?? 15 * 1024 * 1024));
  async function throttle(host: string, deadline: number, waitMs = interval): Promise<void> {
    const now = Date.now();
    const start = Math.max(now, nextHostTime.get(host) ?? now);
    nextHostTime.set(host, start + waitMs);
    if (start >= deadline) throw new AcquisitionError('host_rate_limit', 'Host rate limit exceeds this fetch deadline; retry later');
    if (start > now) await sleep(start - now);
  }
  function checkHost(url: URL): void {
    if (options.allowedHosts?.length && !options.allowedHosts.some((host) => host.toLowerCase() === url.hostname.toLowerCase())) throw new AcquisitionError('host_not_allowed', 'Source hostname is outside the configured allowlist');
  }
  async function rawFetch(input: string, headers: Record<string,string>, maxBytes: number, deadline: number, robotsRequest: boolean): Promise<RawDocument> {
    let current = canonicalizeUrl(input);
    for (let redirects = 0; redirects <= redirectLimit; redirects++) {
      const url = new URL(current); checkHost(url);
      if (Date.now() >= deadline) throw new AcquisitionError('fetch_timeout', 'Source fetch exceeded its time limit');
      if (!robotsRequest && options.respectRobots !== false) await checkRobots(url, deadline);
      await throttle(url.hostname, deadline);
      const address = await resolvePublicAddress(url, Math.max(1, deadline - Date.now()));
      // Pin the already-validated address. A later DNS answer can never redirect this socket.
      const dispatcher = new Agent({ connect: { lookup: (_host, lookupOptions, callback) => {
        if (lookupOptions.all) callback(null, [address]); else callback(null, address.address, address.family);
      } } });
      try {
        const response = await undiciFetch(url, { method: 'GET', redirect: 'manual', dispatcher, headers: { 'user-agent': userAgent, accept: 'text/html,application/pdf,application/json,application/xml,text/plain;q=0.9,*/*;q=0.1', 'accept-encoding': 'identity', ...headers }, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
        const responseHeaders = Object.fromEntries(response.headers.entries());
        if ([301,302,303,307,308].includes(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (!location) throw new AcquisitionError('bad_redirect', 'Source redirect has no Location');
          if (redirects === redirectLimit) throw new AcquisitionError('redirect_limit', 'Source exceeds redirect limit');
          const target = new URL(location, url);
          if (url.protocol === 'https:' && target.protocol !== 'https:') throw new AcquisitionError('redirect_downgrade', 'HTTPS source redirected to insecure HTTP');
          current = canonicalizeUrl(target.toString());
          continue;
        }
        if (response.status === 304) { await response.body?.cancel(); return { url: url.toString(), status: 304, bytes: new Uint8Array(), headers: responseHeaders }; }
        if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new AcquisitionError('byte_limit', 'Source response exceeds byte limit'); }
        const chunks: Uint8Array[] = []; let length = 0;
        if (response.body) {
          const reader = response.body.getReader();
          try {
            for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > maxBytes) throw new AcquisitionError('byte_limit', 'Source response exceeds byte limit'); chunks.push(value); }
          } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
          finally { reader.releaseLock(); }
        }
        return { url: url.toString(), status: response.status, bytes: Buffer.concat(chunks), headers: responseHeaders };
      } catch (error) {
        if (error instanceof AcquisitionError) throw error;
        throw new AcquisitionError(Date.now() >= deadline ? 'fetch_timeout' : 'fetch_failure', 'Source request failed or timed out');
      } finally { await dispatcher.destroy(); }
    }
    throw new AcquisitionError('redirect_limit', 'Source exceeds redirect limit');
  }
  async function checkRobots(url: URL, deadline: number): Promise<void> {
    const robotsUrl = `${url.origin}/robots.txt`;
    let cached = robotsCache.get(url.origin);
    if (!cached || cached.expires < Date.now()) {
      const document = await rawFetch(robotsUrl, {}, Math.min(maximumBytes, 512_000), deadline, true);
      if (document.status === 401 || document.status === 403) throw new AcquisitionError('robots_denied', 'robots.txt access is restricted; crawling is blocked');
      if (document.status >= 500 || document.status === 429) throw new AcquisitionError('robots_unavailable', 'robots.txt is temporarily unavailable; retry later');
      if (document.status !== 200 && document.status !== 404 && document.status !== 410) throw new AcquisitionError('robots_unavailable', 'Unexpected robots.txt response; crawling is blocked');
      cached = { expires: Date.now() + 30 * 60_000, text: document.status === 200 ? new TextDecoder().decode(document.bytes) : '' };
      robotsCache.set(url.origin, cached);
    }
    const robots = robotsParser(robotsUrl, cached.text);
    if (robots.isDisallowed(url.toString(), userAgent)) throw new AcquisitionError('robots_denied', 'robots.txt disallows this source URL');
    const delay = robots.getCrawlDelay(userAgent);
    if (delay && delay > 0) {
      if (delay * 1000 >= deadline - Date.now()) throw new AcquisitionError('host_rate_limit', 'robots.txt crawl delay exceeds the fetch budget; schedule a later attempt');
      const last = nextHostTime.get(url.hostname);
      if (last !== undefined) nextHostTime.set(url.hostname, Math.max(last, Date.now() + delay * 1000));
    }
  }
  return { async fetch(input: string, fetchOptions: FetchOptions = {}): Promise<AcquiredDocument> {
    const url = canonicalizeUrl(input);
    const timeout = Math.min(120_000, Math.max(1, fetchOptions.timeoutMs ?? options.timeoutMs ?? 20_000));
    const maxBytes = Math.min(maximumBytes, fetchOptions.maxBytes ?? maximumBytes);
    const deadline = Date.now() + timeout;
    const headers: Record<string,string> = {};
    if (fetchOptions.etag) headers['if-none-match'] = fetchOptions.etag;
    if (fetchOptions.lastModified) headers['if-modified-since'] = fetchOptions.lastModified;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await rawFetch(url, headers, maxBytes, deadline, false);
      if ((result.status === 429 || result.status >= 500) && attempt < 2) {
        const seconds = Number(result.headers['retry-after']);
        const delay = Number.isFinite(seconds) && seconds >= 0 ? Math.min(5000, seconds * 1000) : 200 * 2 ** attempt;
        if (Date.now() + delay >= deadline) throw new AcquisitionError('fetch_timeout', 'Source retry exceeds its time budget');
        await sleep(delay); continue;
      }
      if (result.status !== 304 && (result.status < 200 || result.status >= 300)) throw new AcquisitionError(`http_${result.status}`, `Source returned HTTP ${result.status}`);
      return { ...result, mediaType: result.headers['content-type'] ?? 'application/octet-stream', acquiredAt: new Date().toISOString(), acquisition: 'http', notModified: result.status === 304 };
    }
    throw new AcquisitionError('retry_limit', 'Source retries exhausted');
  } };
}
