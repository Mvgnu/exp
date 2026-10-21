import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStore, FileBlobStore, ImmutableRecordError, RecordConflictError } from '../src/index.js';
import type { Repository } from '../src/index.js';
import { observation, project, version } from '../../core/test/fixtures.js';

let repository: Repository;
beforeEach(async () => { repository=await createStore({memory:true}); });
afterEach(async () => { await repository.close(); });

describe('durable typed records', () => {
  it('makes identical writes idempotent and immutable writes append-only', async () => {
    expect(await repository.put('sourceVersions',version)).toBe(1);
    expect(await repository.put('sourceVersions',version)).toBe(1);
    await expect(repository.put('sourceVersions',{...version,title:'Silently changed'})).rejects.toBeInstanceOf(ImmutableRecordError);
    expect(await repository.get('sourceVersions',version.id)).toEqual(version);
    await repository.put('observations',observation);
    await expect(repository.put('observations',{...observation,value:99})).rejects.toBeInstanceOf(ImmutableRecordError);
  });
  it('supports compare-and-swap and rejects cross-project identifier reuse', async () => {
    expect(await repository.put('projects',project,{expectedRevision:0})).toBe(1);
    expect(await repository.put('projects',{...project,name:'Revised'},{expectedRevision:1})).toBe(2);
    await expect(repository.put('projects',project,{expectedRevision:1})).rejects.toBeInstanceOf(RecordConflictError);
    await repository.put('observations',observation);
    await expect(repository.put('observations',{...observation,projectId:'other'})).rejects.toBeInstanceOf(RecordConflictError);
    await expect(repository.put('projects',{...project,id:'missing'},{expectedRevision:2})).rejects.toThrow(/does not exist/);
  });
  it('rolls back an entire transaction, including queued jobs, and supports nested savepoints', async () => {
    await expect(repository.transaction(async tx=>{
      await tx.put('projects',project);
      await tx.enqueue({projectId:project.id,kind:'cycle',key:'rollback'});
      throw new Error('Abort release');
    })).rejects.toThrow('Abort release');
    expect(await repository.get('projects',project.id)).toBeNull();
    expect(await repository.listJobs()).toEqual([]);
    await repository.transaction(async tx=>{
      await tx.put('projects',project);
      await expect(tx.transaction(async inner=>{await inner.put('projects',{...project,name:'Inner'});throw new Error('Abort savepoint');})).rejects.toThrow('Abort savepoint');
      expect((await tx.get('projects',project.id))?.name).toBe(project.name);
    });
    expect((await repository.get('projects',project.id))?.name).toBe(project.name);
  });
  it('rejects invalid IO and implements deterministic, safe typed filters', async () => {
    await repository.put('projects',project);
    await repository.put('projects',{...project,id:'p2',name:'Second'});
    expect((await repository.list('projects',{where:{mode:'demo'},offset:1,limit:1}))[0]?.id).toBe('p2');
    expect(await repository.list('projects',{projectId:'p2'})).toHaveLength(1);
    await expect(repository.list('projects',{where:{'name; DROP TABLE deeplake_records':'x'}})).rejects.toThrow(/Unknown filter/);
    await expect(repository.list('projects',{limit:-1})).rejects.toThrow(/limit/);
    await expect(repository.put('projects',{...project,name:''})).rejects.toThrow();
    const snapshot=await repository.snapshot('demo');
    expect(snapshot.projects).toHaveLength(2);
    expect(snapshot.mode).toBe('demo');
  });
});

describe('leased durable work', () => {
  it('deduplicates work and rejects key reuse with changed payload', async () => {
    const job=await repository.enqueue({projectId:'p',kind:'ingest',key:'source:a',payload:{url:'https://example.org'}});
    const same=await repository.enqueue({projectId:'p',kind:'ingest',key:'source:a',payload:{url:'https://example.org'}});
    expect(same.id).toBe(job.id);
    await expect(repository.enqueue({projectId:'p',kind:'cycle',key:'source:a'})).rejects.toBeInstanceOf(RecordConflictError);
    expect(await repository.listJobs('p')).toHaveLength(1);
  });
  it('reclaims an expired lease and fences the stale worker on every mutation', async () => {
    await repository.enqueue({projectId:'p',kind:'cycle',key:'reclaim'});
    const first=await repository.claim('worker-one',1000);
    expect(first).not.toBeNull();
    expect(await repository.claim('other')).toBeNull();
    const second=await repository.claim('worker-two',10000,new Date(Date.now()+2000).toISOString());
    expect(second?.id).toBe(first?.id);
    expect(second?.attempt).toBe(2);
    expect(second?.leaseToken).not.toBe(first?.leaseToken);
    expect(await repository.complete(first!.id,first!.leaseToken!)).toBe(false);
    expect(await repository.heartbeat(first!.id,first!.leaseToken!)).toBe(false);
    expect(await repository.fail(first!.id,first!.leaseToken!,'stale error',0)).toBe(false);
    expect(await repository.complete(second!.id,second!.leaseToken!)).toBe(true);
    expect((await repository.listJobs())[0]?.status).toBe('succeeded');
  });
  it('keeps bounded retries, cancellation and final expired failures visible', async () => {
    const job=await repository.enqueue({projectId:'p',kind:'cycle',key:'fail',maxAttempts:2});
    const first=await repository.claim('worker');
    expect(await repository.fail(job.id,first!.leaseToken!,'temporary outage',0)).toBe(true);
    const second=await repository.claim('worker');
    expect(await repository.fail(job.id,second!.leaseToken!,'still unavailable',0)).toBe(true);
    expect(await repository.claim('worker')).toBeNull();
    expect((await repository.listJobs())[0]).toMatchObject({status:'failed',attempt:2,lastError:'still unavailable'});
    const cancel=await repository.enqueue({projectId:'p',kind:'cycle',key:'cancel'});
    const leased=await repository.claim('worker');
    expect(await repository.cancel(cancel.id)).toBe(true);
    expect(await repository.complete(cancel.id,leased!.leaseToken!)).toBe(false);
    const expires=await repository.enqueue({projectId:'p',kind:'cycle',key:'expires',maxAttempts:1});
    await repository.claim('worker',1);
    await repository.claim('worker',1000,new Date(Date.now()+2000).toISOString());
    expect((await repository.listJobs()).find(value=>value.id===expires.id)?.status).toBe('failed');
  });
  it('does not grant the same lease twice during concurrent claims', async () => {
    await repository.enqueue({projectId:'p',kind:'cycle',key:'one'});
    const leases=await Promise.all([repository.claim('a'),repository.claim('b')]);
    expect(leases.filter(Boolean)).toHaveLength(1);
  });
});

describe('budget ledger', () => {
  it('reserves atomically per run, settles costs and cannot oversubscribe concurrently', async () => {
    const accepted=await Promise.all(Array.from({length:8},(_,i)=>repository.reserveBudget('p','r',`cost-${i}`,0.25,1)));
    expect(accepted.filter(Boolean)).toHaveLength(4);
    expect(await repository.reserveBudget('p','r','cost-0',0.25,1)).toBe(true);
    await repository.settleBudget('cost-0',0.1);
    await repository.settleBudget('cost-0',0.1);
    expect(await repository.reserveBudget('p','r','small',0.15,1)).toBe(true);
    expect(await repository.reserveBudget('p','r','too-much',0.01,1)).toBe(false);
    expect(await repository.reserveBudget('p','another-run','fresh-budget',1,1)).toBe(true);
    await expect(repository.settleBudget('cost-0',0.2)).rejects.toBeInstanceOf(RecordConflictError);
    await expect(repository.reserveBudget('q','r','cost-0',0.25,1)).rejects.toBeInstanceOf(RecordConflictError);
  });
  it('records unexpected actual overruns honestly and denies later spending', async () => {
    expect(await repository.reserveBudget('p','r','estimate',0.1,0.2)).toBe(true);
    await repository.settleBudget('estimate',0.3);
    expect(await repository.reserveBudget('p','r','after',0.01,0.2)).toBe(false);
    await expect(repository.reserveBudget('p','r','nan',NaN,1)).rejects.toThrow();
    await expect(repository.settleBudget('missing',0)).rejects.toThrow(/Unknown/);
  });
});

it('reopens persistent state and rejects two simultaneous local owners', async () => {
  const directory=await mkdtemp(join(tmpdir(),'deeplake-store-'));
  const dataDir=join(directory,'db');
  let durable:Repository|undefined;
  try {
    durable=await createStore({dataDir});
    await durable.put('projects',project);
    const job=await durable.enqueue({projectId:'p',kind:'cycle',key:'persistent'});
    const lease=await durable.claim('lost-worker',1);
    await expect(createStore({dataDir})).rejects.toThrow(/already open/);
    await durable.close(); durable=undefined;
    durable=await createStore({dataDir});
    expect(await durable.get('projects','p')).toEqual(project);
    const recovered=await durable.claim('replacement',10000,new Date(Date.now()+1000).toISOString());
    expect(recovered?.id).toBe(job.id);
    expect(await durable.complete(job.id,lease!.leaseToken!)).toBe(false);
    expect(await durable.complete(job.id,recovered!.leaseToken!)).toBe(true);
  } finally { await durable?.close();await rm(directory,{recursive:true,force:true}); }
});

it('stores exact bytes atomically, verifies hashes and rejects path traversal', async () => {
  const directory=await mkdtemp(join(tmpdir(),'deeplake-blobs-'));
  try {
    const store=new FileBlobStore(directory);
    const input=new TextEncoder().encode('Immutable original bytes\n');
    const [first,second]=await Promise.all([store.put(input),store.put(input)]);
    expect(first).toEqual(second);
    expect(await store.has(first.key)).toBe(true);
    expect(await store.get(first.key)).toEqual(input);
    await expect(store.get('../secret')).rejects.toThrow(/Invalid blob key/);
    await writeFile(join(directory,first.key.slice(0,2),first.key),'corruption');
    await expect(store.get(first.key)).rejects.toThrow(/integrity/);
    await expect(store.put(input)).rejects.toThrow(/integrity/);
    expect(await readFile(join(directory,first.key.slice(0,2),first.key),'utf8')).toBe('corruption');
  } finally {await rm(directory,{recursive:true,force:true});}
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('external PostgreSQL multi-worker gate',()=>{
  it('gives concurrent connections different jobs and enforces atomic budgets',async()=>{
    const first=await createStore({databaseUrl:process.env.TEST_DATABASE_URL});
    const second=await createStore({databaseUrl:process.env.TEST_DATABASE_URL});
    const id=randomUUID();
    try {
      await first.enqueue({projectId:id,kind:'cycle',key:'a'});
      await first.enqueue({projectId:id,kind:'cycle',key:'b'});
      const leases=await Promise.all([first.claim(id),second.claim(id)]);
      expect(new Set(leases.map(job=>job?.id)).size).toBe(2);
      expect(leases.every(Boolean)).toBe(true);
      for(const lease of leases) if(lease?.leaseToken) await first.complete(lease.id,lease.leaseToken);
      const results=await Promise.allSettled([first.reserveBudget(id,id,`${id}-a`,0.6,1),second.reserveBudget(id,id,`${id}-b`,0.6,1)]);
      expect(results.filter(result=>result.status==='rejected')).toHaveLength(0);
      const successes=results.filter(result=>result.status==='fulfilled'&&result.value);
      expect(successes).toHaveLength(1);
      expect(results.filter(result=>result.status==='fulfilled'&&!result.value)).toHaveLength(1);
    } finally {await first.close();await second.close();}
  });
});
