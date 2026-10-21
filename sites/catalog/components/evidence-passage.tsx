import { ArrowUpRight } from 'lucide-react';
import type { Evidence, PublicDataset } from '@deeplake/core/contract';
import { formatDate } from '../lib/catalog';
import {
  evidenceTextParts,
  originalSourceUrl,
  preservedPassage,
  sourceIsSynthetic,
} from '../lib/evidence';

export function EvidencePassage({
  dataset,
  evidence,
}: {
  dataset: PublicDataset;
  evidence: Evidence;
}) {
  const source = dataset.sources.find((item) => item.id === evidence.sourceVersionId);
  const passage = preservedPassage(dataset, evidence);
  const parts = passage ? evidenceTextParts(passage, evidence) : null;
  const page = passage?.page ?? evidence.page;
  const synthetic = source ? sourceIsSynthetic(dataset, source) : dataset.project.mode === 'demo';
  const originalUrl = source && !synthetic ? originalSourceUrl(source) : null;

  return (
    <div className="evidence-block">
      <blockquote>{evidence.quote}</blockquote>
      <div className="evidence-meta">
        <strong>{source?.title || 'Source document'}</strong>
        {source && (
          <span>
            Retrieved <time dateTime={source.fetchedAt}>{formatDate(source.fetchedAt)}</time>
          </span>
        )}
      </div>
      {synthetic && <p className="fixture-origin">Synthetic fixture</p>}
      <dl className="evidence-source">
        <div>
          <dt>Source</dt>
          <dd>
            {source ? (
              <code className="source-url">{source.url}</code>
            ) : (
              'Source address is not included in this publication.'
            )}
          </dd>
        </div>
        <div>
          <dt>Immutable version</dt>
          <dd>
            <code className="source-version">{evidence.sourceVersionId}</code>
          </dd>
        </div>
        <div>
          <dt>Passage location</dt>
          <dd className="evidence-locator">
            {passage ? (
              <>
                <span>{passage.heading || 'Heading not recorded'}</span>
                <span>
                  {page ? `Page ${page} · ` : ''}Segment {passage.index + 1}
                </span>
              </>
            ) : (
              <>
                {page && <span>Page {page}</span>}
                <code>{evidence.segmentId}</code>
              </>
            )}
          </dd>
        </div>
      </dl>
      {passage ? (
        <details className="passage-details">
          <summary>Inspect preserved passage</summary>
          <div className="passage-content">
            <p className="passage-note">
              {parts
                ? 'The highlighted text is the cited evidence. Surrounding source text provides context; it is not an additional published fact.'
                : 'The cited span does not match the preserved text in this export. No highlight is shown.'}
            </p>
            {passage.context && (
              <div className="passage-context">
                <span>Preserved record context</span>
                <p>{passage.context}</p>
              </div>
            )}
            <pre className="preserved-passage">
              {parts ? (
                <>
                  {parts.before}
                  <mark>{parts.highlighted}</mark>
                  {parts.after}
                </>
              ) : (
                passage.text
              )}
            </pre>
            <dl className="passage-coordinates">
              <div>
                <dt>Segment ID</dt>
                <dd>
                  <code>{passage.id}</code>
                </dd>
              </div>
              <div>
                <dt>Cited text range</dt>
                <dd>
                  <code>
                    [{evidence.start}, {evidence.end})
                  </code>{' '}
                  · UTF-16 offsets, end exclusive
                </dd>
              </div>
            </dl>
          </div>
        </details>
      ) : (
        <p className="context-unavailable">
          Preserved passage context is not included in this publication. The exact quote and source
          version are shown above.
        </p>
      )}
      {originalUrl && (
        <a href={originalUrl} target="_blank" rel="noreferrer">
          Open original source <ArrowUpRight size={13} />
        </a>
      )}
    </div>
  );
}
