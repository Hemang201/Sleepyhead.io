import { useEffect, useState } from 'react';

import { api, ApiError } from '../../lib/api';
import { useAdminAction } from '../../lib/admin';
import { DecoField } from '../../components/Decorations';
import { IconCheck, IconSparkle } from '../../components/Icons';
import { DEFAULT_APPEARANCE, DECO_INTENSITIES, type AppearanceSettings, type DecoIntensity } from '../../shared/site-content';

/**
 * Appearance: the animated background.
 *
 * These settings are stored in the database and applied on every public page, so
 * they persist across reloads and deployments. They are read straight from the
 * settings document rather than a draft — a background tweak has no "publish"
 * step, and it cannot touch the games, which run in their own sandboxed player
 * and never mount any of this.
 *
 * The preview below renders the real component with the unsaved values, so what
 * the owner sees is what the site will do.
 */

const INTENSITY_LABELS: Record<DecoIntensity, { label: string; hint: string }> = {
  low: { label: 'Low', hint: 'A few shapes, barely moving. Best on slow devices.' },
  normal: { label: 'Normal', hint: 'The default: lively but never in the way.' },
  high: { label: 'High', hint: 'Most shapes, longest movements. Still behind the content.' },
};

export default function AdminAppearancePage() {
  const { run, busy } = useAdminAction();
  const [settings, setSettings] = useState<AppearanceSettings>(DEFAULT_APPEARANCE);
  const [saved, setSaved] = useState<AppearanceSettings>(DEFAULT_APPEARANCE);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.admin.content();
        if (cancelled) return;
        setSettings(data.appearance);
        setSaved(data.appearance);
        setStatus('ready');
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'The settings could not load.');
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);

  const save = async () => {
    const result = await run(() => api.admin.saveAppearance(settings), {
      ok: 'Appearance saved',
      okBody: 'Every public page is already using it.',
    });
    if (result) {
      setSettings(result.appearance);
      setSaved(result.appearance);
    }
  };

  if (status === 'error') {
    return (
      <div className="admin-page">
        <div className="callout callout--warn">
          <span className="callout__title">The settings could not load</span>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="stack stack--lg admin-page">
      <header className="admin-page__head">
        <div>
          <p className="section__eyebrow">Appearance</p>
          <h1 className="section__title">Background animation</h1>
          <p className="section__lead">
            The floating shapes around the site. They are decorative only: behind the content, never clickable, paused while
            the tab is hidden, and replaced by a still composition for anyone who asks their device for reduced motion.
          </p>
        </div>
        <div className="cluster">
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy || !dirty}>
            {dirty ? 'Save appearance' : 'Saved'}
          </button>
        </div>
      </header>

      <div className="split split--about">
        <section className="panel stack stack--md" aria-labelledby="deco-settings-heading">
          <h2 className="section__title" id="deco-settings-heading" style={{ fontSize: 'var(--step-2)' }}>
            Settings
          </h2>

          <label className="field field--inline">
            <input
              type="checkbox"
              checked={settings.animations}
              onChange={(event) => setSettings((current) => ({ ...current, animations: event.target.checked }))}
            />
            <span>Enable background animations</span>
          </label>
          <p className="field__hint">
            Turning this off keeps the shapes as a static composition — the page does not go bare.
          </p>

          <fieldset className="field">
            <legend className="field__label">Intensity</legend>
            <div className="stack stack--sm">
              {DECO_INTENSITIES.map((level) => (
                <label className="field field--inline" key={level}>
                  <input
                    type="radio"
                    name="intensity"
                    value={level}
                    checked={settings.intensity === level}
                    onChange={() => setSettings((current) => ({ ...current, intensity: level }))}
                  />
                  <span>
                    <strong>{INTENSITY_LABELS[level].label}</strong>
                    <span className="field__hint">{INTENSITY_LABELS[level].hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="field field--inline">
            <input
              type="checkbox"
              checked={settings.mobileReduction}
              onChange={(event) => setSettings((current) => ({ ...current, mobileReduction: event.target.checked }))}
            />
            <span>Reduce decorations on small screens</span>
          </label>
          <p className="field__hint">
            Small viewports and phones get fewer, cheaper shapes. Recommended on, unless you want the full effect everywhere.
          </p>

          <label className="field field--inline">
            <input
              type="checkbox"
              checked={settings.parallax}
              onChange={(event) => setSettings((current) => ({ ...current, parallax: event.target.checked }))}
            />
            <span>Enable parallax</span>
          </label>
          <p className="field__hint">
            A slight shift as the pointer moves, on precise pointers only, driven by a single animation-frame loop. Off is
            perfectly fine and marginally cheaper.
          </p>

          {dirty ? (
            <div className="callout callout--info" role="status">
              <span className="callout__title">Unsaved changes</span>
              <span>The site is still using the saved settings. Save to apply them everywhere.</span>
            </div>
          ) : (
            <p className="callout callout--success" role="status">
              <IconCheck size={16} /> Saved settings are live on the public site.
            </p>
          )}
        </section>

        <section className="stack stack--md" aria-labelledby="deco-preview-heading">
          <h2 className="section__title" id="deco-preview-heading" style={{ fontSize: 'var(--step-2)' }}>
            Live preview
          </h2>
          <div className="deco-preview deco-host" aria-hidden="true">
            <DecoField variant="hero" override={settings} />
            <p className="deco-preview__label">
              <IconSparkle size={14} />
              Preview of {INTENSITY_LABELS[settings.intensity].label.toLowerCase()} intensity
            </p>
          </div>
          <p className="field__hint">
            The preview uses your unsaved choices. Real content sits in this layer on the live site, and shapes always stay
            behind it.
          </p>
        </section>
      </div>
    </div>
  );
}
