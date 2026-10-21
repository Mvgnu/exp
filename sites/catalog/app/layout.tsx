import type { Metadata } from 'next';
import './globals.css';
import { isDemonstration, siteConfig } from '../lib/catalog';
export const metadata: Metadata = {
  title: { default: 'Open Atlas · Explore the evidence', template: '%s · Open Atlas' },
  description:
    'A source-backed catalog powered by Deeplake. Explore published records, inspect evidence and see where sources disagree.',
  robots: isDemonstration ? { index: false, follow: false } : { index: true, follow: true },
  metadataBase: new URL(siteConfig.baseUrl),
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {isDemonstration && (
          <div className="demo-strip">
            <span className="demo-dot" />
            Demonstration collection{' '}
            <span className="demo-strip-detail">
              · Synthetic source fixtures, not real-world records
            </span>
          </div>
        )}
        <header className="masthead">
          <div className="masthead-inner">
            <a className="brand" href="/" aria-label="Open Atlas home">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <path d="M3 8 14 2 25 8v12l-11 6L3 20V8Z" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="m3 8 11 6 11-6M14 14v12M8 5l11 6v12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
              <span>
                open atlas<span className="brand-by">BY DEEPLAKE</span>
              </span>
            </a>
            <nav aria-label="Main">
              <a href="/" className="nav-link">
                Explore
              </a>
              <a href="/about/" className="nav-link">
                Reading the evidence
              </a>
              <a
                className="repo-link"
                href={siteConfig.repository}
                target="_blank"
                rel="noreferrer"
              >
                GitHub ↗
              </a>
            </nav>
          </div>
        </header>
        {children}
        <footer className="footer">
          <div>
            <strong>Knowledge you can inspect.</strong>
            <p>Published views are versioned. Source evidence stays attached.</p>
          </div>
          <span>
            Built with <a href={siteConfig.repository}>Deeplake</a> · Open evidence infrastructure
          </span>
        </footer>
      </body>
    </html>
  );
}
