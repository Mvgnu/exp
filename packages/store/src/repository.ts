import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CollectionSchemas, IMMUTABLE_COLLECTIONS, JobSchema, WorkspaceSnapshotSchema, stableId, stableStringify } from '@deeplake/core';
import type { Collection, RecordsByCollection, Job, WorkspaceSnapshot } from '@deeplake/core';
import type { EnqueueInput, ListOptions, PutOptions, Repository, StoreOptions } from './contract.js';
import { isSerializationConflict, migrate, openDatabase } from './database.js';
import type { SqlDatabase, SqlSession } from './database.js';

const parsers: { [K in Collection]: { parse(input: unknown): RecordsByCollection[K] } } = CollectionSchemas;
const recordRow = z.object({ data:z.unknown(), revision:z.number().int().positive() });
const date = z.union([z.string(),z.date()]).transform(value => new Date(value).toISOString());
const jobRow = z.object({ id:z.string(),project_id:z.string(),kind:JobSchema.shape.kind,idempotency_key:z.string(),payload:JobSchema.shape.payload,status:JobSchema.shape.status,attempt:z.number().int(),max_attempts:z.number().int(),available_at:date,lease_owner:z.string().nullable(),lease_token:z.string().nullable(),lease_expires_at:date.nullable(),last_error:z.string().nullable(),created_at:date,updated_at:date });
function decodeJob(input: unknown): Job {
  const row=jobRow.parse(input);
  return JobSchema.parse({ id:row.id,projectId:row.project_id,kind:row.kind,key:row.idempotency_key,payload:row.payload,status:row.status,attempt:row.attempt,maxAttempts:row.max_attempts,availableAt:row.available_at,leaseOwner:row.lease_owner,leaseToken:row.lease_token,leaseExpiresAt:row.lease_expires_at,lastError:row.last_error,createdAt:row.created_at,updatedAt:row.updated_at });
}
function money(input: number): number {
  if (!Number.isFinite(input) || input < 0 || input > 1e9) throw new Error('Budget amounts must be finite, nonnegative and at most one billion USD');
  return Math.round(input*1e12)/1e12;
}
function interval(input: number, name: string, maximum=86400000): number {
  if (!Number.isInteger(input) || input < 1 || input > maximum) throw new Error(`${name} must be a positive integer no larger than ${maximum}`);
  return input;
}
export class RecordConflictError extends Error { readonly code='DEEPLAKE_RECORD_CONFLICT'; constructor(message:string) { super(message); this.name='RecordConflictError'; } }
export class ImmutableRecordError extends Error { readonly code='DEEPLAKE_IMMUTABLE_RECORD'; constructor(message:string) { super(message); this.name='ImmutableRecordError'; } }

class SqlRepository implements Repository {
  private active=true;
  constructor(private readonly db:SqlDatabase,private readonly session:SqlSession=db,private readonly nested=false,private readonly state={closed:false}) {}
  private ensure():void { if (!this.active || this.state.closed) throw new Error('Repository or transaction is closed'); }
  private async atomic<T>(fn:(repo:SqlRepository)=>Promise<T>,retry=true):Promise<T> {
    this.ensure();
    if (this.nested) return fn(this);
    for(let attempt=0;;attempt++) {
      try {
        return await this.db.transaction(async session => {
          const child=new SqlRepository(this.db,session,true,this.state);
          try { return await fn(child); } finally { child.active=false; }
        });
      } catch(error) {
        // Internal operations contain only database effects and can safely retry
        // the entire transaction. Caller-supplied callbacks must decide their own
        // retry policy because they may also perform external side effects.
        if(!retry||!isSerializationConflict(error)||attempt>=4)throw error;
        await new Promise<void>(resolve=>setTimeout(resolve,10*2**attempt));
      }
    }
  }
  async transaction<T>(fn:(repository:Repository)=>Promise<T>):Promise<T> {
    this.ensure();
    if (!this.nested) return this.atomic(fn,false);
    const savepoint=`sp_${randomUUID().replaceAll('-','')}`;
    await this.session.query(`SAVEPOINT ${savepoint}`);
    const child=new SqlRepository(this.db,this.session,true,this.state);
    try { const result=await fn(child); await this.session.query(`RELEASE SAVEPOINT ${savepoint}`); return result; }
    catch(error) { await this.session.query(`ROLLBACK TO SAVEPOINT ${savepoint}`); await this.session.query(`RELEASE SAVEPOINT ${savepoint}`); throw error; }
    finally { child.active=false; }
  }
  async get<K extends Collection>(collection:K,id:string):Promise<RecordsByCollection[K]|null> {
    this.ensure();
    const rows=await this.session.query('SELECT data, revision FROM deeplake_records WHERE collection=$1 AND id=$2',[collection,id]);
    return rows[0] ? parsers[collection].parse(recordRow.parse(rows[0]).data) : null;
  }
  async list<K extends Collection>(collection:K,options:ListOptions={}):Promise<RecordsByCollection[K][]> {
    this.ensure();
    const values:unknown[]=[collection];
    const clauses=['collection=$1'];
    if (options.projectId!==undefined) { values.push(options.projectId); clauses.push(`project_id=$${values.length}`); }
    if (options.where) {
      for (const key of Object.keys(options.where)) if (!Object.hasOwn(CollectionSchemas[collection].shape,key)) throw new Error(`Unknown filter field ${collection}.${key}`);
      values.push(JSON.stringify(options.where)); clauses.push(`data @> $${values.length}::jsonb`);
    }
    let tail=' ORDER BY created_at ASC, id ASC';
    if(options.limit!==undefined) { if(!Number.isInteger(options.limit)||options.limit<0||options.limit>100000) throw new Error('Invalid list limit'); values.push(options.limit);tail+=` LIMIT $${values.length}`; }
    if(options.offset!==undefined) { if(!Number.isInteger(options.offset)||options.offset<0) throw new Error('Invalid list offset');values.push(options.offset);tail+=` OFFSET $${values.length}`; }
    const rows=await this.session.query(`SELECT data, revision FROM deeplake_records WHERE ${clauses.join(' AND ')}${tail}`,values);
    return rows.map(row=>parsers[collection].parse(recordRow.parse(row).data));
  }
  async put<K extends Collection>(collection:K,input:RecordsByCollection[K],options:PutOptions={}):Promise<number> {
    this.ensure();
    const parsed=parsers[collection].parse(input);
    const projectId='projectId' in parsed ? parsed.projectId : parsed.id;
    const serialized=stableStringify(parsed);
    if(options.expectedRevision!==undefined && (!Number.isInteger(options.expectedRevision)||options.expectedRevision<0)) throw new Error('Invalid expected revision');
    return this.atomic(async tx=>{
      const rows=await tx.session.query('SELECT data,revision,project_id FROM deeplake_records WHERE collection=$1 AND id=$2 FOR UPDATE',[collection,parsed.id]);
      if(rows[0]) {
        const current=recordRow.parse(rows[0]);
        if(rows[0].project_id!==projectId) throw new RecordConflictError('Record identifier belongs to another project');
        if(options.expectedRevision!==undefined&&current.revision!==options.expectedRevision) throw new RecordConflictError('Record revision changed');
        if(stableStringify(current.data)===serialized) return current.revision;
        if(IMMUTABLE_COLLECTIONS.has(collection)) throw new ImmutableRecordError(`Cannot overwrite immutable ${collection}/${parsed.id}`);
        if(options.insertOnly) throw new RecordConflictError(`Record already exists: ${collection}/${parsed.id}`);
        await tx.session.query('UPDATE deeplake_records SET data=$3::jsonb,revision=revision+1,updated_at=now() WHERE collection=$1 AND id=$2',[collection,parsed.id,serialized]);
        return current.revision+1;
      }
      if(options.expectedRevision!==undefined&&options.expectedRevision!==0) throw new RecordConflictError('Expected record does not exist');
      await tx.session.query('INSERT INTO deeplake_records (collection,id,project_id,data) VALUES ($1,$2,$3,$4::jsonb)',[collection,parsed.id,projectId,serialized]);
      return 1;
    });
  }
  async enqueue(input:EnqueueInput):Promise<Job> {
    const validated=z.object({projectId:z.string().min(1),kind:JobSchema.shape.kind,key:z.string().min(1).max(1000),payload:JobSchema.shape.payload.default({}),maxAttempts:z.number().int().min(1).max(100).default(3),availableAt:z.string().datetime({offset:true}).optional()}).parse(input);
    const id=stableId('job',validated.projectId,validated.key);
    return this.atomic(async tx=>{
      await tx.session.query('INSERT INTO deeplake_jobs (id,project_id,kind,idempotency_key,payload,max_attempts,available_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,COALESCE($7::timestamptz,now())) ON CONFLICT (project_id,idempotency_key) DO NOTHING',[id,validated.projectId,validated.kind,validated.key,JSON.stringify(validated.payload),validated.maxAttempts,validated.availableAt??null]);
      const rows=await tx.session.query('SELECT * FROM deeplake_jobs WHERE id=$1',[id]);
      const job=decodeJob(rows[0]);
      if(job.kind!==validated.kind||stableStringify(job.payload)!==stableStringify(validated.payload)||job.maxAttempts!==validated.maxAttempts) throw new RecordConflictError('Job idempotency key was reused with different work');
      return job;
    });
  }
  async claim(owner:string,leaseMs=60000,now=new Date().toISOString()):Promise<Job|null> {
    if(!owner.trim())throw new Error('Worker owner is required');
    interval(leaseMs,'Lease duration');
    const instant=z.string().datetime({offset:true}).parse(now);
    const expiry=new Date(Date.parse(instant)+leaseMs).toISOString();
    return this.atomic(async tx=>{
      await tx.session.query("UPDATE deeplake_jobs SET status='failed',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,last_error='Worker lease expired after final attempt',updated_at=$1 WHERE status='running' AND lease_expires_at<=$1::timestamptz AND attempt>=max_attempts",[instant]);
      const rows=await tx.session.query(`WITH next_job AS (
        SELECT id FROM deeplake_jobs
        WHERE attempt<max_attempts AND ((status='queued' AND available_at<=$1::timestamptz) OR (status='running' AND lease_expires_at<=$1::timestamptz))
        ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE deeplake_jobs AS j SET status='running',attempt=j.attempt+1,lease_owner=$2,lease_token=$3,lease_expires_at=$4::timestamptz,updated_at=$1::timestamptz FROM next_job WHERE j.id=next_job.id RETURNING j.*`,[instant,owner,randomUUID(),expiry]);
      return rows[0]?decodeJob(rows[0]):null;
    });
  }
  async heartbeat(id:string,token:string,leaseMs=60000):Promise<boolean> {
    this.ensure(); interval(leaseMs,'Lease duration');
    const rows=await this.session.query("UPDATE deeplake_jobs SET lease_expires_at=now()+($3::double precision*interval '1 millisecond'),updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_expires_at>now() RETURNING id",[id,token,leaseMs]);
    return rows.length===1;
  }
  async complete(id:string,token:string):Promise<boolean> {
    this.ensure();
    const rows=await this.session.query("UPDATE deeplake_jobs SET status='succeeded',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_expires_at>now() RETURNING id",[id,token]);
    return rows.length===1;
  }
  async fail(id:string,token:string,error:string,retryDelayMs=1000):Promise<boolean> {
    this.ensure(); if(!Number.isInteger(retryDelayMs)||retryDelayMs<0||retryDelayMs>86400000)throw new Error('Invalid retry delay');
    const rows=await this.session.query("UPDATE deeplake_jobs SET status=CASE WHEN attempt<max_attempts THEN 'queued' ELSE 'failed' END,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,last_error=$3,available_at=now()+($4::double precision*interval '1 millisecond'),updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_expires_at>now() RETURNING id",[id,token,error.slice(0,8000),retryDelayMs]);
    return rows.length===1;
  }
  async cancel(id:string):Promise<boolean> {
    this.ensure();
    const rows=await this.session.query("UPDATE deeplake_jobs SET status='cancelled',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND status IN ('queued','running') RETURNING id",[id]);
    return rows.length===1;
  }
  async listJobs(projectId?:string):Promise<Job[]> {
    this.ensure();
    const rows=await this.session.query(`SELECT * FROM deeplake_jobs ${projectId!==undefined?'WHERE project_id=$1':''} ORDER BY created_at,id`,projectId!==undefined?[projectId]:[]);
    return rows.map(decodeJob);
  }
  async reserveBudget(projectId:string,runId:string,key:string,amountUsd:number,limitUsd:number):Promise<boolean> {
    if(!projectId||!runId||!key)throw new Error('Budget reservation requires project, run and key');
    const amount=money(amountUsd),limit=money(limitUsd);
    return this.atomic(async tx=>{
      await tx.session.query('INSERT INTO deeplake_budget_runs (project_id,run_id,limit_usd) VALUES ($1,$2,$3) ON CONFLICT (project_id,run_id) DO NOTHING',[projectId,runId,limit]);
      const runs=await tx.session.query('SELECT limit_usd FROM deeplake_budget_runs WHERE project_id=$1 AND run_id=$2 FOR UPDATE',[projectId,runId]);
      const savedLimit=z.coerce.number().parse(runs[0]?.limit_usd);
      if(savedLimit!==limit)throw new RecordConflictError('Run budget limit cannot change after reservations begin');
      const existing=await tx.session.query('SELECT project_id,run_id,reserved_usd FROM deeplake_budget_reservations WHERE reservation_key=$1',[key]);
      if(existing[0]) {
        if(existing[0].project_id!==projectId||existing[0].run_id!==runId||z.coerce.number().parse(existing[0].reserved_usd)!==amount)throw new RecordConflictError('Reservation key was reused for different work');
        return true;
      }
      const totals=await tx.session.query('SELECT COALESCE(SUM(COALESCE(actual_usd,reserved_usd)),0)::text AS total FROM deeplake_budget_reservations WHERE project_id=$1 AND run_id=$2',[projectId,runId]);
      const used=z.coerce.number().parse(totals[0]?.total);
      if(money(used+amount)>limit)return false;
      await tx.session.query('INSERT INTO deeplake_budget_reservations (reservation_key,project_id,run_id,reserved_usd) VALUES ($1,$2,$3,$4)',[key,projectId,runId,amount]);
      return true;
    });
  }
  async settleBudget(key:string,actualUsd:number):Promise<void> {
    const actual=money(actualUsd);
    await this.atomic(async tx=>{
      const rows=await tx.session.query('SELECT actual_usd FROM deeplake_budget_reservations WHERE reservation_key=$1 FOR UPDATE',[key]);
      if(!rows[0])throw new Error('Unknown budget reservation');
      if(rows[0].actual_usd!==null) {
        if(z.coerce.number().parse(rows[0].actual_usd)!==actual)throw new RecordConflictError('A settled provider charge is immutable');
        return;
      }
      await tx.session.query('UPDATE deeplake_budget_reservations SET actual_usd=$2,settled_at=now() WHERE reservation_key=$1',[key,actual]);
    });
  }
  async snapshot(mode:'demo'|'live'='live'):Promise<WorkspaceSnapshot> {
    return this.transaction(async tx=>WorkspaceSnapshotSchema.parse({version:1,generatedAt:new Date().toISOString(),mode,projects:await tx.list('projects'),schemas:await tx.list('schemas'),sources:await tx.list('sources'),sourceVersions:await tx.list('sourceVersions'),segments:await tx.list('segments'),entities:await tx.list('entities'),observations:await tx.list('observations'),findings:await tx.list('findings'),proposals:await tx.list('proposals'),runs:await tx.list('runs'),events:await tx.list('events'),publications:await tx.list('publications'),usage:await tx.list('usage'),jobs:await tx.listJobs()}));
  }
  async close():Promise<void> {
    if(this.nested)throw new Error('Only the root repository can be closed');
    if(!this.state.closed){this.state.closed=true;await this.db.close();}
  }
}

export async function createStore(options:StoreOptions={}):Promise<Repository> {
  if(options.memory&&options.databaseUrl)throw new Error('Choose either in-memory or external PostgreSQL storage');
  const db=await openDatabase(options);
  try {await migrate(db);return new SqlRepository(db);}
  catch(error){await db.close();throw error;}
}
