import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import type { Repository } from '@deeplake/store';
import type { Engine } from '@deeplake/engine';
export interface WorkerOptions {
  repository: Repository;
  getEngine: (projectId: string) => Promise<Engine>;
  signal: AbortSignal;
  owner?: string;
  pollMs?: number;
  leaseMs?: number;
  log?: (message: string) => void;
}
export async function runWorker(options: WorkerOptions): Promise<void> {
  const owner = options.owner ?? `worker-${randomUUID()}`;
  const leaseMs = options.leaseMs ?? 60000;
  const log = options.log ?? (() => {});
  while (!options.signal.aborted) {
    const job = await options.repository.claim(owner, leaseMs);
    if (!job) {
      try {
        await sleep(options.pollMs ?? 500, undefined, { signal: options.signal });
      } catch {
        if (options.signal.aborted) break;
        throw new Error('Worker polling failed');
      }
      continue;
    }
    const token = job.leaseToken;
    if (!token) throw new Error('Claimed job has no lease token');
    let leaseLost = false;
    const interval = setInterval(
      () => {
        void options.repository
          .heartbeat(job.id, token, leaseMs)
          .then((ok) => {
            if (!ok) leaseLost = true;
          })
          .catch(() => {
            leaseLost = true;
          });
      },
      Math.max(100, Math.floor(leaseMs / 3)),
    );
    try {
      const engine = await options.getEngine(job.projectId);
      await engine.executeJob(job);
      if (leaseLost || !(await options.repository.complete(job.id, token)))
        log(`Job ${job.id}: completion fenced after lease loss or cancellation.`);
      else log(`Job ${job.id}: completed.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown worker failure';
      if (!leaseLost)
        await options.repository.fail(
          job.id,
          token,
          message,
          Math.min(60000, 1000 * 2 ** job.attempt),
        );
      log(`Job ${job.id}: failed: ${message}`);
    } finally {
      clearInterval(interval);
    }
  }
}
