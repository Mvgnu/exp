import type { Collection, RecordsByCollection, Job, JsonValue, WorkspaceSnapshot } from '@deeplake/core';
export interface ListOptions { projectId?: string; where?: Record<string, string | number | boolean | null>; limit?: number; offset?: number }
export interface PutOptions { expectedRevision?: number; insertOnly?: boolean }
export interface EnqueueInput { projectId: string; kind: Job['kind']; key: string; payload?: Record<string, JsonValue>; maxAttempts?: number; availableAt?: string }
export interface Repository {
  get<K extends Collection>(collection: K, id: string): Promise<RecordsByCollection[K] | null>;
  list<K extends Collection>(collection: K, options?: ListOptions): Promise<RecordsByCollection[K][]>;
  put<K extends Collection>(collection: K, record: RecordsByCollection[K], options?: PutOptions): Promise<number>;
  transaction<T>(fn: (repository: Repository) => Promise<T>): Promise<T>;
  enqueue(input: EnqueueInput): Promise<Job>;
  claim(owner: string, leaseMs?: number, now?: string): Promise<Job | null>;
  heartbeat(id: string, token: string, leaseMs?: number): Promise<boolean>;
  complete(id: string, token: string): Promise<boolean>;
  fail(id: string, token: string, error: string, retryDelayMs?: number): Promise<boolean>;
  cancel(id: string): Promise<boolean>;
  listJobs(projectId?: string): Promise<Job[]>;
  reserveBudget(projectId: string, runId: string, key: string, amountUsd: number, limitUsd: number): Promise<boolean>;
  settleBudget(key: string, actualUsd: number): Promise<void>;
  snapshot(mode?: 'demo'|'live'): Promise<WorkspaceSnapshot>;
  close(): Promise<void>;
}
export interface BlobStore { put(bytes: Uint8Array): Promise<{ key: string; hash: string }>; get(key: string): Promise<Uint8Array>; has(key: string): Promise<boolean> }
export interface StoreOptions { databaseUrl?: string; dataDir?: string; memory?: boolean }
