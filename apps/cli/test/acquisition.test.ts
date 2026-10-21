import { describe, expect, it, vi } from 'vitest';
import type { AcquiredDocument } from '@deeplake/core';
import { AcquisitionError } from '@deeplake/ingest';
import { withContentsFallback } from '../src/acquisition.js';

const artifact: AcquiredDocument = {
  url: 'https://example.org/source',
  status: 200,
  bytes: new TextEncoder().encode('Source text'),
  mediaType: 'text/plain',
  acquiredAt: '2026-01-01T00:00:00Z',
  acquisition: 'exa-contents',
  headers: {
    'x-deeplake-artifact': 'provider-extracted-text',
    'x-deeplake-provider-cost-usd': '0.001',
  },
  notModified: false,
};
describe('explicit contents acquisition policy', () => {
  it('keeps original HTTP bytes and conditional fetches when acquisition succeeds', async () => {
    const original = { ...artifact, acquisition: 'http' as const };
    const fallback = vi.fn(async () => artifact);
    const fetch = vi.fn(async () => original);
    expect(
      await withContentsFallback({ fetch }, fallback).fetch(artifact.url, { etag: 'old' }),
    ).toBe(original);
    expect(fetch).toHaveBeenCalledWith(artifact.url, { etag: 'old' });
    expect(fallback).not.toHaveBeenCalled();
  });
  it('preserves provider provenance and cost only after an eligible origin error', async () => {
    const fallback = vi.fn(async () => artifact);
    const result = await withContentsFallback(
      {
        fetch: async () => {
          throw new AcquisitionError('http_503', 'Origin unavailable');
        },
      },
      fallback,
    ).fetch(artifact.url);
    expect(fallback).toHaveBeenCalledWith(artifact.url);
    expect(result.acquisition).toBe('exa-contents');
    expect(result.headers).toMatchObject({
      'x-deeplake-fallback-reason': 'http_503',
      'x-deeplake-provider-cost-usd': '0.001',
      'x-deeplake-artifact': 'provider-extracted-text',
    });
  });
  it.each([
    'robots_denied',
    'robots_unavailable',
    'private_address',
    'private_host',
    'http_401',
    'http_403',
    'http_429',
    'byte_limit',
    'fetch_failure',
    'redirect_limit',
  ])('does not bypass %s', async (code) => {
    const fallback = vi.fn(async () => artifact);
    await expect(
      withContentsFallback(
        {
          fetch: async () => {
            throw new AcquisitionError(code, 'Blocked');
          },
        },
        fallback,
      ).fetch(artifact.url),
    ).rejects.toThrow('Blocked');
    expect(fallback).not.toHaveBeenCalled();
  });
  it('enforces the byte limit on the fallback artifact', async () => {
    await expect(
      withContentsFallback(
        {
          fetch: async () => {
            throw new AcquisitionError('http_502', 'Bad gateway');
          },
        },
        async () => artifact,
      ).fetch(artifact.url, { maxBytes: 2 }),
    ).rejects.toThrow('byte limit');
  });
});
