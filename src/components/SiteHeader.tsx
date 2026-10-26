import { useEffect, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { site } from '../data/site';
import { useScrolledPast } from '../lib/hooks';
import { useSearchOverlay } from './SearchOverlay';
import { ThemeToggle } from './ThemeToggle';
import { AmbientMusic, AmbientVolume } from './AmbientMusic';
import { MobileMenu } from './MobileMenu';
import { IconController, IconMenu, IconSearch } from './Icons';

const SHORTCUT = 'Search games';


export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const scrolled = useScrolledPast(12);
  const { open: openSearch } = useSearchOverlay();
  const location = useLocation();

  // Never leave the menu open across a navigation.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <>
      <header className="site-header" data-scrolled={scrolled}>
        <div className="container site-header__inner">
          <Link className="wordmark" to="/" aria-label={`${site.developerName} — home`}>
            <span className="wordmark__icon" aria-hidden="true">
              <IconController size={22} />
            </span>
            <span className="wordmark__text">
              <span className="wordmark__name">{site.developerName}</span>
              <span className="wordmark__role">Indie game developer</span>
            </span>
          </Link>

          <nav className="site-nav" aria-label="Main">
            <ul className="site-nav__list">
              {site.nav.map((item) => (
                <li key={item.to}>
                  <NavLink className="nav-link" to={item.to} end={!item.matchPrefix}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* A field that opens the real search overlay. It is a button rather
              than an input on purpose: the overlay owns the input, the focus
              trap and the results, so there is exactly one search
              implementation to keep correct. */}
          <div className="header-actions">
            {site.features.search ? (
              <button
                type="button"
                className="search-trigger"
                onClick={openSearch}
                aria-label={`${SHORTCUT} — open the search overlay`}
                aria-keyshortcuts="Control+K Meta+K"
              >
                <span className="search-trigger__label">Search games…</span>
                <IconSearch size={17} />
              </button>
            ) : null}

            <AmbientMusic />

            <AmbientVolume />

            <ThemeToggle />

            <button
              type="button"
              className="icon-button site-nav__toggle"
              aria-expanded={menuOpen}
              aria-controls="hg-mobile-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <IconMenu size={22} />
            </button>
          </div>
        </div>
      </header>

      <MobileMenu id="hg-mobile-menu" open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
