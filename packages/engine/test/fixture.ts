import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { EntityTypeSchema, JsonValueSchema, SegmentSchema } from '@deeplake/core';
import type { Acquirer, Clock, EntityType, Evidence, ExtractedValue, Extractor, JsonValue, ModelResult, ModelUsage, Parser, Reasoner, ReasoningRequest, SearchProvider, Segment } from '@deeplake/core';
import { createStore, FileBlobStore } from '@deeplake/store';
import { createEngine, createProject } from '../src/index.js';

export const initialDocument = JSON.stringify({ code: 'A-01', name: 'Beacon', edition: '2025', score: 4, condition: { anyOf: ['X', 'Y'] } }, null, 2);
export const zero = (model = 'test'): ModelUsage => ({ provider: 'test', model, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, reportedCostUsd: 0 });
export function testType(expanded = false): EntityType {
  return EntityTypeSchema.parse({ id: 'asset', label: 'Asset', description: 'A labelled test asset under an edition.', identityFields: ['code'], scopeFields: ['edition'], fields: [
    { id: 'code', label: 'Code', type: 'text', description: 'Explicit source code.', required: true },
    { id: 'name', label: 'Name', type: 'text', description: 'Explicit source name.', required: true },
    { id: 'edition', label: 'Edition', type: 'text', description: 'Applicability edition.', required: true },
    { id: 'score', label: 'Score', type: 'number', description: 'Score stated by the source.', required: false },
    ...(expanded ? [{ id: 'condition', label: 'Condition', type: 'json', description: 'Alternative eligibility conditions.', required: false, jsonSchema: { type: 'object', properties: { anyOf: { type: 'array', items: { type: 'string' } } }, required: ['anyOf'], additionalProperties: false } }] : []),
  ] });
}
export function record(input: JsonValue | undefined): Record<string, JsonValue> { return input && typeof input === 'object' && !Array.isArray(input) ? input : {}; }
export function segmentsOf(input: JsonValue): Segment[] {
  const parsed = z.array(SegmentSchema).safeParse(record(input).segments);
  return parsed.success ? parsed.data : [];
}
export function evidence(segment: Segment, quote: string): Evidence {
  const start = segment.text.indexOf(quote);
  return { sourceVersionId: segment.sourceVersionId, segmentId: segment.id, quote, start, end: start + quote.length };
}
export async function fixture(options: { mode?: 'demo'|'live'; maxUsd?: number; dataDir?: string; maxSources?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'deeplake-engine-'));
  const repository = await createStore(options.dataDir ? { dataDir: options.dataDir } : { memory: true });
  let tick = 0;
  const clock: Clock = { now: () => new Date(Date.now() + tick++).toISOString() };
  const url = 'https://sources.example.org/asset-a.json';
  const documents = new Map([[url, initialDocument]]);
  const calls: ReasoningRequest[] = [];
  const fetchCalls: string[] = [];
  const extractionCalls: string[] = [];
  let overrideAudit: ((request: ReasoningRequest) => unknown) | null = null;
  let overrideExtract: ((segment: Segment, type: EntityType) => Record<string, ExtractedValue>) | null = null;
  const parser: Parser = { async parse(document) {
    const text = new TextDecoder().decode(document.bytes);
    return { text, title: 'Test source', parserVersion: 'test-parser-v1', links: [], warnings: [], segments: [{ index: 0, text, heading: 'Record', start: 0, end: text.length, context: '', parserVersion: 'test-parser-v1', quality: 'ok', warnings: [] }] };
  } };
  const acquirer: Acquirer = { async fetch(target, options) {
    fetchCalls.push(target);
    const text = documents.get(target);
    if (text === undefined) throw new Error('Missing test document');
    const etag = `"${text.length}-${text}"`;
    const notModified = options?.etag === etag;
    return { url: target, status: notModified ? 304 : 200, bytes: new TextEncoder().encode(notModified ? '' : text), mediaType: text.trim().startsWith('{') ? 'application/json' : 'text/plain', headers: { etag }, acquiredAt: clock.now(), acquisition: 'fixture', notModified };
  } };
  const search: SearchProvider = { name: 'test-search-v1', async search() { return { data: [...documents.keys()].map(url => ({ url, title: 'Test source', family: 'primary' })), usage: zero() }; } };
  const extractor: Extractor = { name: 'test-extractor-v1', async extract(request) {
    extractionCalls.push(request.segment.id);
    const values: Record<string, ExtractedValue> = overrideExtract ? overrideExtract(request.segment, request.entityType) : {};
    return { values, truncated: false, usage: zero() };
  } };
  const reasoner: Reasoner = { name: 'test-reasoner-v1', async complete<T>(request: ReasoningRequest, schema: z.ZodType<T>): Promise<ModelResult<T>> {
    calls.push(request);
    const input = record(request.input);
    const currentSchema = record(input.schema);
    const types = z.array(EntityTypeSchema).safeParse(currentSchema.entityTypes);
    const expanded = types.success && types.data.some(type => type.fields.some(field => field.id === 'condition'));
    const draft = (expanded: boolean) => ({ name: 'Assets', description: 'Test domain schema', entityTypes: [testType(expanded)], rationale: expanded ? 'Preserve alternatives present in source evidence' : 'Represent bounded source facts' });
    let value: unknown;
    if (request.task === 'plan-queries') value = { queries: [{ query: 'primary test asset records', objective: 'Discover primary records', family: 'primary', exploratory: true }] };
    else if (request.task === 'bootstrap-schema') value = draft(false);
    else if (request.task === 'propose-schema') value = draft(true);
    else if (request.task === 'audit-representation') {
      value = { findings: expanded ? [] : segmentsOf(request.input).filter(segment => segment.text.includes('condition')).map(segment => ({ kind: 'schema_gap', severity: 'warning', title: 'Conditions are unrepresented', description: 'The source states alternative eligibility conditions.', action: 'Add a structured condition field and replay source evidence.', evidence: [evidence(segment, '"condition"')], entityId: null, field: 'condition' })) };
    } else if (request.task === 'audit-extraction') value = overrideAudit ? overrideAudit(request) : { findings: [] };
    else if (request.task === 'extract-structured') value = { values: {} };
    else throw new Error(`Unknown test reasoning task: ${request.task}`);
    return { data: schema.parse(value), usage: zero(request.task) };
  } };
  const project = createProject({ name: 'Assets', topic: 'Evidence-backed test asset facts', questions: ['Which assets have which scores and conditions?'], mode: options.mode ?? 'demo', seedUrls: [url], budget: { maxUsd: options.maxUsd ?? 5, maxIterations: 1, maxSources: options.maxSources ?? 20 } }, clock);
  await repository.put('projects', project);
  const dependencies = { repository, blobs: new FileBlobStore(join(dir, 'blobs')), search, reasoner, extractor, acquirer, parser, clock };
  const engine = createEngine(dependencies);
  return { repository, project, engine, dependencies, url, documents, calls, fetchCalls, extractionCalls, clock, setAudit(fn: typeof overrideAudit) { overrideAudit = fn; }, setExtract(fn: typeof overrideExtract) { overrideExtract = fn; }, async close() { await repository.close(); await rm(dir, { recursive: true, force: true }); } };
}
