import type { Evidence, PublicDataset } from '@deeplake/core/contract';

export function preservedPassage(dataset: PublicDataset, evidence: Evidence) {
  return dataset.passages.find(
    (passage) =>
      passage.id === evidence.segmentId && passage.sourceVersionId === evidence.sourceVersionId,
  );
}

export function evidenceTextParts(passage: PublicDataset['passages'][number], evidence: Evidence) {
  if (
    passage.id !== evidence.segmentId ||
    passage.sourceVersionId !== evidence.sourceVersionId ||
    !Number.isInteger(evidence.start) ||
    !Number.isInteger(evidence.end) ||
    evidence.start < 0 ||
    evidence.end <= evidence.start ||
    evidence.end > passage.text.length ||
    (evidence.page !== undefined && evidence.page !== passage.page) ||
    passage.text.slice(evidence.start, evidence.end) !== evidence.quote
  )
    return null;

  // Evidence offsets are half-open UTF-16 offsets into the original segment text.
  return {
    before: passage.text.slice(0, evidence.start),
    highlighted: passage.text.slice(evidence.start, evidence.end),
    after: passage.text.slice(evidence.end),
  };
}

export function sourceIsSynthetic(
  dataset: PublicDataset,
  source: PublicDataset['sources'][number],
) {
  return dataset.project.mode === 'demo' || source.acquisition === 'fixture';
}

export function originalSourceUrl(source: PublicDataset['sources'][number]) {
  const url = new URL(source.url);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const reserved =
    hostname === 'example' ||
    hostname.endsWith('.example') ||
    ['example.com', 'example.net', 'example.org'].some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  return ['http:', 'https:'].includes(url.protocol) && !reserved ? source.url : null;
}
