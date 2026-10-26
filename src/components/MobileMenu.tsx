import { useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { isPlaceholderEmail, site } from '../data/site';
import { enabledSocialLinks } from '../shared/site-content';
import { useBodyScrollLock, useEscapeKey, useFocusTrap } from '../lib/hooks';
import { useSiteContent } from '../lib/site-content';
import { useSearchOverlay } from './SearchOverlay';
import { ThemeToggle } from './ThemeToggle';
import { AmbientMusic, AmbientVolume } from './AmbientMusic';
import { SOCIAL_ICONS, IconArrowRight, IconClose, IconMail, IconSearch } from './Icons';

interface MobileMenuProps {
  id: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Full-screen mobile navigation.
 *
 * Locks background scrolling, traps focus, closes on Escape, and closes after
 * navigation — the four things these menus usually get wrong.
 */
export function MobileMenu({ id, open, onClose }: MobileMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { open: openSearch } = useSearchOverlay();
  const { social, contact } = useSiteContent();
  // The same published links the footer renders, capped so the menu stays a menu.
  const socials = enabledSocialLinks(social).slice(0, 4);

  useFocusTrap(panelRef, open);
  useBodyScrollLock(open);
  useEscapeKey(onClose, open);

  if (!open) return null;

  return (
    <div className="mobile-menu" id={id} ref={panelRef} role="dialog" aria-modal="true" aria-label="Site menu">
      <div className="cluster" style={{ justifyContent: 'space-between', marginBottom: 'var(--space-5)' }}>
        <span className="eyebrow">Navigate</span>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close menu" data-autofocus>
          <IconClose size={22} />
        </button>
      </div>

      <ul className="mobile-menu__list">
        {site.nav.map((item) => (
          <li key={item.to}>
            <NavLink className="mobile-menu__link" to={item.to} end={!item.matchPrefix} onClick={onClose}>
              {item.label}
              <IconArrowRight size={20} />
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="mobile-menu__footer">
        {site.features.search ? (
          <button
            type="button"
            className="btn btn--block"
            onClick={() => {
              onClose();
              openSearch();
            }}
          >
            <IconSearch size={18} />
            Search games
          </button>
        ) : null}

        <ThemeToggle variant="wide" />

        <AmbientMusic variant="wide" />

        <AmbientVolume variant="wide" />

        {!isPlaceholderEmail(contact.email) ? (
          <a className="btn btn--secondary btn--block" href={`mailto:${contact.email}`}>
            <IconMail size={18} />
            Email me
          </a>
        ) : null}

        {socials.length > 0 ? (
          <ul className="social-list">
            {socials.map((social) => {
              const Icon = SOCIAL_ICONS[social.platform];
              return (
                <li key={social.url}>
                  <a className="social-link" href={social.url} target="_blank" rel="noreferrer noopener">
                    <Icon size={18} />
                    {social.label}
                  </a>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
