import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createStore } from '@deeplake/store';
import { JsonValueSchema, hash } from '@deeplake/core';
import type { ExtractedValue, Segment } from '@deeplake/core';
import { createEngine, createProject, extractStructuredRecord } from '../src/index.js';
import { evidence, fixture, initialDocument, record, segmentsOf, testType } from './fixture.js';

type Harness = Awaited<ReturnType<typeof fixture>>;
const opened: Harness[] = [];
afterEach(async () => { for (const setup of opened.splice(0)) await setup.close(); });
async function open(options?: Parameters<typeof fixture>[0]) { const setup = await fixture(options); opened.push(setup); return setup; }

describe('durable discovery and schema evolution', () => {
  it('completes schema gap → proposal → approved replay → publication while retaining original evidence', async () => {
    const s = await open();
    const run = await s.engine.runCycle(s.project.id);
    expect(run.status, run.error ?? '').toBe('completed');
    expect(s.calls.find(call => call.task === 'audit-representation')?.input).not.toHaveProperty('observations');
    expect(s.calls.find(call => call.task === 'audit-extraction')?.input).toHaveProperty('observations');
    expect(s.extractionCalls).toHaveLength(0); // Structured source mappings do not need inference.
    const proposals = await s.repository.list('proposals', { projectId: s.project.id });
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0]!;
    const first = await s.engine.publish(s.project.id);
    expect(first.records[0]?.fields.condition).toBeUndefined();
    const version = (await s.repository.list('sourceVersions'))[0]!;
    expect(version.contentHash).toBe(hash(initialDocument));
    const approved = await s.engine.approveProposal(proposal.id, 'Represent the explicitly stated alternatives');
    expect(approved.status).toBe('approved');
    expect((await s.repository.listJobs())[0]?.kind).toBe('replay');
    const replay = await s.engine.replay(s.project.id, proposal.affectedSourceVersionIds);
    expect(replay.status, replay.error ?? '').toBe('completed');
    const second = await s.engine.publish(s.project.id);
    expect(second.records[0]?.fields.condition?.value).toEqual({ anyOf: ['X', 'Y'] });
    expect(second.version).toBe(2);
    expect(await s.repository.get('publications', first.id)).toEqual(first);
    expect(await s.repository.get('sourceVersions', version.id)).toEqual(version);
    expect((await s.repository.list('schemas')).length).toBe(2);
    expect((await s.repository.list('observations')).some(observation => observation.schemaId === first.schemaId)).toBe(true);
  });

  it('deduplicates unchanged source retries and includes source change history', async () => {
    const s = await open();
    expect((await s.engine.runCycle(s.project.id)).status).toBe('completed');
    const observationCount = (await s.repository.list('observations')).length;
    const retry = await s.engine.ingest(s.project.id, [s.url]);
    expect(retry.status, retry.error ?? '').toBe('completed');
    expect((await s.repository.list('sourceVersions')).length).toBe(1);
    expect((await s.repository.list('observations')).length).toBe(observationCount);
    const old = await s.engine.publish(s.project.id);
    s.documents.set(s.url, initialDocument.replace('"score": 4', '"score": 7'));
    const maintenance = await s.engine.maintain(s.project.id);
    expect(maintenance.status, maintenance.error ?? '').toBe('completed');
    expect((await s.repository.list('sourceVersions')).length).toBe(2);
    const release = await s.engine.publish(s.project.id);
    expect(release.records[0]?.fields.score?.value).toBe(7);
    expect(old.records[0]?.fields.score?.value).toBe(4);
  });

  it('does not merge different applicability scopes and preserves same-scope source disagreement', async () => {
    const s = await open();
    s.documents.set('https://sources.example.org/asset-b.json', initialDocument.replace('"score": 4', '"score": 9'));
    s.documents.set('https://sources.example.org/asset-c.json', initialDocument.replace('"edition": "2025"', '"edition": "2026"'));
    const run = await s.engine.runCycle(s.project.id);
    expect(run.status, run.error ?? '').toBe('completed');
    const release = await s.engine.publish(s.project.id);
    expect(release.records).toHaveLength(2);
    const first = release.records.find(item => item.scope.edition === '2025');
    expect(first?.fields.score?.value).toBeNull();
    expect(first?.fields.score?.alternatives).toEqual([4, 9]);
    expect(release.records.find(item => item.scope.edition === '2026')?.fields.score?.value).toBe(4);
    expect((await s.repository.list('findings')).some(finding => finding.kind === 'disagreement')).toBe(true);
  });

  it('rejects stale schema approvals and keeps replay enqueue idempotent', async () => {
    const s = await open();
    await s.engine.runCycle(s.project.id);
    const proposal = (await s.repository.list('proposals'))[0]!;
    await s.repository.put('proposals', { ...proposal, id: 'stale-copy' });
    await s.engine.approveProposal(proposal.id, 'Review accepted');
    await s.engine.approveProposal(proposal.id, 'Review accepted twice');
    expect(await s.repository.listJobs()).toHaveLength(1);
    await expect(s.engine.approveProposal('stale-copy', 'Second review')).rejects.toThrow('stale');
  });

  it('requires explicit approval for breaking changes', async () => {
    const s = await open();
    await s.engine.runCycle(s.project.id);
    const proposal = (await s.repository.list('proposals'))[0]!;
    const candidate = { ...proposal.candidate, entityTypes: proposal.candidate.entityTypes.map(type => ({ ...type, fields: type.fields.filter(field => field.id !== 'score') })) };
    await s.repository.put('proposals', { ...proposal, candidate });
    await expect(s.engine.approveProposal(proposal.id, 'Remove score')).rejects.toThrow('Breaking');
    await s.engine.approveProposal(proposal.id, 'Explicitly accept the removal', true);
    expect((await s.repository.get('projects', s.project.id))?.currentSchemaId).toBe(candidate.id);
  });

  it('rolls back a public pointer without changing research state or reusing release versions', async () => {
    const s = await open();
    await s.engine.runCycle(s.project.id);
    const one = await s.engine.publish(s.project.id);
    const two = await s.engine.publish(s.project.id);
    const research = (await s.repository.get('projects', s.project.id))?.currentSchemaId;
    await s.engine.rollback(s.project.id, one.id);
    expect((await s.repository.get('projects', s.project.id))?.currentSchemaId).toBe(research);
    const three = await s.engine.publish(s.project.id);
    expect(three.version).toBe(3);
    expect(three.id).not.toBe(two.id);
    expect(await s.repository.list('publications')).toHaveLength(3);
  });
});

describe('bounded and fail-closed execution', () => {
  it('makes no provider call when a live project cannot reserve the next call', async () => {
    const s = await open({ mode: 'live', maxUsd: 0 });
    const run = await s.engine.runCycle(s.project.id);
    expect(run.status).toBe('budget_exhausted');
    expect(s.calls).toHaveLength(0);
    expect(s.fetchCalls).toHaveLength(0);
    expect(await s.repository.list('publications')).toHaveLength(0);
  });

  it('limits source fanout and leaves the remaining frontier visible', async () => {
    const s = await open({ maxSources: 1 });
    s.documents.set('https://sources.example.org/extra.json', initialDocument);
    const run = await s.engine.runCycle(s.project.id);
    expect(run.status).toBe('budget_exhausted');
    expect(s.fetchCalls).toHaveLength(1);
    expect(await s.repository.list('sources')).toHaveLength(2);
    expect(await s.repository.list('observations')).not.toHaveLength(0);
  });

  it('quarantines audit-invalid claims instead of accepting invented source spans', async () => {
    const s = await open();
    s.setAudit(request => {
      const segment = segmentsOf(request.input)[0]!;
      return { findings: [{ kind: 'extraction', severity: 'critical', title: 'Bogus audit claim', description: 'Test unsupported evidence', action: 'Do not trust this result', evidence: [{ ...evidence(segment, '"score"'), quote: 'not in the document' }], entityId: null, field: 'score' }] };
    });
    const run = await s.engine.runCycle(s.project.id);
    expect(run.status, run.error ?? '').toBe('completed');
    expect((await s.repository.list('findings')).some(finding => finding.title === 'Audit returned an ungrounded finding')).toBe(true);
    await expect(s.engine.publish(s.project.id)).rejects.toThrow('No supported records');
  });

  it('does not treat numeric truthiness or missing required identity as a record', async () => {
    const s = await open();
    s.documents.set(s.url, 'Name: Bad record\nScore: 0');
    s.setExtract((segment, type) => Object.fromEntries(type.fields.map(field => {
      const value = field.id === 'score' ? 0 : null;
      const start = segment.text.indexOf('0');
      return [field.id, { value, confidence: 1, quote: '0', start, end: start + 1, warnings: [] } satisfies ExtractedValue];
    })));
    const run = await s.engine.runCycle(s.project.id);
    expect(run.status, run.error ?? '').toBe('completed');
    expect(await s.repository.list('entities')).toHaveLength(0);
    expect((await s.repository.list('findings')).some(finding => finding.kind === 'identity_scope')).toBe(true);
  });

  it('runs leased work once and rejects a cancelled or stolen lease before effects', async () => {
    const s = await open();
    const queued = await s.repository.enqueue({ projectId: s.project.id, kind: 'cycle', key: 'cycle-1' });
    const job = await s.repository.claim('worker-a', 120000);
    expect(job?.id).toBe(queued.id);
    await s.engine.executeJob(job!);
    const before = (await s.repository.list('observations')).length;
    await s.engine.executeJob(job!);
    expect((await s.repository.list('observations')).length).toBe(before);
    await s.repository.cancel(job!.id);
    await expect(s.engine.executeJob(job!)).rejects.toThrow(/cancelled|lease/);
  });

  it('survives a database close/reopen with evidence, schema and release intact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deeplake-engine-restart-'));
    const s = await fixture({ dataDir: join(dir, 'database') });
    try {
      const run = await s.engine.runCycle(s.project.id);
      expect(run.status, run.error ?? '').toBe('completed');
      const release = await s.engine.publish(s.project.id);
      await s.close();
      const reopened = await createStore({ dataDir: join(dir, 'database') });
      try {
        expect((await reopened.get('projects', s.project.id))?.publishedReleaseId).toBe(release.id);
        expect(await reopened.get('publications', release.id)).toEqual(release);
        expect(await reopened.list('sourceVersions')).toHaveLength(1);
        expect(await reopened.list('segments')).toHaveLength(1);
      } finally { await reopened.close(); }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

it('maps exact structured values with escape-aware JSON offsets and does not join nested lookalikes', () => {
  const text = JSON.stringify({ nested: { code: 'wrong' }, code: 'A-01', name: 'Beacon\n"Quoted"', edition: '2025', score: 0 }, null, 2);
  const segment: Segment = { id: 'segment', projectId: 'project', sourceVersionId: 'version', index: 0, text, heading: '', context: '', start: 0, end: text.length, parserVersion: 'test', quality: 'ok', warnings: [] };
  const values = extractStructuredRecord(testType(), segment)!;
  expect(values.code?.value).toBe('A-01');
  expect(values.score?.value).toBe(0);
  for (const value of Object.values(values)) if (value.quote !== null) expect(text.slice(value.start!, value.end!)).toBe(value.quote);
  expect(values.name?.quote).toBe(JSON.stringify('Beacon\n"Quoted"'));
});
