import type { Acquirer, AcquiredDocument } from '@deeplake/core';
import { AcquisitionError } from '@deeplake/ingest';

/** Explicit provider-text fallback after an eligible public origin failure.
 * Policy, authentication, rate-limit, address and size failures never fall back.
 */
export function withContentsFallback(
  primary: Acquirer,
  contents?: (url: string) => Promise<AcquiredDocument>,
): Acquirer {
  return {
    async fetch(url, options) {
      try {
        return await primary.fetch(url, options);
      } catch (error) {
        if (!contents || !(error instanceof AcquisitionError) || !/^http_5\d\d$/.test(error.code))
          throw error;
        const document = await contents(url);
        if (
          document.acquisition !== 'exa-contents' ||
          document.status !== 200 ||
          document.notModified
        )
          throw new Error('Contents fallback returned an invalid acquisition artifact.');
        if (
          document.bytes.byteLength >
          Math.min(options?.maxBytes ?? 15 * 1024 * 1024, 15 * 1024 * 1024)
        )
          throw new AcquisitionError(
            'byte_limit',
            'Contents fallback exceeds the source byte limit',
          );
        return {
          ...document,
          headers: { ...document.headers, 'x-deeplake-fallback-reason': error.code },
        };
      }
    },
  };
}
