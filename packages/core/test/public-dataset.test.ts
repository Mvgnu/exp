import { describe, expect, it } from 'vitest';
import { buildPublication, buildPublicDataset } from '../src/index.js';
import { project, projection, schema, segment, version } from './fixtures.js';

describe('public evidence context', () => {
  it('exports only cited context and strips operator and raw-source metadata', () => {
    const publication = buildPublication(projection());
    const dataset = buildPublicDataset({
      project: {
        ...project,
        currentSchemaId: 'newer-schema',
        seedUrls: ['https://private.example/seed'],
      },
      publication,
      schema,
      sourceVersions: [
        { ...version, headers: { authorization: 'private-header' }, blobKey: 'private-blob' },
        { ...version, id: 'unpublished-version', title: 'Unpublished source' },
      ],
      segments: [segment, { ...segment, id: 'uncited-segment', text: 'Unpublished context' }],
    });
    expect(dataset.schema.id).toBe(publication.schemaId);
    expect(dataset.passages).toHaveLength(1);
    expect(dataset.passages[0]?.text).toBe(segment.text);
    expect(dataset.sources.map((source) => source.id)).toEqual([version.id]);
    for (const secret of [
      'private-header',
      'private-blob',
      'private.example',
      'Unpublished context',
      'Unpublished source',
    ]) {
      expect(JSON.stringify(dataset)).not.toContain(secret);
    }
    const evidence = publication.records[0]!.fields.amount!.evidence[0]!;
    expect(dataset.passages[0]?.text.slice(evidence.start, evidence.end)).toBe(evidence.quote);
  });

  it('fails closed for missing or altered historical context and mismatched schemas', () => {
    const input = {
      project,
      publication: buildPublication(projection()),
      schema,
      sourceVersions: [version],
      segments: [segment],
    };
    expect(() => buildPublicDataset({ ...input, segments: [] })).toThrow(/context/);
    expect(() => buildPublicDataset({ ...input, sourceVersions: [] })).toThrow(/context/);
    expect(() =>
      buildPublicDataset({
        ...input,
        segments: [{ ...segment, text: segment.text.replace('Amount 6', 'Amount 7') }],
      }),
    ).toThrow(/context/);
    expect(() =>
      buildPublicDataset({ ...input, schema: { ...schema, id: 'another-schema' } }),
    ).toThrow(/pinned schema/);
    expect(() =>
      buildPublicDataset({ ...input, segments: [{ ...segment, projectId: 'another-project' }] }),
    ).toThrow(/context/);
  });
});
