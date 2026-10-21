import { describe, expect, it } from 'vitest';
import { PublicDatasetSchema } from '@deeplake/core/contract';
import type { Evidence, PublicDataset } from '@deeplake/core/contract';
import { catalog } from '../lib/catalog';
import {
  evidenceTextParts,
  originalSourceUrl,
  preservedPassage,
  sourceIsSynthetic,
} from '../lib/evidence';

const dataset = catalog.datasets[0];
if (!dataset) throw new Error('Catalog test requires a public dataset.');
const text = '🧭 Draft estimate: 740000.\nRevised estimate: 740000.\nCurrency: GBP.';
const passage: PublicDataset['passages'][number] = {
  id: 'segment_test',
  sourceVersionId: 'version_test',
  index: 2,
  text,
  heading: 'Revised estimate',
  page: 4,
  context: 'Synthetic source · procurement lot A',
};
const evidence: Evidence = {
  segmentId: passage.id,
  sourceVersionId: passage.sourceVersionId,
  start: text.lastIndexOf('740000'),
  end: text.lastIndexOf('740000') + '740000'.length,
  quote: '740000',
  page: 4,
};

describe('published passage inspection', () => {
  it('highlights the exact UTF-16 range when the same quote occurs twice', () => {
    const parts = evidenceTextParts(passage, evidence);
    expect(parts).toEqual({
      before: '🧭 Draft estimate: 740000.\nRevised estimate: ',
      highlighted: '740000',
      after: '.\nCurrency: GBP.',
    });
    expect(parts && parts.before + parts.highlighted + parts.after).toBe(text);
  });

  it.each([
    { start: -1 },
    { start: evidence.start + 0.5 },
    { end: text.length + 1 },
    { end: evidence.start },
    { quote: '780000' },
    { sourceVersionId: 'another_version' },
    { segmentId: 'another_segment' },
    { page: 5 },
  ])('does not invent a highlight for an inconsistent citation: %j', (change) => {
    expect(evidenceTextParts(passage, { ...evidence, ...change })).toBeNull();
  });

  it('requires both the immutable source version and the cited segment', () => {
    const otherVersion = { ...passage, sourceVersionId: 'another_version' };
    const publicData = { ...dataset, passages: [otherVersion, passage] };
    expect(preservedPassage(publicData, evidence)).toBe(passage);
    expect(preservedPassage({ ...dataset, passages: [otherVersion] }, evidence)).toBeUndefined();
  });

  it('keeps older public projections usable without fabricating context', () => {
    const { passages: _passages, ...olderExport } = dataset;
    const parsed = PublicDatasetSchema.parse(olderExport);
    expect(parsed.passages).toEqual([]);
    expect(preservedPassage(parsed, evidence)).toBeUndefined();
  });

  it('keeps fixtures local and only offers a real HTTP original address', () => {
    const source: PublicDataset['sources'][number] = {
      id: 'version_test',
      title: 'Synthetic estimate',
      url: 'https://procurement.example/notices/6',
      fetchedAt: '2026-10-21T09:00:00.000Z',
      acquisition: 'fixture',
    };
    expect(sourceIsSynthetic(dataset, source)).toBe(true);
    expect(originalSourceUrl(source)).toBeNull();
    expect(
      originalSourceUrl({ ...source, url: 'https://records.example.org/notices/6' }),
    ).toBeNull();
    expect(originalSourceUrl({ ...source, url: 'javascript:alert(1)' })).toBeNull();
    expect(originalSourceUrl({ ...source, url: 'https://www.gov.uk/notices/6' })).toBe(
      'https://www.gov.uk/notices/6',
    );
  });
});
