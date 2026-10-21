import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash } from '@deeplake/core';
import type { BlobStore } from './contract.js';

/** Content-addressed, atomically written immutable bytes. Never interpret a key as a path. */
export class FileBlobStore implements BlobStore {
  private readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }
  private location(key: string): string {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid blob key');
    return join(this.directory,key.slice(0,2),key);
  }
  async put(bytes: Uint8Array): Promise<{ key:string; hash:string }> {
    const key = hash(bytes);
    const path = this.location(key);
    await mkdir(join(this.directory,key.slice(0,2)),{recursive:true});
    try {
      const existing = await readFile(path);
      if (hash(existing) !== key) throw new Error('Existing blob failed integrity verification');
      return {key,hash:key};
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary,'wx',0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      // Concurrent writers of the same key have identical bytes; rename is atomic.
      await rename(temporary,path);
    } finally { await unlink(temporary).catch(() => undefined); }
    return {key,hash:key};
  }
  async get(key: string): Promise<Uint8Array> {
    const bytes = await readFile(this.location(key));
    if (hash(bytes) !== key) throw new Error('Blob failed integrity verification');
    return new Uint8Array(bytes);
  }
  async has(key: string): Promise<boolean> {
    try { return (await stat(this.location(key))).isFile(); }
    catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false; throw error; }
  }
}
