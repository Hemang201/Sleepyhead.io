import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, ApiError, type ContentResponse } from '../../lib/api';
import { useAdmin, useAdminAction } from '../../lib/admin';
import { useUnsavedChanges } from '../../lib/unsaved';
import { ConfirmDialog } from '../../components/admin/ConfirmDialog';
import { SocialSection } from '../../components/SocialSection';
import { Spinner } from '../../components/Spinner';
import {
  CONTENT_LIMITS,
  DEFAULT_SOCIAL,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_KEYS,
  asSocialPlatform,
  enabledSocialLinks,
  type SocialContent,
  type SocialLink,
  type SocialPlatform,
} from '../../shared/site-content';
import {
  IconArrowDown,
  IconArrowUp,
  IconExternal,
  IconEye,
  IconPlus,
  IconRestart,
  IconTrash,
  SOCIAL_ICONS,
} from '../../components/Icons';

/**
 * Social links: the manager for the band at the bottom of the public site.
 *
 * Storage is the same mechanism as the About page and the Contact details — a
 * draft the owner edits and a published copy the public site reads from
 * `site_content('social')` — so there is exactly one source of truth for these
 * links and no second configuration file to keep in sync. Saving writes the
 * draft; publishing makes it public immediately, with no rebuild and no deploy.
 *
 * Two details that are deliberate rather than incidental:
 *   - the order of the list *is* the display order, so reordering is done by
 *     moving rows with buttons (keyboard- and touch-friendly) and there is no
 *     separate position field that could drift;
 *   - validation runs on the server, against the same rules the preview and the
 *     public site use, and its per-field messages are shown on the field they
 *     belong to instead of in one lump.
 */
export default function AdminSocialPage() {
  const { run, busy } = useAdminAction();
  const { notify } = useAdmin();
  const [documents, setDocuments] = useState<ContentResponse | null>(null);
  const [draft, setDraft] = useState<SocialContent>(DEFAULT_SOCIAL);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [newPlatform, setNewPlatform] = useState<SocialPlatform>('github');
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useUnsavedChanges(dirty);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const data = await api.admin.content();
      setDocuments(data);
      setDraft(data.social.draft);
      setFieldErrors({});
      setDirty(false);
      setStatus('ready');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The social links editor could not load.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const edit = (patch: Partial<SocialContent>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  };

  const editLink = (index: number, patch: Partial<SocialLink>) => {
    setDraft((current) => ({
      ...current,
      links: current.links.map((link, position) => (position === index ? { ...link, ...patch } : link)),
    }));
    setDirty(true);
  };

  const moveLink = (from: number, to: number) => {
    if (to < 0 || to >= draft.links.length) return;
    const next = [...draft.links];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    edit({ links: next });
  };

  const addLink = () => {
    edit({
      links: [
        ...draft.links,
        {
          platform: newPlatform,
          // The platform name is a sensible starting label; the owner renames it.
          label: SOCIAL_PLATFORMS[newPlatform],
          url: '',
          handle: '',
          description: '',
          enabled: true,
        },
      ],
    });
  };

  const removeLink = (index: number) => {
    setConfirmDelete(null);
    edit({ links: draft.links.filter((_, position) => position !== index) });
  };

  const stored = documents?.social ?? null;
  const enabled = useMemo(() => enabledSocialLinks(draft), [draft]);
  const published = stored?.published ?? null;
  const publishedCount = published ? enabledSocialLinks({ ...published, visible: true }).length : 0;

  /** Saves the draft and returns whether the server accepted it. */
  const save = async (): Promise<boolean> => {
    setSaving(true);
    try {
      const result = await api.admin.saveSocial(draft);
      setDocuments((current) => (current ? { ...current, social: result.document } : current));
      setDraft(result.document.draft);
      setFieldErrors({});
      setDirty(false);
      return true;
    } catch (caught) {
      if (caught instanceof ApiError) {
        // Field errors are keyed `links.3.url`, so each one lands on its own row.
        setFieldErrors(caught.fields ?? {});
        notify({
          tone: 'error',
          title: 'Some links need attention',
          body: Object.values(caught.fields ?? {}).slice(0, 2).join(' ') || caught.message,
        });
      } else {
        notify({ tone: 'error', title: 'That did not work', body: 'The draft could not be saved.' });
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = async () => {
    const saved = await save();
    if (saved) notify({ tone: 'ok', title: 'Social links draft saved', body: 'Publish when the footer should change.' });
  };

  const publish = async () => {
    const saved = await save();
    if (!saved) return;
    await run(
      async () => {
        const result = await api.admin.publishSocial();
        setDocuments((current) => (current ? { ...current, social: result.document } : current));
        setDraft(result.document.draft);
        return result;
      },
      { ok: 'Published', okBody: 'The bottom of the public site is already showing this.' },
    );
  };

  const discard = async () => {
    setConfirmDiscard(false);
    const result = await run(() => api.admin.discardSocial(), {
      ok: 'Draft discarded',
      okBody: 'The draft now matches the published version.',
    });
    if (result) {
      setDocuments((current) => (current ? { ...current, social: result.document } : current));
      setDraft(result.document.draft);
      setFieldErrors({});
      setDirty(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="stack stack--lg admin-page">
        <div className="skeleton" style={{ height: 44, width: 'min(360px, 60%)' }} />
        <div className="skeleton" style={{ height: 420 }} />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="admin-page">
        <div className="callout callout--warn">
          <span className="callout__title">The editor could not load</span>
          <span>{error}</span>
          <div className="cluster" style={{ marginTop: 'var(--space-3)' }}>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void load()}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const working = saving || busy;

  return (
    <div className="stack stack--lg admin-page">
      <header className="admin-page__head">
        <div>
          <p className="section__eyebrow">Social links</p>
          <h1 className="section__title">Where to find you</h1>
          <p className="section__lead">
            These links are stored in the database and shown at the bottom of every public page, in the order below.
            Publishing updates the live site immediately — no rebuild, no deploy.
          </p>
        </div>
        <div className="cluster">
          <Link className="btn btn--ghost" to="/" target="_blank" rel="noreferrer">
            <IconEye size={16} />
            View the site
          </Link>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setConfirmDiscard(true)}
            disabled={!dirty || working}
          >
            <IconRestart size={16} />
            Cancel changes
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => void saveDraft()} disabled={working || !dirty}>
            Save draft
          </button>
          {/* The indicator appears inside the control that is actually waiting
              on the server, and the control is disabled while it waits, so the
              action cannot be fired twice. */}
          <button
            type="button"
            className={`btn btn--primary${working ? ' btn--busy' : ''}`}
            onClick={() => void publish()}
            disabled={working}
          >
            {working ? <Spinner shape="ring" size="sm" /> : null}
            {working ? 'Publishing…' : 'Publish changes'}
          </button>
        </div>
      </header>

      {dirty ? (
        <div className="callout callout--info" role="status">
          <span className="callout__title">Unpublished changes</span>
          <span>
            {stored?.publishedAt
              ? `The live site is still showing the version published on ${new Date(stored.publishedAt).toLocaleString()}.`
              : 'Nothing has been published yet, so the live site is showing the shipped defaults.'}{' '}
            Save the draft to keep it, or publish to make it public.
          </span>
        </div>
      ) : null}

      <section className="panel stack stack--md" aria-labelledby="social-heading-section">
        <div>
          <h2 className="section__title" id="social-heading-section" style={{ fontSize: 'var(--step-2)' }}>
            The section itself
          </h2>
          <p style={{ color: 'var(--text-muted)' }}>
            The heading and the one-line introduction above your links. The section hides itself on the public site when
            there is nothing enabled to show.
          </p>
        </div>

        <label className="field field--inline">
          <input
            type="checkbox"
            checked={draft.visible}
            onChange={(event) => edit({ visible: event.target.checked })}
          />
          <span>Show this section on the public site</span>
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field__label">Heading</span>
            <input
              className="input"
              value={draft.heading}
              maxLength={CONTENT_LIMITS.socialHeading}
              placeholder="Find me on the internet"
              onChange={(event) => edit({ heading: event.target.value })}
            />
            {fieldErrors.heading ? <span className="field__error">{fieldErrors.heading}</span> : null}
          </label>
          <label className="field">
            <span className="field__label">Introduction</span>
            <input
              className="input"
              value={draft.intro}
              maxLength={CONTENT_LIMITS.socialIntro}
              placeholder="One line about where you post"
              onChange={(event) => edit({ intro: event.target.value })}
            />
          </label>
        </div>
      </section>

      <section className="panel stack stack--md" aria-labelledby="social-list-heading">
        <div className="social-manager__head">
          <div>
            <h2 className="section__title" id="social-list-heading" style={{ fontSize: 'var(--step-2)' }}>
              Links
            </h2>
            <p style={{ color: 'var(--text-muted)' }}>
              {draft.links.length} configured · {enabled.length} visible. Disabled links stay here and disappear from the
              site.
            </p>
          </div>
          <div className="social-manager__add">
            <label className="field">
              <span className="field__label">Add a platform</span>
              <select
                className="input"
                value={newPlatform}
                data-social-platform-picker
                onChange={(event) => setNewPlatform(asSocialPlatform(event.target.value))}
              >
                {SOCIAL_PLATFORM_KEYS.map((key) => (
                  <option value={key} key={key}>
                    {SOCIAL_PLATFORMS[key]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn--primary"
              onClick={addLink}
              data-add-social
              disabled={draft.links.length >= CONTENT_LIMITS.socialLinks}
            >
              <IconPlus size={16} />
              Add link
            </button>
          </div>
        </div>

        {fieldErrors.links ? <span className="field__error">{fieldErrors.links}</span> : null}

        {draft.links.length === 0 ? (
          <p className="repeatable__empty">
            No links yet. Add one above — until then the public site shows no social section at all.
          </p>
        ) : (
          <ul className="social-manager">
            {draft.links.map((link, index) => {
              const Icon = SOCIAL_ICONS[link.platform] ?? IconExternal;
              const urlError = fieldErrors[`links.${index}.url`];
              const labelError = fieldErrors[`links.${index}.label`];
              return (
                <li className="social-manager__item" key={`${link.platform}-${index}`} data-social-row={index}>
                  <div className="social-manager__row-head">
                    <span className="social-manager__index" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="social-manager__icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <span className="social-manager__title">{link.label || SOCIAL_PLATFORMS[link.platform]}</span>
                    {!link.enabled ? <span className="chip chip--muted">Hidden</span> : null}

                    <div className="repeatable__item-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => moveLink(index, index - 1)}
                        disabled={index === 0}
                        aria-label={`Move ${link.label || `link ${index + 1}`} up`}
                      >
                        <IconArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => moveLink(index, index + 1)}
                        disabled={index === draft.links.length - 1}
                        aria-label={`Move ${link.label || `link ${index + 1}`} down`}
                      >
                        <IconArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        onClick={() => setConfirmDelete(index)}
                        aria-label={`Delete ${link.label || `link ${index + 1}`}`}
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="social-manager__fields">
                    <div className="field-row">
                      <label className="field">
                        <span className="field__label">Platform</span>
                        <select
                          className="input"
                          value={link.platform}
                          aria-label={`Platform for link ${index + 1}`}
                          onChange={(event) => editLink(index, { platform: asSocialPlatform(event.target.value) })}
                        >
                          {SOCIAL_PLATFORM_KEYS.map((key) => (
                            <option value={key} key={key}>
                              {SOCIAL_PLATFORMS[key]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span className="field__label">Display name</span>
                        <input
                          className="input"
                          value={link.label}
                          maxLength={CONTENT_LIMITS.socialLabel}
                          aria-label={`Display name for link ${index + 1}`}
                          onChange={(event) => editLink(index, { label: event.target.value })}
                        />
                        {labelError ? <span className="field__error">{labelError}</span> : null}
                      </label>
                    </div>

                    <label className="field">
                      <span className="field__label">
                        {link.platform === 'email' ? 'Email address' : 'Profile URL'}
                      </span>
                      <input
                        className="input"
                        value={link.url}
                        maxLength={CONTENT_LIMITS.socialUrl}
                        spellCheck={false}
                        aria-label={`URL for link ${index + 1}`}
                        placeholder={link.platform === 'email' ? 'you@example.com' : 'https://github.com/you'}
                        onChange={(event) => editLink(index, { url: event.target.value })}
                      />
                      {urlError ? <span className="field__error">{urlError}</span> : null}
                    </label>

                    <div className="field-row">
                      <label className="field">
                        <span className="field__label">Handle (optional)</span>
                        <input
                          className="input"
                          value={link.handle}
                          maxLength={CONTENT_LIMITS.socialHandle}
                          aria-label={`Handle for link ${index + 1}`}
                          placeholder="your-handle"
                          onChange={(event) => editLink(index, { handle: event.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span className="field__label">Short description (optional)</span>
                        <input
                          className="input"
                          value={link.description}
                          maxLength={CONTENT_LIMITS.socialDescription}
                          aria-label={`Description for link ${index + 1}`}
                          onChange={(event) => editLink(index, { description: event.target.value })}
                        />
                      </label>
                    </div>

                    <label className="field field--inline">
                      <input
                        type="checkbox"
                        checked={link.enabled}
                        aria-label={`Show ${link.label || `link ${index + 1}`} on the public site`}
                        onChange={(event) => editLink(index, { enabled: event.target.checked })}
                      />
                      <span>Visible on the public site</span>
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/*
        The preview is the real public component with the draft document, which is
        the only honest way to answer "what will this look like": the same icons,
        the same order and the same URL rules as the footer.
      */}
      <section className="panel stack stack--md" aria-labelledby="social-preview-heading" data-social-preview>
        <div>
          <h2 className="section__title" id="social-preview-heading" style={{ fontSize: 'var(--step-2)' }}>
            Preview
          </h2>
          <p style={{ color: 'var(--text-muted)' }}>
            Exactly the component the public site renders, using this draft. {enabled.length === 0
              ? 'With nothing enabled, the section does not appear on the site at all.'
              : publishedCount === enabled.length
                ? 'This matches what is published.'
                : `${publishedCount} of these are published right now.`}
          </p>
        </div>
        <div className="social-preview">
          <SocialSection content={draft} preview />
        </div>
      </section>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete this link?"
        body={
          confirmDelete !== null ? (
            <>
              <p>
                <strong>{draft.links[confirmDelete]?.label || `Link ${confirmDelete + 1}`}</strong> will be removed from
                the draft. The public site keeps showing the published version until you publish.
              </p>
            </>
          ) : null
        }
        confirmLabel="Delete link"
        busy={working}
        onConfirm={() => confirmDelete !== null && removeLink(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={confirmDiscard}
        title="Cancel your unsaved edits?"
        body={
          <p>
            The draft goes back to the last saved version. Anything typed since the last save is lost.
          </p>
        }
        confirmLabel="Discard my edits"
        tone="primary"
        busy={working}
        onConfirm={() => void discard()}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  );
}
