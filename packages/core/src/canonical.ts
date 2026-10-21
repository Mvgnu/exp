import { createHash } from 'node:crypto';
import type { Scope } from './contract.js';

/** Canonical JSON preserves arrays and sorts object keys. Non-JSON input fails closed. */
export function stableStringify(value: unknown): string {
  const seen = new Set<object>();
  function encode(item: unknown): string {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object') throw new TypeError('Canonical values must be finite JSON data');
    if (seen.has(item)) throw new TypeError('Canonical values cannot contain cycles');
    seen.add(item);
    try {
      if (Array.isArray(item)) return `[${item.map(encode).join(',')}]`;
      const proto: unknown = Object.getPrototypeOf(item);
      if (proto !== Object.prototype && proto !== null) throw new TypeError('Canonical objects must be plain JSON records');
      return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${encode(Reflect.get(item,key))}`).join(',')}}`;
    } finally { seen.delete(item); }
  }
  return encode(value);
}

export function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stableId(prefix: string, ...parts: unknown[]): string {
  if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(prefix)) throw new TypeError('Invalid identifier prefix');
  return `${prefix}_${hash(stableStringify(parts)).slice(0,40)}`;
}

export function normalizeScope(scope: Scope): Scope {
  return Object.fromEntries(Object.entries(scope).sort(([a],[b]) => a.localeCompare(b,'en')).map(([key,value]) => [key.normalize('NFC'), value.normalize('NFC').trim()]));
}

/** Project and applicability are part of identity; names alone are never an identifier. */
export function entityId(projectId: string, type: string, identity: Scope, scope: Scope): string {
  if (!projectId || !type || Object.keys(identity).length === 0 || Object.values(identity).some(value => !value.trim())) throw new TypeError('An entity needs a project, type and nonempty identity');
  return stableId('entity', projectId, type, normalizeScope(identity), normalizeScope(scope));
}
