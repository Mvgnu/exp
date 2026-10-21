import { expect, it } from 'vitest';
import { stableId } from '@deeplake/core';
import { fixture, initialDocument } from './fixture.js';

it('ingests only requested canonical URLs while maintenance still processes the full known registry', async () => {
  const s = await fixture();
  try {
    expect((await s.engine.ingest(s.project.id, [s.url])).status).toBe('completed');
    const selected = (await s.repository.list('sources'))[0]!;
    const unrelatedUrl = 'https://sources.example.org/unrelated.json';
    const unrelatedId = stableId('source', s.project.id, unrelatedUrl);
    s.documents.set(unrelatedUrl, initialDocument.replace('A-01', 'B-02').replace('Beacon', 'Aurora'));
    await s.repository.put('sources', { ...selected, id: unrelatedId, url: unrelatedUrl, title: 'Previously discovered unrelated source', status: 'pending', latestVersionId: null, etag: null, lastModified: null, lastCheckedAt: null, discoveredBy: 'previous discovery', createdAt: s.clock.now() });
    const before = s.fetchCalls.length;
    const run = await s.engine.ingest(s.project.id, ['https://SOURCES.example.org/asset-a.json#record', s.url]);
    expect(run.status, run.error ?? '').toBe('completed');
    // Observe the actual injected acquisition boundary, not a copy of the URL filter.
    expect(s.fetchCalls.slice(before)).toEqual([s.url]);
    expect(run.stats.sources).toBe(1);
    expect((await s.repository.get('sources', unrelatedId))?.latestVersionId).toBeNull();
    expect(await s.repository.list('sourceVersions')).toHaveLength(1);
    const beforeMaintenance = s.fetchCalls.length;
    const maintenance = await s.engine.maintain(s.project.id);
    expect(maintenance.status, maintenance.error ?? '').toBe('completed');
    expect(s.fetchCalls.slice(beforeMaintenance).sort()).toEqual([s.url, unrelatedUrl].sort());
    expect((await s.repository.get('sources', unrelatedId))?.latestVersionId).not.toBeNull();
    expect(s.calls.some(call => call.task === 'plan-queries')).toBe(false);
  } finally { await s.close(); }
});
