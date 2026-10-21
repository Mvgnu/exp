import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, FileBlobStore } from '@deeplake/store';
import { seedDemo } from '../src/demo.js';

it('runs two domains through schema evolution and a conflict without live services', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deeplake-full-demo-'));
  const repository = await createStore({ memory: true });
  try {
    const snapshot = await seedDemo(repository, new FileBlobStore(directory));
    expect(snapshot.projects).toHaveLength(2);
    expect(snapshot.proposals.some(p => p.status === 'approved')).toBe(true);
    expect(snapshot.proposals.some(p => p.status === 'pending')).toBe(true);
    expect(snapshot.sourceVersions.every(v => v.acquisition === 'fixture')).toBe(true);
    const current = snapshot.projects.flatMap(project => snapshot.publications.filter(p => p.id === project.publishedReleaseId));
    expect(current.flatMap(p => p.records).length).toBeGreaterThan(10);
    expect(current.flatMap(p => p.records).some(r => Object.values(r.fields).some(f => f.conflict))).toBe(true);
    expect(current.flatMap(p => p.records).some(r => r.fields.prerequisiteRule?.value != null)).toBe(true);
    expect(snapshot.jobs.some(j => j.kind === 'replay' && j.status === 'succeeded')).toBe(true);
    expect(snapshot.usage.every(u => ['demo', 'fixture'].includes(u.provider) && u.estimatedCostUsd === 0)).toBe(true);
    expect(snapshot.runs.every(r => r.status === 'completed')).toBe(true);
  } finally {
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
