import { Link } from 'react-router-dom';
import { isPlaceholderEmail, site } from '../data/site';
import { enabledSocialLinks } from '../shared/site-content';
import { useCatalogue } from '../lib/catalogue';
import { useSiteContent } from '../lib/site-content';
import { playableGames } from '../lib/library';
import { IconMail } from './Icons';
import { SocialSection } from './SocialSection';

/**
 * The end of every public page: the social band, then the branded footer.
 *
 * The band is rendered from the published social document (see
 * `SocialSection`), and hides itself completely when the owner has not published
 * any links — there is no placeholder row and no hint about the dashboard. The
 * footer below it always stays, so the site still ends with an identity, the
 * navigation and the playable games even with no social profiles configured.
 */
export function SiteFooter() {
  const { social, contact } = useSiteContent();
  const hasSocials = enabledSocialLinks(social).length > 0;
  const playable = playableGames(useCatalogue().games).slice(0, 4);
  const year = new Date().getFullYear();
  // No real address yet: an unconfigured mailto is worse than none. The Contact
  // page explains the state; the footer stays clean instead of printing a
  // placeholder address as if it were the developer's.
  const publicAddress = contact.email.trim();
  const hasAddress = publicAddress.length > 0 && !isPlaceholderEmail(publicAddress);

  return (
    <>
      <SocialSection />

      <footer className={`site-footer${hasSocials ? ' site-footer--after-social' : ''}`}>
        <div className="container site-footer__grid">
          <div className="stack">
            <p className="site-footer__title">{site.developerName}</p>
            <p style={{ color: 'var(--text-muted)', maxWidth: '42ch' }}>{site.footer.tagline}</p>
            <div>
              {hasAddress ? (
                <a className="btn btn--sm" href={`mailto:${publicAddress}`}>
                  <IconMail size={16} />
                  {publicAddress}
                </a>
              ) : (
                <Link className="btn btn--sm" to="/contact">
                  <IconMail size={16} />
                  Contact &amp; enquiries
                </Link>
              )}
            </div>
          </div>

          <nav aria-label="Footer">
            <p className="site-footer__heading">Explore</p>
            <ul className="site-footer__list">
              {site.nav.map((item) => (
                <li key={item.to}>
                  <Link to={item.to}>{item.label}</Link>
                </li>
              ))}
              <li>
                <Link to="/privacy">Privacy &amp; storage</Link>
              </li>
            </ul>
          </nav>

          <div className="stack stack--sm">
            <p className="site-footer__heading">Playable now</p>
            {playable.length > 0 ? (
              <ul className="site-footer__list">
                {playable.map((game) => (
                  <li key={game.slug}>
                    <Link to={game.path}>{game.title}</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: 'var(--text-dim)' }}>First playable builds are in progress.</p>
            )}
          </div>
        </div>

        <div className="container site-footer__bottom">
          <span>
            © {year} {site.developerName}. {site.footer.signOff}
          </span>
          <span>
            No tracking, no ads — <Link to="/privacy">here is exactly what is stored</Link>.
          </span>
        </div>
      </footer>
    </>
  );
}
