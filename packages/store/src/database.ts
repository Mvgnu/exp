import { readFile, mkdir, open, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { z } from 'zod';
import { hash } from '@deeplake/core';
import type { StoreOptions } from './contract.js';

export interface SqlSession { query(sql: string, parameters?: unknown[]): Promise<Record<string,unknown>[]> }
export interface SqlDatabase extends SqlSession { kind: 'postgres'|'pglite'; transaction<T>(fn: (session: SqlSession) => Promise<T>, isolation?: 'serializable'|'read committed'): Promise<T>; close(): Promise<void> }

/** The caller must retry the whole state transition against fresh data. */
export class RetryableTransactionError extends Error {
  readonly retryable = true;
  readonly code = 'DEEPLAKE_SERIALIZATION_CONFLICT';
  constructor(cause: unknown) { super('Concurrent database change; retry the complete transaction from fresh state', {cause}); this.name = 'RetryableTransactionError'; }
}

export function isSerializationConflict(error: unknown): boolean {
  return error instanceof RetryableTransactionError || (!!error && typeof error === 'object' && 'code' in error && (error.code === '40001' || error.code === '40P01'));
}

function wrapTransactionError(error: unknown): never {
  if (isSerializationConflict(error)) throw new RetryableTransactionError(error);
  throw error;
}

const lockSchema = z.object({pid:z.number().int().positive(),token:z.string()});
async function acquireLocalLock(directory: string): Promise<() => Promise<void>> {
  const path = `${resolve(directory)}.lock`;
  await mkdir(dirname(path), {recursive:true});
  const token = randomUUID();
  for (let attempt=0; attempt<2; attempt++) {
    try {
      const handle = await open(path,'wx',0o600);
      await handle.writeFile(JSON.stringify({pid:process.pid,token}));
      await handle.close();
      return async () => {
        const current = lockSchema.safeParse(JSON.parse(await readFile(path,'utf8').catch(() => '{}')));
        if (current.success && current.data.token === token) await unlink(path).catch(() => undefined);
      };
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error;
      let existing: z.infer<typeof lockSchema>;
      try { existing = lockSchema.parse(JSON.parse(await readFile(path,'utf8'))); } catch { throw new Error('Local database lock is unreadable; inspect it before recovery'); }
      let alive = true;
      try { process.kill(existing.pid,0); } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') alive = false; }
      if (alive) throw new Error('Local PGlite database is already open. Use the API embedded worker, or PostgreSQL for separate processes.');
      if (attempt === 0) await unlink(path);
    }
  }
  throw new Error('Could not acquire the local database lock');
}

export async function openDatabase(options: StoreOptions): Promise<SqlDatabase> {
  if (options.databaseUrl) {
    if (!/^postgres(?:ql)?:\/\//i.test(options.databaseUrl)) throw new Error('DATABASE_URL must use postgres:// or postgresql://');
    const pool = new pg.Pool({ connectionString:options.databaseUrl, max:10, connectionTimeoutMillis:10000, statement_timeout:30000, application_name:'deeplake' });
    return {
      kind: 'postgres',
      async query(sql,params=[]) { return (await pool.query<Record<string,unknown>>(sql,params)).rows; },
      async transaction(fn,isolation='serializable') {
        const client = await pool.connect();
        try {
          await client.query(isolation === 'serializable' ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN ISOLATION LEVEL READ COMMITTED');
          const result = await fn({ async query(sql,params=[]) { return (await client.query<Record<string,unknown>>(sql,params)).rows; } });
          await client.query('COMMIT');
          return result;
        } catch (error) { await client.query('ROLLBACK').catch(() => undefined); return wrapTransactionError(error); }
        finally { client.release(); }
      },
      async close() { await pool.end(); }
    };
  }
  const directory = options.memory ? undefined : resolve(options.dataDir ?? '.deeplake/db');
  const release = directory ? await acquireLocalLock(directory) : async () => undefined;
  try {
    const db = new PGlite(directory);
    await db.waitReady;
    return {
      kind: 'pglite',
      async query(sql,params=[]) { return (await db.query<Record<string,unknown>>(sql,params)).rows; },
      async transaction(fn) {
        try { return await db.transaction(async tx => fn({ async query(sql,params=[]) { return (await tx.query<Record<string,unknown>>(sql,params)).rows; } })); }
        catch (error) { return wrapTransactionError(error); }
      },
      async close() { try { await db.close(); } finally { await release(); } }
    };
  } catch (error) { await release(); throw error; }
}

export const migrationFiles = [new URL('../migrations/001_initial.sql',import.meta.url)] as const;

export async function migrate(database: SqlDatabase): Promise<void> {
  await database.transaction(async session => {
    if (database.kind === 'postgres') await session.query('SELECT pg_advisory_xact_lock(761427401)');
    await session.query('CREATE TABLE IF NOT EXISTS deeplake_migrations (version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const [index,path] of migrationFiles.entries()) {
      const sql = await readFile(path,'utf8');
      const checksum = hash(sql);
      const existing = await session.query('SELECT checksum FROM deeplake_migrations WHERE version = $1',[index+1]);
      if (existing[0]) {
        if (existing[0].checksum !== checksum) throw new Error(`Applied migration ${index+1} was modified; add a new migration instead`);
        continue;
      }
      // Migration scripts are trusted checked-in SQL; data queries always use parameters.
      for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await session.query(statement);
      await session.query('INSERT INTO deeplake_migrations (version,checksum) VALUES ($1,$2)',[index+1,checksum]);
    }
  }, 'read committed');
}
