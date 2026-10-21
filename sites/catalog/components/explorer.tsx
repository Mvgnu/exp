'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  ArrowRight,
  Check,
  FileText,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { PublicDataset } from '@deeplake/core/contract';
import { fieldLabel, siteConfig, valueText } from '../lib/catalog';
type Filters = {
  q: string;
  project: string;
  facets: Record<string, string>;
  min: string;
  max: string;
  numeric: string;
  sort: string;
};
const empty: Filters = {
  q: '',
  project: '',
  facets: {},
  min: '',
  max: '',
  numeric: '',
  sort: 'name',
};
function fromUrl(): Filters {
  const p = new URLSearchParams(window.location.search);
  return {
    q: p.get('q') ?? '',
    project: p.get('collection') ?? '',
    facets: Object.fromEntries(siteConfig.facetFields.map((key) => [key, p.get(key) ?? ''])),
    min: p.get('min') ?? '',
    max: p.get('max') ?? '',
    numeric: p.get('numeric') ?? '',
    sort: p.get('sort') ?? 'name',
  };
}
export function CatalogExplorer({ datasets }: { datasets: PublicDataset[] }) {
  const [filters, setFilters] = useState<Filters>(empty);
  const [mounted, setMounted] = useState(false);
  const [mobileFilters, setMobileFilters] = useState(false);
  useEffect(() => {
    setFilters(fromUrl());
    setMounted(true);
    const change = () => setFilters(fromUrl());
    const search = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key === '/' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !(
          target instanceof HTMLElement &&
          (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        )
      ) {
        event.preventDefault();
        document.getElementById('catalog-search')?.focus();
      }
    };
    window.addEventListener('popstate', change);
    window.addEventListener('keydown', search);
    return () => {
      window.removeEventListener('popstate', change);
      window.removeEventListener('keydown', search);
    };
  }, []);
  function update(patch: Partial<Filters>) {
    setFilters((current) => {
      const next = { ...current, ...patch };
      const p = new URLSearchParams();
      if (next.q) p.set('q', next.q);
      if (next.project) p.set('collection', next.project);
      for (const [key, val] of Object.entries(next.facets)) if (val) p.set(key, val);
      if (next.numeric) p.set('numeric', next.numeric);
      if (next.min) p.set('min', next.min);
      if (next.max) p.set('max', next.max);
      if (next.sort !== 'name') p.set('sort', next.sort);
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${p.size ? '?' + p.toString() : ''}`,
      );
      return next;
    });
  }
  const all = useMemo(
    () =>
      datasets.flatMap((dataset) =>
        dataset.publication.records.map((record) => ({ dataset, record })),
      ),
    [datasets],
  );
  const collection = all.filter(
    ({ dataset }) => !filters.project || dataset.project.id === filters.project,
  );
  const facets = siteConfig.facetFields
    .map((id) => ({
      id,
      label: collection[0]
        ? fieldLabel(collection[0].dataset, collection[0].record.entityType, id)
        : id,
      values: [
        ...new Set(
          collection.flatMap(({ record }) => {
            const f = record.fields[id];
            return f && !f.conflict && typeof f.value === 'string' ? [f.value] : [];
          }),
        ),
      ].sort(),
    }))
    .filter((f) => f.values.length > 1);
  const numeric = siteConfig.numericFields
    .map((id) => {
      const entry = collection.find(({ record }) => typeof record.fields[id]?.value === 'number');
      return entry
        ? {
            id,
            label: fieldLabel(entry.dataset, entry.record.entityType, id),
            unit: entry.record.fields[id]?.unit ?? '',
          }
        : null;
    })
    .filter((x) => x !== null);
  const selectedNumeric = numeric.find((n) => n.id === filters.numeric);
  const results = collection
    .filter(({ record }) => {
      if (
        filters.q &&
        !`${record.label} ${JSON.stringify(record.fields)} ${JSON.stringify(record.scope)}`
          .toLowerCase()
          .includes(filters.q.toLowerCase())
      )
        return false;
      for (const [id, value] of Object.entries(filters.facets))
        if (value && record.fields[id]?.value !== value) return false;
      if (filters.numeric && (filters.min || filters.max)) {
        const value = record.fields[filters.numeric]?.value;
        if (typeof value !== 'number') return false;
        if (filters.min && value < Number(filters.min)) return false;
        if (filters.max && value > Number(filters.max)) return false;
      }
      return true;
    })
    .sort((a, b) =>
      filters.sort === 'sources'
        ? b.record.sourceCount - a.record.sourceCount ||
          a.record.label.localeCompare(b.record.label)
        : a.record.label.localeCompare(b.record.label),
    );
  const active =
    Object.values(filters.facets).filter(Boolean).length +
    (filters.project ? 1 : 0) +
    (filters.q ? 1 : 0) +
    (filters.min || filters.max ? 1 : 0);
  return (
    <section className="explorer" aria-label="Search published records">
      <div className="collection-tabs" role="group" aria-label="Collection">
        <button
          className={!filters.project ? 'selected' : ''}
          onClick={() => update({ ...empty, q: filters.q })}
        >
          All collections <span>{all.length}</span>
        </button>
        {datasets.map((d) => (
          <button
            key={d.project.id}
            className={filters.project === d.project.id ? 'selected' : ''}
            onClick={() => update({ ...empty, project: d.project.id })}
          >
            {d.project.name}
            <span>{d.publication.records.length}</span>
          </button>
        ))}
      </div>
      <div className="search-toolbar">
        <label className="search-field">
          <Search size={19} />
          <input
            id="catalog-search"
            type="search"
            placeholder="Search names, requirements, authorities…"
            aria-label="Search catalog"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
          />
          <kbd>/</kbd>
        </label>
        <button
          className="filter-toggle"
          onClick={() => setMobileFilters(!mobileFilters)}
          aria-expanded={mobileFilters}
        >
          <SlidersHorizontal size={17} />
          Filters {active > 0 && <span>{active}</span>}
        </button>
        <label className="sort-control">
          <ArrowDownUp size={15} />
          <span className="sr-only">Sort records</span>
          <select
            aria-label="Sort records"
            value={filters.sort}
            onChange={(e) => update({ sort: e.target.value })}
          >
            <option value="name">Name, A–Z</option>
            <option value="sources">Most sources</option>
          </select>
        </label>
      </div>
      <div className="explorer-grid">
        <aside className={`facets ${mobileFilters ? 'show' : ''}`}>
          <div className="facets-heading">
            <h2>
              <SlidersHorizontal size={15} />
              Refine results
            </h2>
            {active > 0 && (
              <button onClick={() => update(empty)} className="text-button">
                Reset
              </button>
            )}
          </div>
          {facets.map((f) => (
            <label className="facet-field" key={f.id}>
              <span>{f.label}</span>
              <select
                aria-label={f.label}
                value={filters.facets[f.id] ?? ''}
                onChange={(e) => update({ facets: { ...filters.facets, [f.id]: e.target.value } })}
              >
                <option value="">All {f.label.toLowerCase()}</option>
                {f.values.map((value) => (
                  <option key={value} value={value}>
                    {value} (
                    {collection.filter((e) => e.record.fields[f.id]?.value === value).length})
                  </option>
                ))}
              </select>
            </label>
          ))}
          {numeric.length > 0 && (
            <div className="numeric-filter">
              <label className="facet-field">
                <span>Numeric constraint</span>
                <select
                  aria-label="Numeric constraint"
                  value={filters.numeric}
                  onChange={(e) => update({ numeric: e.target.value, min: '', max: '' })}
                >
                  <option value="">Choose a field</option>
                  {numeric.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                      {n.unit ? ` (${n.unit})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {selectedNumeric && (
                <div className="range-inputs">
                  <label>
                    <span>At least</span>
                    <input
                      type="number"
                      aria-label="Minimum value"
                      placeholder="Any"
                      value={filters.min}
                      onChange={(e) => update({ min: e.target.value })}
                    />
                  </label>
                  <span>–</span>
                  <label>
                    <span>At most</span>
                    <input
                      type="number"
                      aria-label="Maximum value"
                      placeholder="Any"
                      value={filters.max}
                      onChange={(e) => update({ max: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </div>
          )}
          <div className="provenance-note">
            <Check size={18} />
            <p>
              <strong>Evidence travels with the data.</strong>Every displayed value has a source
              passage. Disagreements stay visible.
            </p>
          </div>
        </aside>
        <div className="results">
          <div className="results-heading">
            <p aria-live="polite">
              <strong>{results.length}</strong> {results.length === 1 ? 'record' : 'records'}
              <span> / {collection.length} in this view</span>
            </p>
            <span className="release-tag">
              <span />
              Published releases
            </span>
          </div>
          {active > 0 && (
            <div className="active-filters">
              {Object.entries(filters.facets)
                .filter(([, v]) => v)
                .map(([id, v]) => (
                  <button
                    key={id}
                    onClick={() => update({ facets: { ...filters.facets, [id]: '' } })}
                  >
                    {v}
                    <X size={12} />
                  </button>
                ))}
              {(filters.min || filters.max) && (
                <button onClick={() => update({ min: '', max: '' })}>
                  {selectedNumeric?.label}: {filters.min || 'any'}–{filters.max || 'any'}
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          <div className="record-grid">
            {results.map(({ record, dataset }) => {
              const display = Object.entries(record.fields)
                .filter(
                  ([key]) =>
                    ![
                      'name',
                      'code',
                      'reference',
                      'institution',
                      'authority',
                      'curriculum',
                      'year',
                    ].includes(key),
                )
                .slice(0, 3);
              const identity = record.fields.code ?? record.fields.reference;
              return (
                <article className="record-card" key={record.id}>
                  <div className="record-topline">
                    <span>
                      {dataset.schema.entityTypes.find((t) => t.id === record.entityType)?.label ??
                        record.entityType}
                    </span>
                    {identity && <code>{valueText(identity.value)}</code>}
                  </div>
                  <h3>
                    <a href={`/records/${record.id}/`}>{record.label}</a>
                  </h3>
                  <p className="record-owner">
                    {valueText(
                      (record.fields.institution ?? record.fields.authority)?.value ??
                        dataset.project.name,
                    )}
                  </p>
                  <dl>
                    {display.map(([key, f]) => (
                      <div key={key}>
                        <dt>{fieldLabel(dataset, record.entityType, key)}</dt>
                        <dd className={f.conflict ? 'conflict-value' : ''}>
                          {f.conflict ? 'Sources disagree' : valueText(f.value)}
                          {f.unit && !f.conflict && <span className="unit"> {f.unit}</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="scope-row">
                    {Object.entries(record.scope).map(([key, value]) => (
                      <span key={key}>
                        {key} {value}
                      </span>
                    ))}
                    {record.warnings.some((w) => w.includes('disagree')) && (
                      <span className="conflict-chip">Disagreement</span>
                    )}
                  </div>
                  <div className="record-footer">
                    <span>
                      <FileText size={13} />
                      {record.sourceCount} {record.sourceCount === 1 ? 'source' : 'sources'}
                    </span>
                    <a
                      href={`/records/${record.id}/`}
                      aria-label={`Inspect evidence for ${record.label}`}
                    >
                      Inspect evidence
                      <ArrowRight size={14} />
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
          {results.length === 0 && (
            <div className="empty-state">
              <Search size={30} />
              <h3>No records fit these constraints.</h3>
              <p>
                Try a broader term or clear a filter. Missing results do not mean the information
                does not exist.
              </p>
              <button className="primary-button" onClick={() => update(empty)}>
                Clear all filters
              </button>
            </div>
          )}
          {!mounted && (
            <noscript>
              Use the static record links below to inspect the catalog. Interactive filtering
              requires JavaScript.
            </noscript>
          )}
          <p className="coverage-note">
            Showing a published, bounded collection. These records are not a claim of complete
            coverage.
          </p>
        </div>
      </div>
    </section>
  );
}
