import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { site } from '../data/site';
import { STORAGE_KEYS, readRaw, writeRaw } from '../lib/storage';
import { IconShield } from './Icons';

/**
 * Privacy / storage banner.
 *
 * The wording is deliberately literal: this site installs no analytics, no
 * advertising and no third-party cookies, and the banner says exactly that
 * rather than implying consent to something that does not exist. The only thing
 * it stores is the acknowledgement itself, and there is nothing pre-ticked.
 *
 * If you add optional analytics later: keep this banner, and gate the script
 * behind an explicit opt-in (see src/lib/analytics.ts).
 */
export function CookieBanner() {
  const [acknowledged, setAcknowledged] = useState(() => readRaw(STORAGE_KEYS.cookieConsent) === 'acknowledged');

  const visible = site.features.cookieBanner && !acknowledged;

  useEffect(() => {
    if (!visible) {
      delete document.body.dataset.banner;
      return;
    }
    document.body.dataset.banner = 'true';
    return () => {
      delete document.body.dataset.banner;
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <section className="cookie-banner" aria-labelledby="hg-privacy-title">
      <h2 className="cookie-banner__title" id="hg-privacy-title">
        <IconShield size={20} />
        {site.privacy.heading}
      </h2>
      <p className="cookie-banner__text">{site.privacy.body}</p>
      <details className="cookie-banner__details">
        <summary>Why these preferences are stored</summary>
        <p className="cookie-banner__text">{site.privacy.detail}</p>
      </details>
      <div className="cookie-banner__actions">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => {
            writeRaw(STORAGE_KEYS.cookieConsent, 'acknowledged');
            setAcknowledged(true);
          }}
        >
          {site.privacy.accept}
        </button>
        <Link className="btn btn--ghost btn--sm" to="/privacy">
          What is stored
        </Link>
        <span className="field__hint" style={{ marginLeft: 'auto' }}>
          {site.privacy.dismissalNote}
        </span>
      </div>
    </section>
  );
}
