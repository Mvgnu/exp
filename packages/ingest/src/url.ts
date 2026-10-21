import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export class AcquisitionError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'AcquisitionError'; }
}
export function canonicalizeUrl(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new AcquisitionError('invalid_url', 'Source URL is invalid'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new AcquisitionError('invalid_protocol', 'Only HTTP(S) source URLs are allowed');
  if (url.username || url.password) throw new AcquisitionError('credentials_in_url', 'Source URLs cannot contain credentials');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || /^(fbclid|gclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}
export function assertPublicAddress(address: string): void {
  let parsed: ReturnType<typeof ipaddr.process>;
  try { parsed = ipaddr.process(address.replace(/^\[|\]$/g, '')); }
  catch { throw new AcquisitionError('invalid_address', 'Resolved network address is invalid'); }
  if (parsed.range() !== 'unicast') throw new AcquisitionError('private_address', 'Private, local, multicast and reserved network addresses are not allowed');
}
export async function resolvePublicAddress(url: URL, timeoutMs: number): Promise<{ address: string; family: 4 | 6 }> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|localhost\.)$/i.test(host) || /\.(localhost|local|internal|home|lan)\.?$/i.test(host)) throw new AcquisitionError('private_host', 'Local hostnames are not allowed');
  const literalFamily = isIP(host);
  if (literalFamily === 4 || literalFamily === 6) { assertPublicAddress(host); return { address: host, family: literalFamily }; }
  let timer: NodeJS.Timeout | undefined;
  try {
    const addresses = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AcquisitionError('dns_timeout', 'Source DNS lookup timed out')), timeoutMs); }),
    ]);
    if (!addresses.length) throw new AcquisitionError('dns_empty', 'Source hostname has no address');
    for (const entry of addresses) assertPublicAddress(entry.address);
    const first = addresses.find((entry) => entry.family === 4 || entry.family === 6);
    if (!first || (first.family !== 4 && first.family !== 6)) throw new AcquisitionError('dns_empty', 'Source hostname has no usable public address');
    return { address: first.address, family: first.family };
  } catch (error) {
    if (error instanceof AcquisitionError) throw error;
    throw new AcquisitionError('dns_failure', 'Source hostname could not be resolved');
  } finally { if (timer) clearTimeout(timer); }
}
