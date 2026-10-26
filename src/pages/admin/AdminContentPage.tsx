import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, ApiError, type ContentResponse } from '../../lib/api';
import { useAdminAction } from '../../lib/admin';
import { useUnsavedChanges } from '../../lib/unsaved';
import { Repeatable, StringList } from '../../components/admin/Repeatable';
import { ConfirmDialog } from '../../components/admin/ConfirmDialog';
import { IconArrowDown, IconArrowUp, IconEye, IconImage, IconRestart, IconShield, IconTrash } from '../../components/Icons';
import {
  ABOUT_SECTIONS,
  ABOUT_SECTION_LABELS,
  CONTENT_LIMITS,
  DEFAULT_ABOUT,
  DEFAULT_CONTACT,
  LINK_ICONS,
  type AboutContent,
  type AboutSectionId,
  type ContactContent,
  type LinkIcon,
} from '../../shared/site-content';

/**
 * Site content: the About page and the public contact details.
 *
 * Everything here is stored in the database with a draft and a published copy.
 * Saving writes the draft; publishing copies it over the published version, which
 * is what the public site reads immediately (the API revalidates, so no rebuild
 * or redeploy is involved). Unpublished drafts need an owner *verified* session
 * to read at all — the server refuses them for everyone else.
 *
 * One important separation, enforced on the server as well as here: the address
 * in the Contact tab is the *public* one. The owner's private authentication
 * address is set up in Account security, is stored in a different table, and is
 * refused here so it can never leak onto the site by accident.
 */
export default function AdminContentPage() {
  const { run, busy } = useAdminAction();
  const [documents, setDocuments] = useState<ContentResponse | null>(null);
  const [about, setAbout] = useState<AboutContent>(DEFAULT_ABOUT);
  const [contact, setContact] = useState<ContactContent>(DEFAULT_CONTACT);
  const [tab, setTab] = useState<'about' | 'contact'>('about');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [aboutDirty, setAboutDirty] = useState(false);
  const [contactDirty, setContactDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<'about' | 'contact' | null>(null);
  const [avatarToken, setAvatarToken] = useState(() => Date.now());
  const avatarInput = useRef<HTMLInputElement>(null);

  useUnsavedChanges(aboutDirty || contactDirty);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const data = await api.admin.content();
      setDocuments(data);
      setAbout(data.about.draft);
      setContact(data.contact.draft);
      setAboutDirty(false);
      setContactDirty(false);
      setStatus('ready');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The content editor could not load.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const editAbout = (patch: Partial<AboutContent>) => {
    setAbout((current) => ({ ...current, ...patch }));
    setAboutDirty(true);
  };

  const editContact = (patch: Partial<ContactContent>) => {
    setContact((current) => ({ ...current, ...patch }));
    setContactDirty(true);
  };

  /**
   * Saving and publishing are written out per document rather than shared,
   * because the two documents have different shapes and TypeScript should say so
   * rather than being talked out of it with a cast.
   */
  const saveAboutDraft = async () => {
    const result = await api.admin.saveAbout(about);
    setDocuments((current) => (current ? { ...current, about: result.document } : current));
    setAbout(result.document.draft);
    setAboutDirty(false);
    return result;
  };

  const saveContactDraft = async () => {
    const result = await api.admin.saveContact(contact);
    setDocuments((current) => (current ? { ...current, contact: result.document } : current));
    setContact(result.document.draft);
    setContactDirty(false);
    return result;
  };

  const save = () => {
    if (tab === 'about') {
      return run(saveAboutDraft, {
        ok: 'About draft saved',
        okBody: 'Publish when you want the public page to change.',
      });
    }
    return run(saveContactDraft, {
      ok: 'Contact draft saved',
      okBody: 'Publish when you want the public page to change.',
    });
  };

  const publish = () =>
    run(
      async () => {
        // Save first so publishing never ships a stale draft.
        if (tab === 'about') {
          await saveAboutDraft();
          const published = await api.admin.publishAbout();
          setDocuments((current) => (current ? { ...current, about: published.document } : current));
          setAbout(published.document.draft);
          setAboutDirty(false);
          return published;
        }
        await saveContactDraft();
        const published = await api.admin.publishContact();
        setDocuments((current) => (current ? { ...current, contact: published.document } : current));
        setContact(published.document.draft);
        setContactDirty(false);
        return published;
      },
      { ok: 'Published', okBody: 'The public pages are already showing this.' },
    );

  const discard = async () => {
    const kind = confirmDiscard;
    setConfirmDiscard(null);
    if (!kind) return;

    const messages = { ok: 'Draft discarded', okBody: 'The draft now matches the published version.' };

    if (kind === 'about') {
      const result = await run(() => api.admin.discardAbout(), messages);
      if (result) {
        setDocuments((current) => (current ? { ...current, about: result.document } : current));
        setAbout(result.document.draft);
        setAboutDirty(false);
      }
      return;
    }

    const result = await run(() => api.admin.discardContact(), messages);
    if (result) {
      setDocuments((current) => (current ? { ...current, contact: result.document } : current));
      setContact(result.document.draft);
      setContactDirty(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    const result = await run(() => api.admin.uploadAvatar(file), {
      ok: 'Portrait uploaded',
      okBody: 'Publish the About draft to show it on the site.',
    });
    if (result) {
      setDocuments((current) => (current ? { ...current, about: result.document } : current));
      setAbout(result.document.draft);
      setAboutDirty(true);
      setAvatarToken(Date.now());
    }
  };

  const removeAvatar = async () => {
    const result = await run(() => api.admin.deleteAvatar(), { ok: 'Portrait removed' });
    if (result) {
      setDocuments((current) => (current ? { ...current, about: result.document } : current));
      setAbout(result.document.draft);
      setAboutDirty(true);
      setAvatarToken(Date.now());
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

  const dirty = tab === 'about' ? aboutDirty : contactDirty;
  const publishedAt = tab === 'about' ? documents?.about.publishedAt : documents?.contact.publishedAt;

  return (
    <div className="stack stack--lg admin-page">
      <header className="admin-page__head">
        <div>
          <p className="section__eyebrow">Site content</p>
          <h1 className="section__title">About page &amp; contact details</h1>
          <p className="section__lead">
            Your words, stored in the database. Publish and the public pages change straight away — nothing here needs a
            rebuild or a deploy.
          </p>
        </div>
        <div className="cluster">
          <Link className="btn btn--ghost" to="/about?preview=1" target="_blank" rel="noreferrer">
            <IconEye size={16} />
            Preview about draft
          </Link>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setConfirmDiscard(tab)}
            disabled={!dirty || busy}
          >
            <IconRestart size={16} />
            Cancel changes
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => void save()} disabled={busy || !dirty}>
            Save draft
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void publish()} disabled={busy}>
            Publish changes
          </button>
        </div>
      </header>

      {dirty ? (
        <div className="callout callout--info" role="status">
          <span className="callout__title">Unpublished changes</span>
          <span>
            {publishedAt
              ? `The live site is still showing the version published on ${new Date(publishedAt).toLocaleString()}.`
              : 'The live site is still showing the shipped defaults.'}{' '}
            Save the draft to keep it, or publish to make it public.
          </span>
        </div>
      ) : null}

      <div className="tabs" role="tablist" aria-label="Content documents">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'about'}
          className={`tab${tab === 'about' ? ' is-active' : ''}`}
          onClick={() => setTab('about')}
        >
          About page {aboutDirty ? <span className="tab__dot" aria-label="unsaved changes" /> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'contact'}
          className={`tab${tab === 'contact' ? ' is-active' : ''}`}
          onClick={() => setTab('contact')}
        >
          Contact details {contactDirty ? <span className="tab__dot" aria-label="unsaved changes" /> : null}
        </button>
      </div>

      {tab === 'about' ? (
        <AboutEditor
          about={about}
          onChange={editAbout}
          avatarInput={avatarInput}
          avatarToken={avatarToken}
          onUpload={uploadAvatar}
          onRemove={removeAvatar}
          busy={busy}
        />
      ) : (
        <ContactEditor contact={contact} onChange={editContact} />
      )}

      <ConfirmDialog
        open={confirmDiscard !== null}
        title="Cancel your unpublished changes?"
        body={<p>The draft is replaced by the last published version. This cannot be undone.</p>}
        confirmLabel="Discard changes"
        busy={busy}
        onConfirm={discard}
        onCancel={() => setConfirmDiscard(null)}
      />

      {!busy && dirty ? (
        <p className="field__hint" role="status">
          Remember to save or publish before leaving this page.
        </p>
      ) : null}

      <p className="field__hint">
        Looking for your sign-in address or password? Those live in <Link to="/admin/security">Account security</Link> and
        are deliberately not editable here.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- about doc */

function AboutEditor({
  about,
  onChange,
  avatarInput,
  avatarToken,
  onUpload,
  onRemove,
  busy,
}: {
  about: AboutContent;
  onChange: (patch: Partial<AboutContent>) => void;
  avatarInput: React.RefObject<HTMLInputElement | null>;
  avatarToken: number;
  onUpload: (file: File) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const remaining = ABOUT_SECTIONS.filter((id) => !about.sections.includes(id));

  const moveSection = (index: number, to: number) => {
    if (to < 0 || to >= about.sections.length) return;
    const next = [...about.sections];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    onChange({ sections: next });
  };

  return (
    <div className="stack stack--lg">
      <section className="panel stack stack--md" aria-labelledby="about-copy-heading">
        <h2 className="section__title" id="about-copy-heading" style={{ fontSize: 'var(--step-2)' }}>
          Headline and introduction
        </h2>

        <label className="field field--inline">
          <input
            type="checkbox"
            checked={about.visible}
            onChange={(event) => onChange({ visible: event.target.checked })}
          />
          <span>Show the About page publicly</span>
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field__label">Eyebrow (small label above the heading)</span>
            <input
              className="input"
              value={about.eyebrow}
              maxLength={CONTENT_LIMITS.eyebrow}
              onChange={(event) => onChange({ eyebrow: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field__label">Heading</span>
            <input
              className="input"
              value={about.heading}
              maxLength={CONTENT_LIMITS.heading}
              onChange={(event) => onChange({ heading: event.target.value })}
            />
          </label>
        </div>

        <label className="field">
          <span className="field__label">Headline</span>
          <input
            className="input"
            value={about.headline}
            maxLength={CONTENT_LIMITS.headline}
            onChange={(event) => onChange({ headline: event.target.value })}
          />
        </label>

        <label className="field">
          <span className="field__label">Tagline</span>
          <textarea
            className="input input--textarea"
            rows={2}
            value={about.tagline}
            maxLength={CONTENT_LIMITS.tagline}
            onChange={(event) => onChange({ tagline: event.target.value })}
          />
        </label>

        <label className="field">
          <span className="field__label">Introductory paragraph</span>
          <textarea
            className="input input--textarea"
            rows={4}
            value={about.intro}
            maxLength={CONTENT_LIMITS.intro}
            onChange={(event) => onChange({ intro: event.target.value })}
          />
        </label>

        <p className="field__hint">
          Formatting is limited on purpose: <code>**bold**</code>, <code>*italic*</code> and{' '}
          <code>[label](https://link)</code>. Anything else is treated as plain text, and HTML tags are stripped, so nothing can inject a script.
        </p>
      </section>

      <section className="panel stack stack--md" aria-labelledby="about-avatar-heading">
        <h2 className="section__title" id="about-avatar-heading" style={{ fontSize: 'var(--step-2)' }}>
          Portrait
        </h2>
        <div className="avatar-field">
          <div className="avatar-field__preview">
            {about.avatarKey ? (
              <img src={`/api/media/content/avatar?preview=1&t=${avatarToken}`} alt="" width={220} height={220} />
            ) : (
              <span className="dropzone__empty">
                <IconImage size={22} />
                No portrait
              </span>
            )}
          </div>
          <div className="stack stack--sm">
            <input
              ref={avatarInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className="visually-hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(file);
                event.target.value = '';
              }}
            />
            <div className="cluster">
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => avatarInput.current?.click()} disabled={busy}>
                <IconArrowUp size={16} />
                {about.avatarKey ? 'Replace portrait' : 'Upload portrait'}
              </button>
              {about.avatarKey ? (
                <button type="button" className="btn btn--ghost btn--sm" onClick={onRemove} disabled={busy}>
                  <IconTrash size={16} />
                  Remove
                </button>
              ) : null}
            </div>
            <p className="field__hint">PNG, JPEG, WebP, GIF or AVIF, up to 8 MB. Square images look best.</p>
            <label className="field">
              <span className="field__label">Alternative text</span>
              <input
                className="input"
                value={about.avatarAlt}
                maxLength={CONTENT_LIMITS.entryDetail}
                onChange={(event) => onChange({ avatarAlt: event.target.value })}
                placeholder="Describe the image for screen readers"
              />
            </label>
          </div>
        </div>
      </section>

      <section className="panel stack stack--lg" aria-labelledby="about-lists-heading">
        <div>
          <h2 className="section__title" id="about-lists-heading" style={{ fontSize: 'var(--step-2)' }}>
            Lists and blocks
          </h2>
          <p style={{ color: 'var(--text-muted)' }}>
            Add, remove and reorder anything here. Empty lists simply do not appear on the page.
          </p>
        </div>

        <StringList
          label="Biography paragraphs"
          hint="Each entry is one paragraph. Blank-line separation is not needed."
          items={about.bio}
          max={CONTENT_LIMITS.bioItems}
          maxLength={CONTENT_LIMITS.bioItem}
          addLabel="Add paragraph"
          onChange={(bio) => onChange({ bio })}
        />

        <StringList
          label="Skills and technologies"
          hint="Shown as chips under the biography."
          items={about.skills}
          max={CONTENT_LIMITS.skills}
          addLabel="Add skill"
          maxLength={CONTENT_LIMITS.itemText}
          onChange={(skills) => onChange({ skills })}
        />

        <StringList
          label="Interests"
          hint="Areas you work in or are curious about."
          items={about.interests}
          max={CONTENT_LIMITS.interests}
          addLabel="Add interest"
          maxLength={CONTENT_LIMITS.itemText}
          onChange={(interests) => onChange({ interests })}
        />

        <StringList
          label="Current focus"
          hint="What you are working on now."
          items={about.projects}
          max={CONTENT_LIMITS.projects}
          addLabel="Add item"
          maxLength={CONTENT_LIMITS.itemText}
          onChange={(projects) => onChange({ projects })}
        />

        <Repeatable
          label="How I build (principles)"
          hint="Short title plus a sentence or two."
          items={about.principles}
          max={CONTENT_LIMITS.principles}
          empty={() => ({ title: '', body: '' })}
          onChange={(principles) => onChange({ principles })}
          heading={(item, index) => item.title || `Principle ${index + 1}`}
          addLabel="Add principle"
          render={(item, update) => (
            <>
              <label className="field">
                <span className="field__label">Title</span>
                <input
                  className="input"
                  value={item.title}
                  maxLength={CONTENT_LIMITS.entryTitle}
                  onChange={(event) => update({ title: event.target.value })}
                />
              </label>
              <label className="field">
                <span className="field__label">Explanation</span>
                <textarea
                  className="input input--textarea"
                  rows={3}
                  value={item.body}
                  maxLength={CONTENT_LIMITS.bioItem}
                  onChange={(event) => update({ body: event.target.value })}
                />
              </label>
            </>
          )}
        />

        <Repeatable
          label="Milestones"
          hint="Optional. Nothing is invented for you — leave this empty and the block stays hidden."
          items={about.milestones}
          max={CONTENT_LIMITS.entries}
          empty={() => ({ title: '', detail: '', year: '' })}
          onChange={(milestones) => onChange({ milestones })}
          heading={(item, index) => item.title || `Milestone ${index + 1}`}
          addLabel="Add milestone"
          render={(item, update) => (
            <>
              <div className="field-row">
                <label className="field">
                  <span className="field__label">Title</span>
                  <input
                    className="input"
                    value={item.title}
                    maxLength={CONTENT_LIMITS.entryTitle}
                    onChange={(event) => update({ title: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field__label">Year (optional)</span>
                  <input
                    className="input"
                    value={item.year}
                    maxLength={20}
                    onChange={(event) => update({ year: event.target.value })}
                  />
                </label>
              </div>
              <label className="field">
                <span className="field__label">Detail</span>
                <textarea
                  className="input input--textarea"
                  rows={2}
                  value={item.detail}
                  maxLength={CONTENT_LIMITS.entryDetail}
                  onChange={(event) => update({ detail: event.target.value })}
                />
              </label>
            </>
          )}
        />

        <Repeatable
          label="Education and professional"
          hint="Optional. Only what you actually want to publish."
          items={about.credentials}
          max={CONTENT_LIMITS.entries}
          empty={() => ({ title: '', detail: '', year: '' })}
          onChange={(credentials) => onChange({ credentials })}
          heading={(item, index) => item.title || `Entry ${index + 1}`}
          addLabel="Add entry"
          render={(item, update) => (
            <>
              <div className="field-row">
                <label className="field">
                  <span className="field__label">Title or course</span>
                  <input
                    className="input"
                    value={item.title}
                    maxLength={CONTENT_LIMITS.entryTitle}
                    onChange={(event) => update({ title: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field__label">Year (optional)</span>
                  <input
                    className="input"
                    value={item.year}
                    maxLength={20}
                    onChange={(event) => update({ year: event.target.value })}
                  />
                </label>
              </div>
              <label className="field">
                <span className="field__label">Institution or detail</span>
                <input
                  className="input"
                  value={item.detail}
                  maxLength={CONTENT_LIMITS.entryDetail}
                  onChange={(event) => update({ detail: event.target.value })}
                />
              </label>
            </>
          )}
        />

        <Repeatable
          label="Profiles and links"
          hint="Shown on the About and contact pages. Leave empty to hide the block."
          items={about.links}
          max={CONTENT_LIMITS.links}
          empty={() => ({ label: '', url: '', icon: 'link' as LinkIcon })}
          onChange={(links) => onChange({ links })}
          heading={(item, index) => item.label || `Link ${index + 1}`}
          addLabel="Add link"
          render={(item, update) => (
            <>
              <div className="field-row">
                <label className="field">
                  <span className="field__label">Label</span>
                  <input
                    className="input"
                    value={item.label}
                    maxLength={CONTENT_LIMITS.linkLabel}
                    onChange={(event) => update({ label: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field__label">Icon</span>
                  <select
                    className="input"
                    value={item.icon}
                    onChange={(event) => update({ icon: event.target.value as LinkIcon })}
                  >
                    {LINK_ICONS.map((icon) => (
                      <option value={icon} key={icon}>
                        {icon}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field">
                <span className="field__label">URL</span>
                <input
                  className="input"
                  value={item.url}
                  placeholder="https://example.com/you"
                  onChange={(event) => update({ url: event.target.value })}
                />
              </label>
            </>
          )}
        />
      </section>

      <section className="panel stack stack--md" aria-labelledby="about-cta-heading">
        <h2 className="section__title" id="about-cta-heading" style={{ fontSize: 'var(--step-2)' }}>
          Call to action
        </h2>
        <div className="field-row">
          <label className="field">
            <span className="field__label">Button label</span>
            <input
              className="input"
              value={about.cta.label}
              maxLength={CONTENT_LIMITS.ctaLabel}
              onChange={(event) => onChange({ cta: { ...about.cta, label: event.target.value } })}
            />
          </label>
          <label className="field">
            <span className="field__label">Destination</span>
            <input
              className="input"
              value={about.cta.url}
              maxLength={300}
              placeholder="/games or https://…"
              onChange={(event) => onChange({ cta: { ...about.cta, url: event.target.value } })}
            />
          </label>
        </div>
        <p className="field__hint">Leave both empty to hide the button.</p>
      </section>

      <section className="panel stack stack--md" aria-labelledby="about-order-heading">
        <div>
          <h2 className="section__title" id="about-order-heading" style={{ fontSize: 'var(--step-2)' }}>
            Section order &amp; visibility
          </h2>
          <p style={{ color: 'var(--text-muted)' }}>
            Blocks are rendered top to bottom in this order, and a block without any content hides itself anyway.
          </p>
        </div>

        <ul className="order-list">
          {about.sections.map((id, index) => (
            <li className="order-list__item" key={id}>
              <span className="order-list__name">{ABOUT_SECTION_LABELS[id]}</span>
              <div className="repeatable__item-actions">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => moveSection(index, index - 1)}
                  disabled={index === 0}
                  aria-label={`Move ${ABOUT_SECTION_LABELS[id]} up`}
                >
                  <IconArrowUp size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => moveSection(index, index + 1)}
                  disabled={index === about.sections.length - 1}
                  aria-label={`Move ${ABOUT_SECTION_LABELS[id]} down`}
                >
                  <IconArrowDown size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--danger"
                  onClick={() => onChange({ sections: about.sections.filter((entry) => entry !== id) })}
                  aria-label={`Hide ${ABOUT_SECTION_LABELS[id]}`}
                >
                  <IconTrash size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>

        {remaining.length > 0 ? (
          <div className="cluster">
            <span className="field__label">Add a block back:</span>
            {remaining.map((id) => (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                key={id}
                onClick={() => onChange({ sections: [...about.sections, id] as AboutSectionId[] })}
              >
                {ABOUT_SECTION_LABELS[id]}
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------- contact doc */

function ContactEditor({
  contact,
  onChange,
}: {
  contact: ContactContent;
  onChange: (patch: Partial<ContactContent>) => void;
}) {
  return (
    <div className="stack stack--lg">
      <section className="panel stack stack--md" aria-labelledby="contact-heading">
        <div>
          <h2 className="section__title" id="contact-heading" style={{ fontSize: 'var(--step-2)' }}>
            Public contact details
          </h2>
          <p style={{ color: 'var(--text-muted)' }}>
            This address is public: it is on the contact page, in the footer, in every <code>mailto:</code> link and on the
            About page.
          </p>
        </div>

        <label className="field field--inline">
          <input
            type="checkbox"
            checked={contact.visible}
            onChange={(event) => onChange({ visible: event.target.checked })}
          />
          <span>Show the contact section publicly</span>
        </label>

        <label className="field">
          <span className="field__label">Public contact address</span>
          <input
            className="input"
            type="email"
            value={contact.email}
            autoComplete="off"
            placeholder="hello@your-domain.example"
            onChange={(event) => onChange({ email: event.target.value })}
          />
        </label>

        <div className="callout callout--info">
          <span className="callout__title">
            <IconShield size={14} /> Keep this separate from your sign-in address
          </span>
          <span>
            Your private authentication address is a different setting in{' '}
            <Link to="/admin/security">Account security</Link>. The server refuses to publish that address here, so the
            two can never collapse into one, and changing either never changes the other.
          </span>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field__label">Heading</span>
            <input
              className="input"
              value={contact.heading}
              maxLength={CONTENT_LIMITS.heading}
              onChange={(event) => onChange({ heading: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field__label">Small note under the email card</span>
            <input
              className="input"
              value={contact.responseNote}
              maxLength={CONTENT_LIMITS.tagline}
              onChange={(event) => onChange({ responseNote: event.target.value })}
            />
          </label>
        </div>

        <label className="field">
          <span className="field__label">Introduction</span>
          <textarea
            className="input input--textarea"
            rows={3}
            value={contact.intro}
            maxLength={CONTENT_LIMITS.intro}
            onChange={(event) => onChange({ intro: event.target.value })}
          />
        </label>
      </section>

      <section className="panel stack stack--md">
        <Repeatable
          label="Reasons to write"
          hint="The list beside the email card."
          items={contact.reasons}
          max={8}
          empty={() => ({ title: '', body: '' })}
          onChange={(reasons) => onChange({ reasons })}
          heading={(item, index) => item.title || `Reason ${index + 1}`}
          addLabel="Add reason"
          render={(item, update) => (
            <>
              <label className="field">
                <span className="field__label">Title</span>
                <input
                  className="input"
                  value={item.title}
                  maxLength={CONTENT_LIMITS.entryTitle}
                  onChange={(event) => update({ title: event.target.value })}
                />
              </label>
              <label className="field">
                <span className="field__label">Description</span>
                <textarea
                  className="input input--textarea"
                  rows={2}
                  value={item.body}
                  maxLength={CONTENT_LIMITS.entryDetail}
                  onChange={(event) => update({ body: event.target.value })}
                />
              </label>
            </>
          )}
        />
      </section>
    </div>
  );
}
