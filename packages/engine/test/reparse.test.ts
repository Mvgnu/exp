import { afterEach, describe, expect, it } from 'vitest';
import { hash, stableId } from '@deeplake/core';
import type { Parser } from '@deeplake/core';
import { createParser } from '@deeplake/ingest';
import { createEngine } from '../src/index.js';
import { fixture, initialDocument } from './fixture.js';

const opened: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const setup of opened.splice(0)) await setup.close(); });
async function open() { const setup = await fixture(); opened.push(setup); return setup; }

describe('explicit preserved-source reparsing', () => {
  it('runs a leased reparse from original bytes, preserves old releases and never reacquires the source', async () => {
    const s = await open();
    expect((await s.engine.runCycle(s.project.id)).status).toBe('completed');
    const before = await s.engine.publish(s.project.id);
    const original = (await s.repository.list('sourceVersions'))[0]!;
    const oldSegments = await s.repository.list('segments');
    const networkCalls = s.fetchCalls.length;
    s.documents.set(s.url, 'This live response must never be consulted by reparse.');
    const engine = createEngine({ ...s.dependencies, parser: createParser(), acquirer: { async fetch() { throw new Error('Reparse performed forbidden network acquisition'); } } });
    await s.repository.enqueue({ projectId: s.project.id, kind: 'reparse', key: 'parser-upgrade' });
    const job = await s.repository.claim('parser-worker', 120_000);
    expect(job?.kind).toBe('reparse');
    await engine.executeJob(job!);
    expect((await s.repository.list('runs')).find(run => run.kind === 'reparse')?.status).toBe('completed');
    const sources = await s.repository.list('sources');
    const next = await s.repository.get('sourceVersions', sources[0]!.latestVersionId!);
    expect(next?.id).not.toBe(original.id);
    expect(next?.parserVersion).toMatch(/^deeplake-parser\//);
    expect(next?.contentHash).toBe(original.contentHash);
    expect(next?.blobKey).toBe(original.blobKey);
    expect(next?.fetchedAt).toBe(original.fetchedAt);
    expect(await s.repository.get('sourceVersions', original.id)).toEqual(original);
    expect(await s.repository.list('segments', { where: { sourceVersionId: original.id } })).toEqual(oldSegments);
    expect(new TextDecoder().decode(await s.dependencies.blobs.get(original.blobKey))).toBe(initialDocument);
    expect(s.fetchCalls.length).toBe(networkCalls);
    expect((await s.repository.get('projects', s.project.id))?.publishedReleaseId).toBe(before.id);
    expect(await s.repository.get('publications', before.id)).toEqual(before);
    const versions = (await s.repository.list('sourceVersions')).length;
    const observations = (await s.repository.list('observations')).length;
    expect((await engine.reparse(s.project.id)).status).toBe('completed');
    expect(await s.repository.list('sourceVersions')).toHaveLength(versions);
    expect(await s.repository.list('observations')).toHaveLength(observations);
    const after = await engine.publish(s.project.id);
    expect(after.records[0]?.fields.score?.value).toBe(4);
    expect(after.sourceVersionIds).toContain(next!.id);
    expect(after.sourceVersionIds).not.toContain(original.id);
    await s.repository.enqueue({ projectId: s.project.id, kind: 'reparse', key: 'cancel-during-parse' });
    const cancelled = await s.repository.claim('cancelled-parser-worker', 120_000);
    const cancellingParser: Parser = { async parse(document) {
      const parsed = await createParser().parse(document);
      await s.repository.cancel(cancelled!.id);
      return { ...parsed, parserVersion: 'cancelled-parser-v2', segments: parsed.segments.map(segment => ({ ...segment, parserVersion: 'cancelled-parser-v2' })) };
    } };
    await expect(createEngine({ ...s.dependencies, parser: cancellingParser }).executeJob(cancelled!)).rejects.toThrow(/cancelled|lease/);
    expect(await s.repository.list('sourceVersions')).toHaveLength(versions);
    expect((await s.repository.list('sources'))[0]?.latestVersionId).toBe(next!.id);
    expect((await s.repository.get('runs', stableId('run', cancelled!.id)))?.status).toBe('cancelled');
    expect((await s.repository.list('events')).some(event => event.phase === 'cancelled' && event.data.jobId === cancelled!.id)).toBe(true);
  });

  it('keeps historical reparses out of the current view and defaults to current versions only', async () => {
    const s = await open();
    await s.engine.runCycle(s.project.id);
    const original = (await s.repository.list('sourceVersions'))[0]!;
    s.documents.set(s.url, initialDocument.replace('"score": 4', '"score": 7'));
    expect((await s.engine.maintain(s.project.id)).status).toBe('completed');
    const current = (await s.repository.list('sources'))[0]!.latestVersionId!;
    const engine = createEngine({ ...s.dependencies, parser: createParser() });
    const historical = await engine.reparse(s.project.id, [original.id]);
    expect(historical.status, historical.error ?? '').toBe('completed');
    expect((await s.repository.list('sources'))[0]?.latestVersionId).toBe(current);
    expect(await s.repository.list('sourceVersions')).toHaveLength(3);
    expect((await engine.publish(s.project.id)).records[0]?.fields.score?.value).toBe(7);
    const defaults = await engine.reparse(s.project.id);
    expect(defaults.status, defaults.error ?? '').toBe('completed');
    expect(defaults.stats.sources).toBe(1);
    const latest = (await s.repository.list('sources'))[0]!.latestVersionId!;
    expect(latest).not.toBe(current);
    expect((await s.repository.get('sourceVersions', latest))?.contentHash).toBe(hash(initialDocument.replace('"score": 4', '"score": 7')));
    expect(await s.repository.list('sourceVersions')).toHaveLength(4);
    expect((await engine.publish(s.project.id)).records[0]?.fields.score?.value).toBe(7);
    const missing = await engine.reparse(s.project.id, ['missing-or-foreign']);
    expect(missing.status).toBe('failed');
    expect(missing.error).toContain('missing or foreign');
    expect((await s.repository.list('sources'))[0]?.latestVersionId).toBe(latest);
  });

  it('records failed and unusable parser attempts without moving the latest pointer', async () => {
    const s = await open();
    await s.engine.runCycle(s.project.id);
    const original = (await s.repository.list('sourceVersions'))[0]!;
    const failed = createEngine({ ...s.dependencies, parser: { async parse() { throw new Error('Unsupported source encoding'); } } });
    const failedRun = await failed.reparse(s.project.id);
    expect(failedRun.status).toBe('failed');
    expect(failedRun.error).toContain('Unsupported source encoding');
    const unusable: Parser = { async parse() { return { parserVersion: 'broken-parser-v2', title: 'Unusable result', text: '', segments: [], links: [], warnings: ['No readable text found'] }; } };
    const unusableRun = await createEngine({ ...s.dependencies, parser: unusable }).reparse(s.project.id);
    expect(unusableRun.status).toBe('failed');
    expect(unusableRun.error).toContain('no usable source segments');
    expect((await s.repository.list('sources'))[0]?.latestVersionId).toBe(original.id);
    expect((await s.repository.list('sourceVersions')).some(version => version.parserVersion === 'broken-parser-v2')).toBe(true);
    expect((await s.repository.list('findings')).some(finding => finding.title === 'Source could not be reparsed' && finding.action.includes('retry explicit reparse'))).toBe(true);
    expect(await s.repository.get('sourceVersions', original.id)).toEqual(original);
  });

  it('rejects changed parser behavior under the same version instead of mutating immutable segments', async () => {
    const s = await open();
    await s.engine.runCycle(s.project.id);
    const original = (await s.repository.list('sourceVersions'))[0]!;
    const oldSegments = await s.repository.list('segments');
    const parser: Parser = { async parse(document) {
      const before = await s.dependencies.parser.parse(document);
      const text = before.text.replace('"score": 4', '"score": 8');
      return { ...before, text, segments: before.segments.map(segment => ({ ...segment, text, start: 0, end: text.length })) };
    } };
    const run = await createEngine({ ...s.dependencies, parser }).reparse(s.project.id);
    expect(run.status).toBe('failed');
    expect(run.error).toContain('without a parser version change');
    expect(await s.repository.list('sourceVersions')).toHaveLength(1);
    expect(await s.repository.list('segments')).toEqual(oldSegments);
    expect((await s.repository.list('sources'))[0]?.latestVersionId).toBe(original.id);
  });

  it('never writes cancellation state over a replacement worker after lease loss', async () => {
    const s = await open();
    await s.engine.runCycle(s.project.id);
    await s.repository.enqueue({ projectId: s.project.id, kind: 'reparse', key: 'lease-replacement' });
    const job = await s.repository.claim('old-worker', 60_000);
    const parser: Parser = { async parse(document) {
      const result = await createParser().parse(document);
      const replacement = await s.repository.claim('new-worker', 60_000, new Date(Date.now() + 120_000).toISOString());
      expect(replacement?.id).toBe(job!.id);
      expect(replacement?.leaseToken).not.toBe(job!.leaseToken);
      const run = await s.repository.get('runs', stableId('run', job!.id));
      await s.repository.put('runs', { ...run!, phase: 'replacement-worker-owns-this-run' });
      return result;
    } };
    await expect(createEngine({ ...s.dependencies, parser }).executeJob(job!)).rejects.toThrow(/cancelled|lease/);
    const run = await s.repository.get('runs', stableId('run', job!.id));
    expect(run?.status).toBe('running');
    expect(run?.phase).toBe('replacement-worker-owns-this-run');
    expect(await s.repository.list('sourceVersions')).toHaveLength(1);
    expect((await s.repository.list('events')).some(event => event.phase === 'cancelled')).toBe(false);
  });
});
