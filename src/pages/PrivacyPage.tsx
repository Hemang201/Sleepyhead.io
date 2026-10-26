import { Link } from 'react-router-dom';
import { site } from '../data/site';
import { Seo } from '../components/Seo';
import { IconShield } from '../components/Icons';

const STORAGE_ROWS: { key: string; name: string; why: string }[] = [
  { key: 'hg.theme.v1', name: 'Theme', why: 'Remembers dark or light so the site looks the same when you come back.' },
  {
    key: 'hg.favourites.v1',
    name: 'Favourites',
    why: 'The games you saved with the heart button, so they are easy to find again.',
  },
  {
    key: 'hg.recent.v1',
    name: 'Recently played',
    why: 'The last few games you launched, so you can pick up where you left off.',
  },
  {
    key: 'hg.games-filter.v1',
    name: 'Library filters',
    why: 'Your chosen genres and sort order in the games library.',
  },
  { key: 'hg.game-muted.v1', name: 'Sound preference', why: 'Whether you muted game audio.' },
  {
    key: 'hg.recent.v1.scores',
    name: 'Best scores',
    why: 'High scores reported by games you played, kept on your device only.',
  },
  {
    key: 'hg.privacy.v1',
    name: 'This notice',
    why: 'A single flag recording that you acknowledged this banner, so it stops appearing.',
  },
];

export default function PrivacyPage() {
  return (
    <div className="page scheme--studio">
      <Seo
        title={`Privacy and browser storage | ${site.developerName}`}
        description="Exactly what this site stores in your browser, why, and how to clear it. No analytics, no advertising, no third-party cookies."
        path="/privacy"
      />

      <div className="container">
        <nav aria-label="Breadcrumb">
          <ol className="breadcrumbs">
            <li>
              <Link to="/">Home</Link>
            </li>
            <li aria-current="page">Privacy &amp; storage</li>
          </ol>
        </nav>

        <header className="stack" style={{ marginBottom: 'var(--space-6)' }}>
          <p className="section__eyebrow">
            <IconShield size={16} /> Plain language
          </p>
          <h1 className="section__title">Privacy &amp; browser storage</h1>
          <p className="section__lead">{site.privacy.body}</p>
        </header>

        <div className="privacy-layout">
          <section className="panel panel--chunky" aria-labelledby="stored-heading">
            <h2 className="panel__title" id="stored-heading">
              What is stored
            </h2>
            <p style={{ color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
              All of it lives in your browser&#39;s local storage under keys prefixed <code>hg.</code>. None of it is
              sent anywhere, and none of it identifies you.
            </p>
            {/* The wrapper scrolls, so a narrow phone gets a scrollable table
                rather than a page-wide horizontal overflow. */}
            <div className="storage-table__scroll" style={{ marginTop: 'var(--space-4)' }}>
              <table className="storage-table">
                <caption className="visually-hidden">Local storage keys used by this site</caption>
                <thead>
                  <tr>
                    <th scope="col">Key</th>
                    <th scope="col">What it holds</th>
                    <th scope="col">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {STORAGE_ROWS.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <code>{row.key}</code>
                        <br />
                        <span className="visually-hidden">{row.name}</span>
                      </td>
                      <td>{row.name}</td>
                      <td>{row.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel" aria-labelledby="no-tracking-heading">
            <h2 className="panel__title" id="no-tracking-heading">
              What is not happening
            </h2>
            <ul className="instruction-list" style={{ marginTop: 'var(--space-4)' }}>
              <li>No analytics, no page-view counters, no session recording.</li>
              <li>No advertising, no trackers, no third-party cookies.</li>
              <li>No accounts, logins, mailing lists or email capture.</li>
              <li>No fingerprinting, and no data sold, shared or exported.</li>
            </ul>
            <p style={{ color: 'var(--text-muted)', marginTop: 'var(--space-4)' }}>
              This site is built so that privacy-friendly analytics <em>could</em> be added later, but nothing is loaded
              today, and any future addition would be gated behind an explicit opt-in that this page would describe.
            </p>
          </section>

          <section className="panel" aria-labelledby="games-heading">
            <h2 className="panel__title" id="games-heading">
              About the games
            </h2>
            <p style={{ color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
              Games are hosted by itch.io and run in a separate frame from their own domain, which cannot read this page,
              your storage on this site, or your other tabs. itch.io may set its own cookies or local storage inside that
              frame to run the game — see itch.io’s privacy policy for what the game itself stores.
            </p>
            <p style={{ color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
              Nothing is requested from itch.io until you press play. The frame is given only what a game needs (scripts,
              its own storage, pointer lock, fullscreen and audio), and nothing that would let it reach this site’s admin
              session.
            </p>
          </section>

          <section className="panel" aria-labelledby="clear-heading">
            <h2 className="panel__title" id="clear-heading">
              How to clear it
            </h2>
            <p style={{ color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
              Clearing site data in your browser settings removes everything listed above — the site simply returns to its
              defaults, and nothing is lost that matters. You can also use the reset button in the games library to clear
              your filters.
            </p>
            <div className="section__actions" style={{ marginTop: 'var(--space-4)' }}>
              <Link className="btn btn--secondary" to="/games">
                Back to the library
              </Link>
              <Link className="btn btn--ghost" to="/contact">
                Ask me a question
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
