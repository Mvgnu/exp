import { catalog, entries, isDemonstration } from '../lib/catalog';
import { CatalogExplorer } from '../components/explorer';
export default function Page() {
  const records = entries();
  const sources = new Set(catalog.datasets.flatMap((d) => d.publication.sourceVersionIds)).size;
  return (
    <main id="main" className="catalog-main">
      <section className="intro">
        <div>
          <p className="eyebrow">THE PUBLIC KNOWLEDGE CATALOG</p>
          <h1>
            Explore what
            <br />
            <em>the sources say.</em>
          </h1>
          <p className="intro-copy">
            Find the records that fit your question. Follow every detail back to its evidence.
          </p>
        </div>
        <div className="intro-stats">
          <div>
            <strong>{records.length}</strong>
            <span>published records</span>
          </div>
          <div>
            <strong>{sources}</strong>
            <span>source documents</span>
          </div>
          <div>
            <strong>{catalog.datasets.length}</strong>
            <span>collections</span>
          </div>
        </div>
      </section>
      {isDemonstration && (
        <p className="collection-note">
          These example collections demonstrate curriculum comparison and procurement discovery.
          Every document is a labelled synthetic fixture.
        </p>
      )}
      <CatalogExplorer datasets={catalog.datasets} />
    </main>
  );
}
