import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, FileText, GitBranch } from 'lucide-react';
import { entries, fieldLabel, formatDate, valueText } from '../../../lib/catalog';
export function generateStaticParams() {
  return entries().map((e) => ({ id: e.record.id }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const entry = entries().find((e) => e.record.id === id);
  return {
    title: entry?.record.label ?? 'Record not found',
    description: entry
      ? `${entry.record.label}: inspect published values, source passages and scope in ${entry.dataset.project.name}.`
      : undefined,
  };
}
export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = entries().find((e) => e.record.id === id);
  if (!entry) notFound();
  const { record, dataset } = entry;
  return (
    <main id="main" className="record-main">
      <a className="back-link" href={`/?collection=${dataset.project.id}`}>
        <ArrowLeft size={15} />
        Back to {dataset.project.name}
      </a>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">
            {dataset.schema.entityTypes.find((t) => t.id === record.entityType)?.label ??
              record.entityType}
          </p>
          <h1>{record.label}</h1>
          <div className="scope-row">
            {Object.entries(record.scope).map(([key, value]) => (
              <span key={key}>
                {key}: {value}
              </span>
            ))}
          </div>
        </div>
        <div className="detail-release">
          <GitBranch size={17} />
          <div>
            <strong>Release {dataset.publication.version}</strong>
            <span>
              Schema v{dataset.schema.version} · {formatDate(dataset.publication.createdAt)}
            </span>
          </div>
        </div>
      </div>
      {record.warnings.length > 0 && (
        <section className="notice-box" aria-label="Record qualifications">
          <h2>Read with these qualifications</h2>
          <ul>
            {record.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="detail-grid">
        <section className="fact-sheet">
          <div className="section-heading">
            <h2>What the evidence supports</h2>
            <span>{Object.keys(record.fields).length} fields</span>
          </div>
          {Object.entries(record.fields).map(([key, field]) => (
            <article className="fact-row" key={key} id={`field-${key}`}>
              <div className="fact-value">
                <h3>{fieldLabel(dataset, record.entityType, key)}</h3>
                {field.conflict ? (
                  <div>
                    <span className="conflict-chip">Sources disagree</span>
                    <p className="alternatives">
                      {field.alternatives.map(valueText).join(' / ')} {field.unit}
                    </p>
                    <p className="muted">No single value has been selected.</p>
                  </div>
                ) : (
                  <p className={typeof field.value === 'object' ? 'structured-value' : ''}>
                    {typeof field.value === 'object' && field.value !== null ? (
                      <code>{JSON.stringify(field.value, null, 2)}</code>
                    ) : (
                      valueText(field.value)
                    )}
                    {field.unit && <span className="unit"> {field.unit}</span>}
                  </p>
                )}
              </div>
              <details className="evidence-details">
                <summary>
                  <FileText size={14} />
                  Show{' '}
                  {field.evidence.length === 1
                    ? 'source passage'
                    : `${field.evidence.length} source passages`}
                </summary>
                {field.evidence.map((e, i) => {
                  const source = dataset.sources.find((s) => s.id === e.sourceVersionId);
                  return (
                    <div className="evidence-block" key={`${e.segmentId}-${e.start}-${i}`}>
                      <blockquote>{e.quote}</blockquote>
                      <div className="evidence-meta">
                        <span>
                          {source?.title ?? 'Source document'}
                          {e.page ? ` · Page ${e.page}` : ''}
                        </span>
                        <span>
                          Retrieved {formatDate(source?.fetchedAt ?? dataset.publication.createdAt)}
                        </span>
                      </div>
                      {source &&
                        (dataset.project.mode === 'demo' ? (
                          <p className="fixture-origin">
                            Synthetic fixture · {new URL(source.url).hostname}
                          </p>
                        ) : (
                          <a href={source.url} target="_blank" rel="noreferrer">
                            Open original source
                            <ArrowUpRight size={13} />
                          </a>
                        ))}
                    </div>
                  );
                })}
              </details>
            </article>
          ))}
        </section>
        <aside className="record-context">
          <h2>About this record</h2>
          <dl>
            <div>
              <dt>Collection</dt>
              <dd>{dataset.project.name}</dd>
            </div>
            <div>
              <dt>Contributing documents</dt>
              <dd>{record.sourceCount}</dd>
            </div>
            <div>
              <dt>Schema</dt>
              <dd>
                {dataset.schema.name} · v{dataset.schema.version}
              </dd>
            </div>
            <div>
              <dt>Publication</dt>
              <dd>Release {dataset.publication.version}</dd>
            </div>
          </dl>
          <div className="context-note">
            <h3>Evidence, not certainty</h3>
            <p>
              A source passage supports what a document states. It does not independently establish
              that a claim is true.
            </p>
            <a href="/about/">How to read this catalog →</a>
          </div>
          {dataset.project.mode === 'demo' && (
            <div className="context-note demo-context">
              <h3>Synthetic example</h3>
              <p>
                This is a reproducible test fixture for the Deeplake pipeline. It is not an official
                module, institution or tender.
              </p>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
