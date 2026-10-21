import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  DomainSchemaSchema, EntitySchema, FindingSchema, JsonValueSchema, ObservationSchema, ProposalSchema,
  RunSchema, SegmentSchema, SourceSchema, SourceVersionSchema, UsageSchema, buildPublication,
  diffSchemas, entityId, hash, stableId, stableStringify, systemClock, validateDomainSchema, validateEvidence, validateFieldValue,
} from '@deeplake/core';
import type {
  AcquiredDocument, DomainSchema, EngineEvent, Entity, EntityType, Evidence, ExtractedValue, ExtractionResult,
  Finding, Job, JsonValue, ModelResult, ModelUsage, Observation, ParsedDocument, Project, Proposal,
  Publication, ReasoningRequest, Run, Scope, SearchQuery, Segment, Source, SourceVersion,
} from '@deeplake/core';
import { canonicalizeUrl, enumerateCollection } from '@deeplake/ingest';
import type { Repository } from '@deeplake/store';
import type { CycleOptions, Engine, EngineDependencies } from './contract.js';
import {
  AuditResultSchema, EVIDENCE_SYSTEM, QueryPlanSchema, SchemaDraftSchema, StructuredExtractionSchema, TASKS,
} from './workflows.js';
import type { FindingDraft, SchemaDraft } from './workflows.js';
import { extractStructuredRecord } from './structured.js';

export class BudgetExceededError extends Error { constructor(message: string) { super(message); this.name = 'BudgetExceededError'; } }
export class LeaseLostError extends Error { constructor(message = 'Work was cancelled or its lease was lost') { super(message); this.name = 'LeaseLostError'; } }
export class WorkflowError extends Error { constructor(message: string) { super(message); this.name = 'WorkflowError'; } }

interface Execution {
  project: Project; run: Run; job: Job | null; sequence: number; reservedCalls: number;
  processed: Set<string>; queries: Set<string>; countedSources: Set<string>;
}
interface AcquiredSource { source: Source; version: SourceVersion; segments: Segment[]; changed: boolean }
const JsonStringArray = z.array(z.string());
const ModelUsageSchema = z.object({ provider: z.string(), model: z.string(), inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(), estimatedCostUsd: z.number().nonnegative(), reportedCostUsd: z.number().nonnegative().nullable() });
const MAX_AUDIT_CHARS = 60_000;
// Change this when extraction/grounding prompts or validation semantics change.
const EXTRACTION_PROTOCOL = 'deeplake-extraction/1.1.0';
const AUDIT_PROTOCOL = 'deeplake-audit/1.0.0';

function errorText(error: unknown): string { return error instanceof Error ? error.message : 'Unknown workflow error'; }
function json(value: unknown): JsonValue { return JsonValueSchema.parse(value); }
function asScalar(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' || typeof value === 'boolean' ? String(value) : null;
}
function numberOccursInQuote(value: number, quote: string): boolean {
  const tokens = quote.match(/[-+]?\d+(?:[.,\u00a0 ]\d+)*(?:[eE][-+]?\d+)?/g) ?? [];
  return tokens.some(token => {
    const compact = token.replace(/[ \u00a0]/g, '');
    const variants = new Set<string>([compact]);
    if (!/[eE]/.test(compact)) {
      variants.add(compact.replace(/[.,]/g, ''));
      const decimalAt = Math.max(compact.lastIndexOf('.'), compact.lastIndexOf(','));
      if (decimalAt >= 0) variants.add(compact.slice(0, decimalAt).replace(/[.,]/g, '') + '.' + compact.slice(decimalAt + 1));
    }
    return [...variants].some(candidate => candidate.length > 0 && Number(candidate) === value);
  });
}
function segmentEvidence(segment: Segment): Evidence | null {
  if (!segment.text.trim()) return null;
  const start = segment.text.search(/\S/);
  const end = Math.min(segment.text.length, start + 220);
  return { sourceVersionId: segment.sourceVersionId, segmentId: segment.id, start, end, quote: segment.text.slice(start, end), ...(segment.page === undefined ? {} : { page: segment.page }) };
}
function evidenceFor(value: ExtractedValue, segment: Segment): Evidence | null {
  if (!value.quote || value.start === null || value.end === null) return null;
  const evidence: Evidence = { sourceVersionId: segment.sourceVersionId, segmentId: segment.id, start: value.start, end: value.end, quote: value.quote, ...(segment.page === undefined ? {} : { page: segment.page }) };
  return validateEvidence(evidence, segment) ? evidence : null;
}
function batches(segments: Segment[]): Segment[][] {
  const result: Segment[][] = [];
  let batch: Segment[] = [], size = 0;
  for (const segment of segments) {
    if (size > 0 && size + segment.text.length > MAX_AUDIT_CHARS) { result.push(batch); batch = []; size = 0; }
    batch.push(segment); size += segment.text.length;
  }
  if (batch.length) result.push(batch);
  return result;
}

/** All effects live behind an execution context. No mutable project state is shared between calls. */
export function createEngine(deps: EngineDependencies): Engine {
  const repository = deps.repository;
  const clock = deps.clock ?? systemClock;

  async function requireProject(id: string, repo: Repository = repository): Promise<Project> {
    const project = await repo.get('projects', id);
    if (!project) throw new WorkflowError(`Project ${id} does not exist`);
    return project;
  }
  async function fence(execution: Execution, repo: Repository = repository): Promise<void> {
    if (!execution.job) return;
    const current = (await repo.listJobs(execution.project.id)).find(job => job.id === execution.job?.id);
    if (!current || current.status !== 'running' || current.leaseToken !== execution.job.leaseToken || !current.leaseExpiresAt || Date.parse(current.leaseExpiresAt) <= Date.now()) throw new LeaseLostError();
  }
  async function updateRun(execution: Execution): Promise<void> {
    await fence(execution);
    await repository.put('runs', RunSchema.parse(execution.run));
  }
  async function setProjectStatus(execution: Execution, status: Project['status']): Promise<Project> {
    return transactionRetry(async tx => {
      await fence(execution, tx);
      const current = await requireProject(execution.project.id, tx);
      if (current.status === 'paused') {
        if (status === 'exploring') throw new WorkflowError('Project is paused');
        return current;
      }
      const updated: Project = { ...current, status, updatedAt: clock.now() };
      await tx.put('projects', updated);
      return updated;
    });
  }
  async function recordCancellation(execution: Execution): Promise<void> {
    if (!execution.job) return;
    const cancelled = await transactionRetry(async tx => {
      const job = (await tx.listJobs(execution.project.id)).find(item => item.id === execution.job?.id);
      // Only a durable, terminal operator cancellation permits this exceptional write.
      // Lease expiry or a replacement worker must never let an old owner alter its run.
      if (job?.status !== 'cancelled') return null;
      const current = await tx.get('runs', execution.run.id);
      if (!current || current.status === 'completed' || current.status === 'cancelled') return current;
      const run = RunSchema.parse({ ...current, status: 'cancelled', phase: 'cancelled', completedAt: clock.now(), error: 'Cancelled by operator' });
      await tx.put('runs', run);
      const eventId = stableId('event', run.id, 'cancelled');
      if (!await tx.get('events', eventId)) await tx.put('events', { id: eventId, projectId: run.projectId, runId: run.id, phase: 'cancelled', message: 'Run cancelled; no further workflow effects will be applied', data: { jobId: job.id }, level: 'warning', createdAt: clock.now() }, { insertOnly: true });
      const active = await tx.list('runs', { projectId: run.projectId, where: { status: 'running' } });
      const project = await requireProject(run.projectId, tx);
      if (!active.length && project.status !== 'paused') await tx.put('projects', { ...project, status: 'review', updatedAt: clock.now() });
      return run;
    });
    if (cancelled) execution.run = cancelled;
  }
  async function event(execution: Execution, phase: string, message: string, data: Record<string, JsonValue> = {}, level: EngineEvent['level'] = 'info'): Promise<void> {
    await fence(execution);
    const record: EngineEvent = {
      id: stableId('event', execution.run.id, phase, message, data), projectId: execution.project.id,
      runId: execution.run.id, phase, message, data, level, createdAt: clock.now(),
    };
    if (!await repository.get('events', record.id)) await repository.put('events', record, { insertOnly: true });
    execution.run.phase = phase;
    await updateRun(execution);
  }
  async function addFinding(execution: Execution, input: Omit<Finding, 'id'|'projectId'|'runId'|'status'|'resolution'|'createdAt'>): Promise<Finding> {
    await fence(execution);
    const id = stableId('finding', execution.project.id, execution.project.currentSchemaId, input.kind, input.title, input.field, input.entityId, input.evidence);
    const existing = await repository.get('findings', id);
    if (existing) return existing;
    const record = FindingSchema.parse({ ...input, id, projectId: execution.project.id, runId: execution.run.id, status: 'open', resolution: null, createdAt: clock.now() });
    await repository.put('findings', record, { insertOnly: true });
    execution.run.stats.findings++;
    return record;
  }
  async function usage(execution: Execution, operation: string, result: ModelUsage, reservation: string): Promise<void> {
    const validated = ModelUsageSchema.parse(result);
    await fence(execution);
    await repository.settleBudget(reservation, validated.reportedCostUsd ?? validated.estimatedCostUsd);
    const record = UsageSchema.parse({ ...validated, id: stableId('usage', execution.run.id, reservation), projectId: execution.project.id, runId: execution.run.id, operation, createdAt: clock.now() });
    if (!await repository.get('usage', record.id)) await repository.put('usage', record, { insertOnly: true });
    execution.run.stats.estimatedCostUsd += validated.reportedCostUsd ?? validated.estimatedCostUsd;
    await updateRun(execution);
    if (execution.run.stats.estimatedCostUsd > execution.project.budget.maxUsd) throw new BudgetExceededError('Reported provider cost exhausted the run budget; no further calls will be made');
  }
  async function billable<T>(execution: Execution, operation: string, estimate: number, call: () => Promise<ModelResult<T>>): Promise<T> {
    await fence(execution);
    const key = stableId('reservation', execution.run.id, execution.job?.attempt ?? 0, operation, execution.reservedCalls++);
    const requested = execution.project.mode === 'demo' ? 0 : estimate;
    if (!await repository.reserveBudget(execution.project.id, execution.run.id, key, requested, execution.project.budget.maxUsd)) throw new BudgetExceededError(`Run budget cannot reserve the next ${operation} call`);
    // Unknown outcomes retain their reservation: a provider may have billed before a network failure.
    const result = await call();
    await usage(execution, operation, result.usage, key);
    return result.data;
  }
  async function reason<T>(execution: Execution, role: ReasoningRequest['role'], task: string, input: unknown, schema: z.ZodType<T>, instructions: string, onModel?: (model: string) => void): Promise<T> {
    const payload = json(input);
    // Conservative configured-provider estimate, not an invoice guarantee. Actual reported use is retained.
    const estimate = Buffer.byteLength(stableStringify(payload)) / 1_000_000 * 10 + execution.project.budget.maxOutputTokens / 1_000_000 * 50;
    return billable(execution, task, estimate, async () => {
      const result = await deps.reasoner.complete({ role, task, system: `${EVIDENCE_SYSTEM}\n${instructions}`, input: payload, maxOutputTokens: execution.project.budget.maxOutputTokens }, schema);
      onModel?.(result.usage.model);
      return { ...result, data: schema.parse(result.data) };
    });
  }
  async function sourceFor(execution: Execution, url: string, title = '', family = 'web', discoveredBy = 'seed', relevance = 'Explicit project seed'): Promise<Source> {
    const normalized = canonicalizeUrl(url);
    const id = stableId('source', execution.project.id, normalized);
    const found = await repository.get('sources', id);
    if (found) return found;
    await fence(execution);
    const source = SourceSchema.parse({ id, projectId: execution.project.id, url: normalized, title: title || normalized, family, discoveredBy, relevance, status: 'pending', latestVersionId: null, etag: null, lastModified: null, lastCheckedAt: null, error: null, createdAt: clock.now() });
    await repository.put('sources', source, { insertOnly: true });
    return source;
  }
  async function countSource(execution: Execution, key: string): Promise<void> {
    if (execution.countedSources.has(key)) return;
    if (execution.run.stats.sources >= execution.project.budget.maxSources) throw new BudgetExceededError('Maximum source budget reached');
    execution.countedSources.add(key);
    execution.run.stats.sources++;
    await event(execution, 'source.attempt', 'Source processing budget reserved', { key });
  }
  async function acquire(execution: Execution, source: Source): Promise<AcquiredSource | null> {
    await fence(execution);
    await countSource(execution, source.id);
    let document: AcquiredDocument;
    try {
      document = await billable(execution, 'acquire', 0.01, async () => {
        const fetched = await deps.acquirer.fetch(source.url, { ...(source.etag ? { etag: source.etag } : {}), ...(source.lastModified ? { lastModified: source.lastModified } : {}) });
        const reported = fetched.acquisition === 'exa-contents' && fetched.headers['x-deeplake-provider-cost-usd'] !== undefined ? z.coerce.number().nonnegative().parse(fetched.headers['x-deeplake-provider-cost-usd']) : null;
        return { data: fetched, usage: { provider: fetched.acquisition, model: fetched.acquisition, inputTokens: 0, outputTokens: 0, estimatedCostUsd: fetched.acquisition === 'exa-contents' ? 0.001 : 0, reportedCostUsd: reported } };
      });
    } catch (error) {
      if (error instanceof LeaseLostError || error instanceof BudgetExceededError) throw error;
      await fence(execution);
      await repository.put('sources', { ...source, status: 'failed', error: errorText(error), lastCheckedAt: clock.now() });
      await addFinding(execution, { kind: 'acquisition', severity: 'warning', title: 'Source could not be acquired', description: `${source.url}: ${errorText(error)}`, action: 'Review the fetch error and retry this source. Existing evidence has been retained.', evidence: [], entityId: null, field: null });
      await event(execution, 'acquisition', 'Source fetch failed', { sourceId: source.id, url: source.url }, 'warning');
      return null;
    }
    await fence(execution);
    if (document.notModified) {
      if (!source.latestVersionId) throw new WorkflowError('A source without a stored version returned not-modified');
      const version = await repository.get('sourceVersions', source.latestVersionId);
      if (!version) throw new WorkflowError('Source latest version does not exist');
      const updated: Source = { ...source, status: 'unchanged', error: null, lastCheckedAt: clock.now() };
      await repository.put('sources', updated);
      return { source: updated, version, segments: await repository.list('segments', { projectId: source.projectId, where: { sourceVersionId: version.id } }), changed: false };
    }
    if (document.status < 200 || document.status >= 300) throw new WorkflowError(`Acquirer returned unsuccessful HTTP status ${document.status}`);
    const contentHash = hash(document.bytes);
    if (source.latestVersionId) {
      const prior = await repository.get('sourceVersions', source.latestVersionId);
      if (prior?.contentHash === contentHash) {
        const updated: Source = { ...source, status: 'unchanged', error: null, lastCheckedAt: clock.now(), etag: document.headers.etag ?? source.etag, lastModified: document.headers['last-modified'] ?? source.lastModified };
        await repository.put('sources', updated);
        return { source: updated, version: prior, segments: await repository.list('segments', { projectId: source.projectId, where: { sourceVersionId: prior.id } }), changed: false };
      }
    }
    const blob = await deps.blobs.put(document.bytes);
    let parsed: ParsedDocument;
    try { parsed = await deps.parser.parse(document); }
    catch (error) {
      parsed = { title: source.title, text: '', parserVersion: 'parse-failed', segments: [], links: [], warnings: [`Parsing failed: ${errorText(error)}`] };
    }
    const versionId = stableId('sourceversion', source.id, contentHash, parsed.parserVersion);
    const existing = await repository.get('sourceVersions', versionId);
    const version = existing ?? SourceVersionSchema.parse({ id: versionId, projectId: source.projectId, sourceId: source.id, url: document.url, fetchedAt: document.acquiredAt, contentHash, blobKey: blob.key, mediaType: document.mediaType, byteLength: document.bytes.byteLength, acquisition: document.acquisition, headers: document.headers, parserVersion: parsed.parserVersion, textHash: hash(parsed.text), title: parsed.title, warnings: parsed.warnings });
    const segments = parsed.segments.map(segment => SegmentSchema.parse({ ...segment, id: stableId('segment', version.id, segment.index, hash(segment.text)), projectId: source.projectId, sourceVersionId: version.id }));
    const usable = segments.some(segment => segment.quality !== 'blocked' && segment.text.trim());
    const updated: Source = { ...source, title: parsed.title || source.title, latestVersionId: version.id, status: usable ? 'fetched' : 'failed', error: usable ? null : parsed.warnings.join('; ') || 'No usable source text', etag: document.headers.etag ?? null, lastModified: document.headers['last-modified'] ?? null, lastCheckedAt: clock.now() };
    await fence(execution);
    await repository.transaction(async tx => {
      if (!existing) await tx.put('sourceVersions', version, { insertOnly: true });
      for (const segment of segments) if (!await tx.get('segments', segment.id)) await tx.put('segments', segment, { insertOnly: true });
      await tx.put('sources', updated);
    });
    if (!usable || parsed.warnings.length) {
      const sample = segments[0] ? segmentEvidence(segments[0]) : null;
      await addFinding(execution, { kind: 'acquisition', severity: usable ? 'warning' : 'critical', title: usable ? 'Document parsing needs review' : 'Document has no usable text', description: `${source.url}: ${parsed.warnings.join('; ') || 'No usable source segments'}`, action: 'Inspect the preserved original bytes; repair parsing or supply OCR before extraction.', evidence: sample ? [sample] : [], entityId: null, field: null });
    }
    await event(execution, 'acquisition', 'Source snapshot saved', { sourceId: source.id, sourceVersionId: version.id, segments: segments.length, changed: true });
    // Collections are frontier candidates, not recursive unrestricted crawling.
    let entries: Awaited<ReturnType<typeof enumerateCollection>> = [];
    try { entries = await enumerateCollection(document); }
    catch (error) { await event(execution, 'acquisition', 'Source collection could not be enumerated', { sourceId: source.id, error: errorText(error) }, 'warning'); }
    for (const entry of entries.slice(0, execution.project.budget.maxSources)) {
      try { if (entry.url !== source.url) await sourceFor(execution, entry.url, entry.title, entry.family, source.url, 'Discovered in a source collection'); }
      catch (error) { if (error instanceof LeaseLostError || error instanceof BudgetExceededError) throw error; /* A malformed link remains unacquired. */ }
    }
    return { source: updated, version, segments, changed: true };
  }
  async function reparseSource(execution: Execution, source: Source, original: SourceVersion): Promise<AcquiredSource> {
    await fence(execution);
    const priorSegments = await repository.list('segments', { projectId: execution.project.id, where: { sourceVersionId: original.id } });
    const parseAndStore = async () => {
      const bytes = await deps.blobs.get(original.blobKey);
      if (hash(bytes) !== original.contentHash || bytes.byteLength !== original.byteLength) throw new WorkflowError('Preserved source bytes failed content-hash or length verification');
      const parsed = await deps.parser.parse({ url: original.url, status: 200, bytes, mediaType: original.mediaType, headers: original.headers, acquiredAt: original.fetchedAt, acquisition: original.acquisition, notModified: false });
      await fence(execution);
      if (!parsed.parserVersion.trim()) throw new WorkflowError('Parser must identify its version');
      if (parsed.segments.some(segment => segment.parserVersion !== parsed.parserVersion || parsed.text.slice(segment.start, segment.end) !== segment.text)) throw new WorkflowError('Parser emitted segment text or version inconsistent with its document');
      const version = SourceVersionSchema.parse({ ...original, id: stableId('sourceversion', source.id, original.contentHash, parsed.parserVersion), parserVersion: parsed.parserVersion, textHash: hash(parsed.text), title: parsed.title, warnings: parsed.warnings });
      const segments = parsed.segments.map(segment => SegmentSchema.parse({ ...segment, id: stableId('segment', version.id, segment.index, hash(segment.text)), projectId: execution.project.id, sourceVersionId: version.id }));
      const usable = segments.some(segment => segment.quality !== 'blocked' && segment.text.trim());
      const saved = await transactionRetry(async tx => {
        await fence(execution, tx);
        const current = await tx.get('sources', source.id);
        if (!current || current.projectId !== execution.project.id) throw new WorkflowError('Reparse source no longer exists in this project');
        const existing = await tx.get('sourceVersions', version.id);
        if (existing) {
          const existingSegments = await tx.list('segments', { projectId: execution.project.id, where: { sourceVersionId: version.id } });
          const ordered = (items: Segment[]) => [...items].sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
          if (existing.textHash !== version.textHash || stableStringify(ordered(existingSegments)) !== stableStringify(ordered(segments))) throw new WorkflowError('Parser output changed without a parser version change; bump its version before reparsing');
        } else {
          await tx.put('sourceVersions', version, { insertOnly: true });
          for (const segment of segments) await tx.put('segments', segment, { insertOnly: true });
        }
        const advancesLatest = usable && current.latestVersionId === original.id && version.id !== original.id;
        const updated: Source = advancesLatest ? { ...current, latestVersionId: version.id, title: parsed.title || current.title, status: 'fetched', error: null } : current;
        // lastCheckedAt, ETag and fetchedAt describe the original acquisition, not this local parse.
        if (advancesLatest) await tx.put('sources', updated);
        return { source: updated, version: existing ?? version, segments, changed: !existing, advancesLatest };
      });
      if (!usable) throw new WorkflowError(`Reparsing produced no usable source segments: ${parsed.warnings.join('; ') || 'empty or blocked parsed text'}`);
      return saved;
    };
    let saved: Awaited<ReturnType<typeof parseAndStore>>;
    try { saved = await parseAndStore(); }
    catch (error) {
      if (error instanceof LeaseLostError || error instanceof BudgetExceededError) throw error;
      const evidence = priorSegments[0] ? segmentEvidence(priorSegments[0]) : null;
      await addFinding(execution, { kind: 'acquisition', severity: 'warning', title: 'Source could not be reparsed', description: `${original.url}: ${errorText(error)}`, action: 'Inspect the preserved original bytes, repair or configure the parser with a new version, and retry explicit reparse. Existing source history and latest pointer were retained.', evidence: evidence ? [evidence] : [], entityId: null, field: null });
      await event(execution, 'reparse', 'Source reparse failed; original source retained', { sourceId: source.id, sourceVersionId: original.id, error: errorText(error) }, 'warning');
      throw error;
    }
    await event(execution, 'reparse', 'Preserved source bytes reparsed', { previousSourceVersionId: original.id, sourceVersionId: saved.version.id, parserVersion: saved.version.parserVersion, segments: saved.segments.length, latestAdvanced: saved.advancesLatest });
    if (saved.version.warnings.length) {
      const evidence = saved.segments[0] ? segmentEvidence(saved.segments[0]) : null;
      await addFinding(execution, { kind: 'acquisition', severity: 'warning', title: 'Reparsed document needs review', description: `${original.url}: ${saved.version.warnings.join('; ')}`, action: 'Inspect the new parsed version against preserved original bytes before publication.', evidence: evidence ? [evidence] : [], entityId: null, field: null });
    }
    return saved;
  }
  async function discover(execution: Execution, iteration: number): Promise<void> {
    if (execution.run.stats.queries >= execution.project.budget.maxSearchQueries) return;
    const sources = await repository.list('sources', { projectId: execution.project.id });
    const findings = (await repository.list('findings', { projectId: execution.project.id })).filter(finding => finding.status === 'open');
    const familyCounts: Record<string, number> = {};
    for (const source of sources) familyCounts[source.family] = (familyCounts[source.family] ?? 0) + 1;
    const plan = await reason(execution, 'planner', TASKS.plan, {
      project: { id: execution.project.id, contract: execution.project.contract }, iteration,
      coverage: { familyCounts, knownUrls: sources.map(source => source.url), openFindings: findings.map(finding => ({ kind: finding.kind, title: finding.title, description: finding.description })) },
      remainingQueries: execution.project.budget.maxSearchQueries - execution.run.stats.queries,
    }, QueryPlanSchema, 'Generate diverse search queries with explicit objectives. Reserve at least one query for exploring outside the current representation. Prefer primary sources and source collections. Return no queries when additional search cannot address a known gap within scope.');
    const queries: SearchQuery[] = [...plan.queries].sort((a, b) => Number(b.exploratory) - Number(a.exploratory));
    if (queries.length && !queries.some(query => query.exploratory)) {
      await event(execution, 'discovery', 'Query plan has no exploratory query; exploration coverage remains unverified', {}, 'warning');
    }
    for (const query of queries) {
      if (execution.run.stats.queries >= execution.project.budget.maxSearchQueries) break;
      const queryKey = query.query.trim().toLowerCase();
      if (execution.queries.has(queryKey)) continue;
      execution.queries.add(queryKey);
      execution.run.stats.queries++;
      const hits = await billable(execution, 'search', 0.02, () => deps.search.search(query, 10));
      for (const hit of hits) {
        try { await sourceFor(execution, hit.url, hit.title, hit.family || query.family, `${deps.search.name}: ${query.query}`, query.objective); }
        catch (error) { if (error instanceof LeaseLostError || error instanceof BudgetExceededError) throw error; }
      }
      await event(execution, 'discovery', 'Search completed', { query: query.query, objective: query.objective, results: hits.length, exploratory: query.exploratory });
    }
  }
  function diverse(sources: Source[]): Source[] {
    const buckets = new Map<string, Source[]>();
    for (const source of [...sources].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
      const key = `${source.family}:${new URL(source.url).hostname}`;
      const bucket = buckets.get(key) ?? []; bucket.push(source); buckets.set(key, bucket);
    }
    const result: Source[] = [];
    while ([...buckets.values()].some(bucket => bucket.length)) for (const bucket of buckets.values()) { const source = bucket.shift(); if (source) result.push(source); }
    return result;
  }
  async function bootstrap(execution: Execution, acquired: AcquiredSource[]): Promise<DomainSchema> {
    if (execution.project.currentSchemaId) {
      const existing = await repository.get('schemas', execution.project.currentSchemaId);
      if (!existing || existing.projectId !== execution.project.id) throw new WorkflowError('Current schema is missing or belongs to another project');
      return validateDomainSchema(existing);
    }
    const sample = acquired.slice(0, 8).flatMap(item => item.segments.filter(segment => segment.quality !== 'blocked').slice(0, 6));
    if (!sample.length) throw new WorkflowError('No usable source sample is available to bootstrap the schema');
    const draft = await reason(execution, 'architect', TASKS.bootstrap, {
      project: { id: execution.project.id, contract: execution.project.contract },
      sources: acquired.slice(0, 8).map(item => ({ id: item.source.id, url: item.source.url, family: item.source.family, sourceVersionId: item.version.id })),
      segments: sample,
    }, SchemaDraftSchema, 'Propose a bounded domain schema for the answerability contract. Use explicit identity and applicability fields. Do not model every incidental detail. Use json with a JSON Schema for meaning that requires nested alternatives; do not flatten qualifications. Include all identityFields/scopeFields in fields. Schema metadata/versioning is controlled by the engine.');
    const schema = makeSchema(execution.project, SchemaDraftSchema.parse(draft), null);
    await fence(execution);
    await repository.transaction(async tx => {
      const current = await requireProject(execution.project.id, tx);
      if (current.currentSchemaId) throw new WorkflowError('Another run established a schema; retry using that version');
      await tx.put('schemas', schema, { insertOnly: true });
      execution.project = { ...current, currentSchemaId: schema.id, updatedAt: clock.now() };
      await tx.put('projects', execution.project);
    });
    await event(execution, 'schema', 'Initial schema established from source sample', { schemaId: schema.id, entityTypes: schema.entityTypes.length, sampledSegments: sample.length });
    return schema;
  }
  function makeSchema(project: Project, draft: SchemaDraft, previous: DomainSchema | null): DomainSchema {
    return validateDomainSchema(DomainSchemaSchema.parse({ ...draft, id: stableId('schema', project.id, previous?.id ?? null, draft), projectId: project.id, version: (previous?.version ?? 0) + 1, previousId: previous?.id ?? null, createdAt: clock.now() }));
  }
  async function extractSegment(execution: Execution, schema: DomainSchema, type: EntityType, segment: Segment): Promise<Observation[]> {
    if (segment.quality === 'blocked' || !segment.text.trim()) return [];
    const specHash = hash(stableStringify({ protocol: EXTRACTION_PROTOCOL, system: EVIDENCE_SYSTEM, entityType: type, schemaId: schema.id, parserVersion: segment.parserVersion, extractor: deps.extractor.name, reasoner: deps.reasoner.name }));
    const key = stableId('extraction', execution.project.id, segment.sourceVersionId, segment.id, specHash);
    const completeId = stableId('event', execution.project.id, 'extraction-complete', key);
    if (await repository.get('events', completeId)) {
      return (await repository.list('observations', { projectId: execution.project.id, where: { schemaId: schema.id, extractionSpecHash: specHash } })).filter(observation => observation.evidence.segmentId === segment.id);
    }
    const estimatedCost = Buffer.byteLength(segment.text + segment.context + stableStringify(type)) / 1_000_000 * 0.3;
    const directValues = extractStructuredRecord(type, segment);
    const extracted = directValues ? { values: directValues, truncated: false, model: 'deterministic-json-v1' } : await billable(execution, 'extract', Math.max(0.0001, estimatedCost), async () => {
      const result = await deps.extractor.extract({ entityType: type, segment, schemaId: schema.id, sourceVersionId: segment.sourceVersionId, referenceDate: clock.now().slice(0, 10) });
      return { data: { values: StructuredExtractionSchema.parse({ values: result.values }).values, truncated: z.boolean().parse(result.truncated), model: result.usage.model }, usage: result.usage };
    });
    let values = extracted.values;
    let structuredModel = deps.reasoner.name;
    const relevantFields = type.fields.filter(field => field.type === 'json' || field.type === 'reference');
    if (relevantFields.length && !directValues) {
      const structured = await reason(execution, 'resolver', TASKS.structured, {
        project: { id: execution.project.id, contract: execution.project.contract }, schema, entityType: type, segment, fields: relevantFields,
      }, StructuredExtractionSchema, 'Extract only the requested structured fields. Return exact evidence from segment.text. A non-existent value must be null. References must be explicit source identifiers, not guessed canonical IDs. Structured expressions must preserve alternatives, recommendations, conditions and exclusions.', model => { structuredModel = model; });
      for (const field of relevantFields) if (structured.values[field.id]) values[field.id] = structured.values[field.id]!;
    }
    const fallbackEvidence = segmentEvidence(segment);
    if (extracted.truncated) {
      await addFinding(execution, { kind: 'extraction', severity: 'critical', title: 'Extraction response was truncated', description: `The ${type.label} extraction for ${segment.heading || segment.id} was incomplete. No values from it were accepted.`, action: 'Reduce record size or field batch and re-extract this segment.', evidence: fallbackEvidence ? [fallbackEvidence] : [], entityId: null, field: null });
      return [];
    }
    const nonNull = Object.entries(values).filter(([, value]) => value.value !== null);
    if (!nonNull.length) { await recordExtractionComplete(execution, completeId, key, segment, schema, type, 0); return []; }
    const identity: Scope = {}, scope: Scope = { ...execution.project.contract.scope };
    const missing: string[] = [];
    for (const field of type.identityFields) {
      const value = values[field];
      const scalar = asScalar(value?.value);
      if (!value || !scalar || !evidenceFor(value, segment)) missing.push(field); else identity[field] = scalar;
    }
    for (const field of type.scopeFields) {
      const value = values[field];
      const scalar = asScalar(value?.value);
      if (value && scalar && evidenceFor(value, segment)) scope[field] = scalar;
      else if (!(field in scope)) missing.push(field);
    }
    if (missing.length) {
      await addFinding(execution, { kind: 'identity_scope', severity: 'critical', title: 'Record identity or applicability is incomplete', description: `Cannot safely attach ${type.label} values without supported ${[...new Set(missing)].join(', ')}.`, action: 'Repair record segmentation or supply an evidence-backed identity/scope mapping, then replay.', evidence: fallbackEvidence ? [fallbackEvidence] : [], entityId: null, field: null });
      await recordExtractionComplete(execution, completeId, key, segment, schema, type, 0);
      return [];
    }
    const id = entityId(execution.project.id, type.id, identity, scope);
    const labelField = ['name', 'title', 'label', ...type.identityFields].find(fieldId => {
      const candidate = values[fieldId];
      const supported = candidate ? evidenceFor(candidate, segment) : null;
      return candidate && typeof candidate.value === 'string' && supported && (supported.quote.includes(candidate.value) || supported.quote.includes(JSON.stringify(candidate.value)));
    });
    const labelValue = labelField ? values[labelField]?.value : Object.values(identity)[0];
    const entity: Entity = EntitySchema.parse({ id, projectId: execution.project.id, type: type.id, label: asScalar(labelValue) ?? type.label, identity, scope, createdAt: clock.now() });
    await fence(execution);
    if (!await repository.get('entities', id)) await repository.put('entities', entity, { insertOnly: true });
    const observations: Observation[] = [];
    for (const field of type.fields) {
      const extractedValue = values[field.id];
      if (!extractedValue || extractedValue.value === null) {
        if (field.required) await addFinding(execution, { kind: 'extraction', severity: 'warning', title: `Required field unresolved: ${field.label}`, description: 'The extractor returned no supported value. This does not establish that the source omits the information.', action: 'Inspect the full source and determine absence versus extraction failure.', evidence: fallbackEvidence ? [fallbackEvidence] : [], entityId: id, field: field.id });
        continue;
      }
      const evidence = evidenceFor(extractedValue, segment);
      const value = extractedValue.value;
      const supportedText = typeof value !== 'string' || field.type === 'date' || ((evidence?.quote.includes(value) ?? false) || (evidence?.quote.includes(JSON.stringify(value)) ?? false));
      if (!evidence || !validateFieldValue(field, value) || !supportedText || (typeof value === 'number' && !numberOccursInQuote(value, evidence.quote))) {
        await addFinding(execution, { kind: 'extraction', severity: 'critical', title: `Unsupported extracted value: ${field.label}`, description: 'The value failed type, enum or exact source-evidence validation. It has been withheld.', action: 'Inspect the source passage and repair extraction; do not approve unsupported data.', evidence: fallbackEvidence ? [fallbackEvidence] : [], entityId: id, field: field.id });
        continue;
      }
      const observation = ObservationSchema.parse({ id: stableId('observation', key, id, field.id, value, evidence), projectId: execution.project.id, entityId: id, entityType: type.id, field: field.id, value, scope, evidence, schemaId: schema.id, runId: execution.run.id, extractionSpecHash: specHash, model: directValues ? extracted.model : field.type === 'json' || field.type === 'reference' ? structuredModel : extracted.model, mode: 'explicit', confidence: extractedValue.confidence, status: 'supported', validFrom: null, validTo: null, observedAt: clock.now() });
      const prior = await repository.get('observations', observation.id);
      await fence(execution);
      if (!prior) { await repository.put('observations', observation, { insertOnly: true }); execution.run.stats.observations++; }
      observations.push(prior ?? observation);
    }
    await recordExtractionComplete(execution, completeId, key, segment, schema, type, observations.length);
    return observations;
  }
  async function recordExtractionComplete(execution: Execution, id: string, key: string, segment: Segment, schema: DomainSchema, type: EntityType, count: number): Promise<void> {
    await fence(execution);
    if (!await repository.get('events', id)) await repository.put('events', { id, projectId: execution.project.id, runId: execution.run.id, phase: 'extraction.completed', message: 'Record extraction completed', data: { key, sourceVersionId: segment.sourceVersionId, segmentId: segment.id, schemaId: schema.id, entityType: type.id, observations: count }, level: 'info', createdAt: clock.now() }, { insertOnly: true });
  }
  async function audit(execution: Execution, schema: DomainSchema, acquired: AcquiredSource, segments: Segment[], task: typeof TASKS.representation | typeof TASKS.extraction, observations: Observation[] = []): Promise<Finding[]> {
    if (!segments.length) return [];
    const input = {
      project: { id: execution.project.id, contract: execution.project.contract }, schema,
      sourceVersion: acquired.version, segments,
      ...(task === TASKS.extraction ? { observations } : {}),
    };
    const audited = await reason(execution, 'auditor', task, input, AuditResultSchema,
      task === TASKS.representation
        ? 'Read the source before any extraction output. Identify in-scope assertions or qualifications that the domain schema cannot faithfully express. Distinguish schema gaps, parsing faults, identity/scope ambiguity and source disagreements. Cite exact supplied source passages; do not invent source identifiers. Every finding must be actionable. Return an empty findings list if no supported finding exists.'
        : 'Compare full supplied source text, schema and extracted observations. Identify incorrect or unsupported values, omitted qualifications, missing representable assertions, identity/scope errors and genuine disagreements. A null extraction does not establish source absence. Cite exact passages. Return an empty findings list if no supported finding exists.');
    const findings: Finding[] = [];
    const segmentMap = new Map(segments.map(segment => [segment.id, segment]));
    for (const draft of audited.findings) {
      const valid = draft.evidence.every(evidence => { const segment = segmentMap.get(evidence.segmentId); return segment && evidence.sourceVersionId === acquired.version.id && validateEvidence(evidence, segment); });
      const entity = draft.entityId ? await repository.get('entities', draft.entityId) : null;
      if (!valid || (draft.entityId && entity?.projectId !== execution.project.id)) {
        const evidence = segments[0] ? segmentEvidence(segments[0]) : null;
        await addFinding(execution, { kind: 'extraction', severity: 'critical', title: 'Audit returned an ungrounded finding', description: 'An auditor supplied an invalid source span or an entity outside this project; the audit result is quarantined.', action: 'Inspect the auditor output and rerun with valid evidence before publishing affected records.', evidence: evidence ? [evidence] : [], entityId: null, field: null });
        continue;
      }
      findings.push(await addFinding(execution, draft));
    }
    await event(execution, task, task === TASKS.representation ? 'Representation audit completed independently' : 'Extraction audit completed', { sourceVersionId: acquired.version.id, segmentIds: segments.map(segment => segment.id), findings: findings.length });
    return findings;
  }
  async function interpret(execution: Execution, schema: DomainSchema, source: AcquiredSource, forceAudit = false): Promise<void> {
    const usable = source.segments.filter(segment => segment.quality !== 'blocked' && segment.text.trim());
    const auditKey = stableId('event', execution.project.id, 'audit-complete', AUDIT_PROTOCOL, EVIDENCE_SYSTEM, source.version.id, schema.id, deps.reasoner.name);
    const priorAudit = await repository.get('events', auditKey);
    const randomAudit = parseInt(hash(`${execution.run.id}:${source.version.id}`).slice(0, 6), 16) % 20 === 0;
    const shouldAudit = forceAudit || !priorAudit || randomAudit;
    for (const group of batches(usable)) {
      // The representation auditor deliberately runs without extraction output, before extraction.
      if (shouldAudit) await audit(execution, schema, source, group, TASKS.representation);
      const observations: Observation[] = [];
      for (const segment of group) {
        const structuredMatches = schema.entityTypes.filter(type => extractStructuredRecord(type, segment) !== null);
        if (structuredMatches.length > 1) {
          const evidence = segmentEvidence(segment);
          await addFinding(execution, { kind: 'identity_scope', severity: 'critical', title: 'Structured record matches multiple entity types', description: `The same source record matches ${structuredMatches.map(type => type.id).join(', ')}. No type was chosen.`, action: 'Add an unambiguous identity or explicit source-to-type discriminator before replay.', evidence: evidence ? [evidence] : [], entityId: null, field: null });
          continue;
        }
        for (const type of schema.entityTypes) observations.push(...await extractSegment(execution, schema, type, segment));
      }
      if (shouldAudit) await audit(execution, schema, source, group, TASKS.extraction, observations);
    }
    if (shouldAudit && usable.length && !priorAudit) {
      await fence(execution);
      await repository.put('events', { id: auditKey, projectId: execution.project.id, runId: execution.run.id, phase: 'audit.completed', message: 'Source representation and extraction audits completed', data: { sourceVersionId: source.version.id, schemaId: schema.id }, level: 'info', createdAt: clock.now() }, { insertOnly: true });
    }
    await event(execution, 'interpretation', 'Source interpretation completed', { sourceVersionId: source.version.id, schemaId: schema.id, segments: usable.length, audited: shouldAudit });
  }
  async function disagreements(execution: Execution, schema: DomainSchema): Promise<void> {
    const observations = await repository.list('observations', { projectId: execution.project.id, where: { schemaId: schema.id, status: 'supported' } });
    const sourceIds = new Set((await repository.list('sources', { projectId: execution.project.id })).map(source => source.latestVersionId).filter(id => id !== null));
    const groups = new Map<string, Observation[]>();
    for (const observation of observations) {
      if (!sourceIds.has(observation.evidence.sourceVersionId)) continue;
      const key = stableStringify([observation.entityId, observation.field, observation.scope]);
      const group = groups.get(key) ?? []; group.push(observation); groups.set(key, group);
    }
    for (const group of groups.values()) {
      const first = group[0];
      if (!first || new Set(group.map(observation => stableStringify(observation.value))).size < 2) continue;
      await addFinding(execution, { kind: 'disagreement', severity: 'warning', title: `Sources disagree on ${first.field}`, description: 'Sources make incompatible statements for the same entity, field and scope. Both observations are preserved; the published value will remain unresolved.', action: 'Inspect applicability and seek a stronger source or correction. Do not silently choose the latest statement.', evidence: group.map(observation => observation.evidence), entityId: first.entityId, field: first.field });
    }
  }
  async function propose(execution: Execution, schema: DomainSchema): Promise<void> {
    const gaps = (await repository.list('findings', { projectId: execution.project.id, where: { status: 'open', kind: 'schema_gap' } })).filter(finding => finding.evidence.length > 0);
    if (!gaps.length) return;
    const pending = await repository.list('proposals', { projectId: execution.project.id, where: { baseSchemaId: schema.id, status: 'pending' } });
    if (pending.length) return;
    const draft = await reason(execution, 'architect', TASKS.proposal, {
      project: { id: execution.project.id, contract: execution.project.contract }, schema, findings: gaps,
    }, SchemaDraftSchema, 'Propose the smallest domain-schema change that addresses the evidence-backed findings. Preserve existing meaning and field identities. Distinguish a new type from an enum value, alias or scoped relation. Do not fix extractor failures by inventing fields. Return the full candidate definition; the engine determines compatibility, metadata and replay.');
    const candidate = makeSchema(execution.project, SchemaDraftSchema.parse(draft), schema);
    const diff = diffSchemas(schema, candidate);
    if (!diff.changes.length) { await event(execution, 'proposal', 'Schema-gap review proposed no structural change', {}, 'warning'); return; }
    const id = stableId('proposal', schema.id, candidate.entityTypes, candidate.description);
    if (await repository.get('proposals', id)) return;
    const versions = await repository.list('sourceVersions', { projectId: execution.project.id });
    const proposal = ProposalSchema.parse({ id, projectId: execution.project.id, baseSchemaId: schema.id, candidate, findingIds: gaps.map(finding => finding.id), rationale: draft.rationale, breaking: diff.breaking, changes: diff.changes, affectedSourceVersionIds: versions.map(version => version.id), status: 'pending', decision: null, decidedAt: null, createdAt: clock.now() });
    await fence(execution);
    await repository.put('proposals', proposal, { insertOnly: true });
    await event(execution, 'proposal', 'Schema change awaiting operator review', { proposalId: id, breaking: diff.breaking, affectedSources: versions.length });
  }
  async function start(project: Project, kind: Run['kind'], job: Job | null): Promise<Execution> {
    const id = job ? stableId('run', job.id) : `run_${randomUUID()}`;
    const prior = await repository.get('runs', id);
    const run = prior ?? RunSchema.parse({ id, projectId: project.id, kind, status: 'running', phase: 'starting', startedAt: clock.now(), completedAt: null, stats: { queries: 0, sources: 0, observations: 0, findings: 0, estimatedCostUsd: 0 }, error: null });
    const execution: Execution = { project, run, job, sequence: 0, reservedCalls: 0, processed: new Set(), queries: new Set(), countedSources: new Set() };
    await fence(execution);
    if (prior?.status === 'completed') return execution;
    if (prior) {
      for (const record of await repository.list('events', { projectId: project.id, where: { runId: id } })) {
        if (record.phase === 'source.attempt' && typeof record.data.key === 'string') execution.countedSources.add(record.data.key);
        if (record.phase === 'discovery' && typeof record.data.query === 'string') execution.queries.add(record.data.query.trim().toLowerCase());
      }
    }
    run.status = 'running'; run.error = null; run.completedAt = null;
    await updateRun(execution);
    return execution;
  }
  async function runWork(projectId: string, kind: Exclude<Run['kind'], 'publish'>, options: CycleOptions = {}, job: Job | null = null): Promise<Run> {
    let project = await requireProject(projectId);
    if (project.status === 'paused') throw new WorkflowError('Project is paused');
    const execution = await start(project, kind, job);
    if (execution.run.status === 'completed') return execution.run;
    try {
      await fence(execution);
      project = await setProjectStatus(execution, 'exploring');
      execution.project = project;
      if (kind === 'replay' || kind === 'reparse' || options.sourceVersionIds) {
        if (!project.currentSchemaId) throw new WorkflowError(`Cannot ${kind === 'reparse' ? 'reparse' : 'replay'} without an approved current schema`);
        const schema = await repository.get('schemas', project.currentSchemaId);
        if (!schema) throw new WorkflowError('Current schema does not exist');
        const versions = await repository.list('sourceVersions', { projectId });
        const defaults = kind === 'reparse' ? (await repository.list('sources', { projectId })).flatMap(source => source.latestVersionId ? [source.latestVersionId] : []) : versions.map(version => version.id);
        const requested = new Set(options.sourceVersionIds ?? defaults);
        const selected = versions.filter(version => requested.has(version.id));
        if (selected.length !== requested.size) throw new WorkflowError(`${kind === 'reparse' ? 'Reparse' : 'Replay'} includes missing or foreign source versions`);
        for (const version of selected) {
          await countSource(execution, version.id);
          const source = await repository.get('sources', version.sourceId);
          if (!source) throw new WorkflowError('Source no longer exists');
          const acquired = kind === 'reparse' ? await reparseSource(execution, source, version) : { source, version, segments: await repository.list('segments', { projectId, where: { sourceVersionId: version.id } }), changed: false };
          await interpret(execution, schema, acquired, true);
        }
        await disagreements(execution, schema);
        await propose(execution, schema);
      } else {
        const sourceUrls = kind === 'ingest' ? options.sourceUrls ?? [] : options.sourceUrls ?? project.seedUrls;
        const explicitUrls = kind === 'ingest' ? new Set(sourceUrls.map(canonicalizeUrl)) : null;
        for (const url of sourceUrls) await sourceFor(execution, url);
        let schema: DomainSchema | null = project.currentSchemaId ? await repository.get('schemas', project.currentSchemaId) : null;
        const iterations = kind === 'cycle' ? project.budget.maxIterations : 1;
        for (let iteration = 0; iteration < iterations; iteration++) {
          if (kind === 'cycle' && !options.skipSearch) await discover(execution, iteration);
          const known = await repository.list('sources', { projectId });
          const pending = diverse(known.filter(source => (!explicitUrls || explicitUrls.has(source.url)) && !execution.processed.has(source.id) && source.status !== 'blocked' && (iteration === 0 || source.status === 'pending' || source.status === 'failed')));
          if (!pending.length) break;
          const remaining = project.budget.maxSources - execution.run.stats.sources + pending.filter(source => execution.countedSources.has(source.id)).length;
          if (remaining <= 0) throw new BudgetExceededError('Maximum source budget reached');
          const acquired: AcquiredSource[] = [];
          for (const source of pending.slice(0, remaining)) {
            const result = await acquire(execution, source);
            execution.processed.add(source.id);
            if (result) acquired.push(result);
          }
          if (!schema) schema = await bootstrap(execution, acquired);
          for (const source of acquired) await interpret(execution, schema, source);
          await disagreements(execution, schema);
          await propose(execution, schema);
          if (pending.length > remaining) throw new BudgetExceededError('Maximum source budget reached; additional frontier sources remain queued');
          if (kind !== 'cycle') break;
        }
        if (!schema) throw new WorkflowError('No schema was established; supply accessible sources or search results');
      }
      execution.run.status = 'completed'; execution.run.completedAt = clock.now(); execution.run.phase = 'completed';
      await updateRun(execution);
      const open = await repository.list('findings', { projectId, where: { status: 'open' } });
      await setProjectStatus(execution, open.length ? 'review' : 'ready');
      await event(execution, 'completed', 'Run completed; publication remains explicit', { observations: execution.run.stats.observations, findings: execution.run.stats.findings });
      return execution.run;
    } catch (error) {
      if (error instanceof LeaseLostError) { await recordCancellation(execution); throw error; }
      execution.run.status = error instanceof BudgetExceededError ? 'budget_exhausted' : 'failed';
      execution.run.phase = execution.run.status; execution.run.error = errorText(error); execution.run.completedAt = clock.now();
      await updateRun(execution);
      await event(execution, execution.run.status, errorText(error), {}, error instanceof BudgetExceededError ? 'warning' : 'error');
      await setProjectStatus(execution, 'review');
      return execution.run;
    }
  }
  async function transactionRetry<T>(operation: (tx: Repository) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await repository.transaction(operation); }
      catch (error) {
        const retryable = error !== null && typeof error === 'object' && 'code' in error && (error.code === '40001' || error.code === '40P01' || error.code === 'DEEPLAKE_SERIALIZATION_CONFLICT');
        if (!retryable || attempt >= 2) throw error;
      }
    }
  }
  async function approveProposal(proposalId: string, decision: string, allowBreaking = false): Promise<Proposal> {
    if (!decision.trim()) throw new WorkflowError('An approval rationale is required');
    const approved = await transactionRetry(async tx => {
      const proposal = await tx.get('proposals', proposalId);
      if (!proposal) throw new WorkflowError('Proposal does not exist');
      if (proposal.status === 'approved') return proposal;
      if (proposal.status !== 'pending') throw new WorkflowError(`Cannot approve a ${proposal.status} proposal`);
      const project = await requireProject(proposal.projectId, tx);
      if (project.currentSchemaId !== proposal.baseSchemaId) throw new WorkflowError('Proposal is stale: the current schema has changed');
      const base = await tx.get('schemas', proposal.baseSchemaId);
      if (!base) throw new WorkflowError('Proposal base schema is missing');
      const candidate = validateDomainSchema(proposal.candidate);
      if (candidate.projectId !== project.id || candidate.previousId !== base.id || candidate.version !== base.version + 1) throw new WorkflowError('Candidate schema metadata does not follow the current version');
      const difference = diffSchemas(base, candidate);
      if ((proposal.breaking || difference.breaking) && !allowBreaking) throw new WorkflowError('Breaking schema change requires explicit allowBreaking approval');
      for (const findingId of proposal.findingIds) {
        const finding = await tx.get('findings', findingId);
        if (!finding || finding.projectId !== project.id || !finding.evidence.length) throw new WorkflowError('Proposal is not grounded in this project’s evidence');
      }
      if (!proposal.findingIds.length) throw new WorkflowError('Schema proposal has no supporting findings');
      const versions = await tx.list('sourceVersions', { projectId: project.id });
      if (proposal.affectedSourceVersionIds.some(id => !versions.some(version => version.id === id))) throw new WorkflowError('Proposal references a source version outside this project');
      // Conservative historical replay: the previous schema may not have indexed the concept at all.
      const sourceVersionIds = versions.map(version => version.id);
      if (!await tx.get('schemas', candidate.id)) await tx.put('schemas', candidate, { insertOnly: true });
      const result: Proposal = { ...proposal, breaking: difference.breaking, status: 'approved', decision: decision.trim(), decidedAt: clock.now() };
      await tx.put('proposals', result);
      await tx.put('projects', { ...project, currentSchemaId: candidate.id, status: 'review', updatedAt: clock.now() });
      await tx.enqueue({ projectId: project.id, kind: 'replay', key: stableId('replay', proposal.id, candidate.id), payload: { sourceVersionIds }, maxAttempts: 3 });
      return result;
    });
    return approved;
  }
  async function rejectProposal(proposalId: string, decision: string): Promise<Proposal> {
    if (!decision.trim()) throw new WorkflowError('A rejection rationale is required');
    return transactionRetry(async tx => {
      const proposal = await tx.get('proposals', proposalId);
      if (!proposal) throw new WorkflowError('Proposal does not exist');
      if (proposal.status === 'rejected') return proposal;
      if (proposal.status !== 'pending') throw new WorkflowError(`Cannot reject a ${proposal.status} proposal`);
      const result: Proposal = { ...proposal, status: 'rejected', decision: decision.trim(), decidedAt: clock.now() };
      await tx.put('proposals', result);
      return result;
    });
  }
  async function publishWork(projectId: string, job: Job | null = null): Promise<Publication> {
    const project = await requireProject(projectId);
    const execution = await start(project, 'publish', job);
    try {
      await fence(execution);
      const publication = await transactionRetry(async tx => {
        await fence(execution, tx);
        const saved = await tx.get('events', stableId('event', execution.run.id, 'publication.saved'));
        if (saved && typeof saved.data.publicationId === 'string') { const existing = await tx.get('publications', saved.data.publicationId); if (existing) return existing; }
        const current = await requireProject(projectId, tx);
        if (!current.currentSchemaId) throw new WorkflowError('No approved schema is available for publication');
        const schema = await tx.get('schemas', current.currentSchemaId);
        if (!schema) throw new WorkflowError('Current schema is missing');
        const previous = current.publishedReleaseId ? await tx.get('publications', current.publishedReleaseId) : null;
        const [entities, observations, segments, sources, sourceVersions, findings, publications] = await Promise.all([
          tx.list('entities', { projectId }), tx.list('observations', { projectId }), tx.list('segments', { projectId }),
          tx.list('sources', { projectId }), tx.list('sourceVersions', { projectId }), tx.list('findings', { projectId }), tx.list('publications', { projectId }),
        ]);
        const projected = buildPublication({ project: current, schema, entities, observations, segments, sources, sourceVersions, findings, previous, now: clock.now() });
        if (!projected.records.length) throw new WorkflowError('No supported records are eligible for publication');
        const version = Math.max(0, ...publications.map(item => item.version)) + 1;
        const published: Publication = { ...projected, version, id: stableId('publication', projectId, schema.id, version, projected.records, projected.sourceVersionIds) };
        await fence(execution, tx);
        await tx.put('publications', published, { insertOnly: true });
        await tx.put('events', { id: stableId('event', execution.run.id, 'publication.saved'), projectId, runId: execution.run.id, phase: 'publication.saved', message: 'Publication persisted atomically', data: { publicationId: published.id }, level: 'info', createdAt: clock.now() }, { insertOnly: true });
        await tx.put('projects', { ...current, publishedReleaseId: published.id, status: findings.some(finding => finding.status === 'open') ? 'review' : 'ready', updatedAt: clock.now() });
        return published;
      });
      execution.run.status = 'completed'; execution.run.completedAt = clock.now();
      await event(execution, 'published', 'Published a stable evidence-backed release', { publicationId: publication.id, version: publication.version, records: publication.records.length });
      return publication;
    } catch (error) {
      if (error instanceof LeaseLostError) { await recordCancellation(execution); throw error; }
      execution.run.status = 'failed'; execution.run.completedAt = clock.now(); execution.run.error = errorText(error);
      await updateRun(execution);
      throw error;
    }
  }
  async function rollback(projectId: string, publicationId: string): Promise<Project> {
    return transactionRetry(async tx => {
      const project = await requireProject(projectId, tx);
      const publication = await tx.get('publications', publicationId);
      if (!publication || publication.projectId !== project.id) throw new WorkflowError('Release does not belong to this project');
      const updated = { ...project, publishedReleaseId: publication.id, updatedAt: clock.now() };
      await tx.put('projects', updated);
      return updated;
    });
  }
  async function executeJob(job: Job): Promise<void> {
    if (job.status !== 'running' || !job.leaseToken) throw new LeaseLostError('Job must be claimed before execution');
    const urls = job.payload.sourceUrls === undefined ? undefined : JsonStringArray.parse(job.payload.sourceUrls);
    const versions = job.payload.sourceVersionIds === undefined ? undefined : JsonStringArray.parse(job.payload.sourceVersionIds);
    if (job.kind === 'publish') { await publishWork(job.projectId, job); return; }
    const result = await runWork(job.projectId, job.kind, { ...(urls ? { sourceUrls: urls } : {}), ...(versions ? { sourceVersionIds: versions } : {}), skipSearch: job.kind !== 'cycle' }, job);
    if (result.status === 'failed') throw new WorkflowError(result.error ?? 'Engine run failed');
  }
  return {
    runCycle: (projectId, options) => runWork(projectId, 'cycle', options),
    ingest: (projectId, urls) => runWork(projectId, 'ingest', { sourceUrls: urls, skipSearch: true }),
    maintain: projectId => runWork(projectId, 'maintenance', { skipSearch: true }),
    replay: (projectId, sourceVersionIds) => runWork(projectId, 'replay', { ...(sourceVersionIds ? { sourceVersionIds } : {}), skipSearch: true }),
    reparse: (projectId, sourceVersionIds) => runWork(projectId, 'reparse', { ...(sourceVersionIds ? { sourceVersionIds } : {}), skipSearch: true }),
    approveProposal, rejectProposal, publish: projectId => publishWork(projectId), rollback, executeJob,
  };
}
