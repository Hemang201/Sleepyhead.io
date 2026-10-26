import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  ACCENTS,
  CATEGORIES,
  GAME_STATUSES,
  STATUS_META,
  slugify,
  validateGameInput,
  type AdminGame,
  type GameInput,
  type GameStatus,
} from '../../shared/catalogue';
import { api } from '../../lib/api';
import { useUnsavedChanges } from '../../lib/unsaved';
import { accentColor } from '../Badges';

/** Form state: every text field is a string (empty means "not set"). */
export interface GameDraft {
  title: string;
  slug: string;
  shortDescription: string;
  description: string;
  /** Canonical itch.io addresses, exactly as saved (empty when not set). */
  itchUrl: string;
  itchEmbedUrl: string;
  categories: string[];
  tags: string[];
  instructions: string;
  controls: { keyboard: string[]; mouse: string[]; touch: string[] };
  estimatedPlaytime: string;
  version: string;
  releaseDate: string;
  updateNotes: string;
  accent: GameDraftAccent;
  featured: boolean;
  listed: boolean;
  status: GameStatus;
}

type GameDraftAccent = AdminGame['accent'];

export function emptyDraft(): GameDraft {
  return {
    title: '',
    slug: '',
    shortDescription: '',
    description: '',
    itchUrl: '',
    itchEmbedUrl: '',
    categories: [],
    tags: [],
    instructions: '',
    controls: { keyboard: [], mouse: [], touch: [] },
    estimatedPlaytime: '',
    version: '',
    releaseDate: '',
    updateNotes: '',
    accent: 'cyan',
    featured: false,
    listed: false,
    status: 'draft',
  };
}

export function draftFromGame(game: AdminGame): GameDraft {
  return {
    title: game.title,
    slug: game.slug,
    shortDescription: game.shortDescription,
    description: game.description,
    itchUrl: game.itch.projectUrl ?? '',
    itchEmbedUrl: game.itch.embedUrl ?? '',
    categories: game.categories,
    tags: game.tags,
    instructions: game.instructions,
    controls: {
      keyboard: game.controls.keyboard ?? [],
      mouse: game.controls.mouse ?? [],
      touch: game.controls.touch ?? [],
    },
    estimatedPlaytime: game.estimatedPlaytime ?? '',
    version: game.version ?? '',
    releaseDate: game.releaseDate ?? '',
    updateNotes: game.updateNotes ?? '',
    accent: game.accent,
    featured: game.featured,
    listed: game.listed,
    status: game.status,
  };
}

/** Empty optional fields are stored as null rather than empty strings. */
export function payloadFromDraft(draft: GameDraft): GameInput {
  return {
    ...draft,
    slug: slugify(draft.slug || draft.title),
    itchUrl: draft.itchUrl.trim() || null,
    itchEmbedUrl: draft.itchEmbedUrl.trim() || null,
    estimatedPlaytime: draft.estimatedPlaytime.trim() || null,
    version: draft.version.trim() || null,
    releaseDate: draft.releaseDate.trim() || null,
    updateNotes: draft.updateNotes.trim() || null,
  };
}

const CONTROL_FIELDS: { key: 'keyboard' | 'mouse' | 'touch'; label: string; placeholder: string }[] = [
  { key: 'keyboard', label: 'Keyboard controls', placeholder: 'Arrow keys to move\nSpace to jump' },
  { key: 'mouse', label: 'Mouse controls', placeholder: 'Click to shoot\nDrag to place a piece' },
  { key: 'touch', label: 'Touch controls', placeholder: 'Tap to select\nDrag to move' },
];

/**
 * Step A (metadata) and the save/publish actions.
 *
 * Validation runs in the browser for instant feedback and again on the server,
 * which is the authority — the API rejects invalid metadata even if this form is
 * bypassed.
 */
export function GameForm({
  initial,
  mode,
  gameId,
  hasPlayer,
  hasArtwork,
  onSaved,
  onCreated,
  saveLabel,
}: {
  initial: GameDraft;
  mode: 'create' | 'edit';
  /** Required in edit mode: the game being edited. */
  gameId?: string;
  /** A saved, valid itch.io embed address: the game can actually be played. */
  hasPlayer: boolean;
  hasArtwork: boolean;
  onSaved?: (game: AdminGame) => void;
  onCreated?: (game: AdminGame) => void;
  saveLabel?: string;
}) {
  const [draft, setDraft] = useState<GameDraft>(initial);
  const [saving, setSaving] = useState(false);
  // A ref, not the state flag: two clicks in the same tick both see `saving`
  // as false, and in create mode that produced two games.
  const savingRef = useRef(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [slugTouched, setSlugTouched] = useState(mode === 'edit');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => setDraft(initial), [initial]);

  const errors = useMemo(() => ({ ...validateGameInput(payloadFromDraft(draft)), ...serverErrors }), [draft, serverErrors]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  // The shared hook, so the prompt behaves exactly like the content editors'
  // instead of being a third copy of the same listener.
  useUnsavedChanges(dirty, 'You have unsaved game edits. Leaving now discards them.');

  const update = <K extends keyof GameDraft>(key: K, value: GameDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setServerErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  };

  const submit = async (status?: GameStatus) => {
    if (savingRef.current) return null;
    savingRef.current = true;
    const next = status ? { ...draft, status } : draft;
    setDraft(next);
    setServerErrors({});
    setSaving(true);
    try {
      const payload = payloadFromDraft(next);
      if (mode === 'create') {
        const created = await api.admin.createGame(payload);
        setSavedAt(new Date().toISOString());
        onCreated?.(created.game);
        return created.game;
      }
      if (!gameId) throw new Error('This form needs a game id to save changes.');
      const updated = await api.admin.updateGame(gameId, payload);
      setSavedAt(new Date().toISOString());
      setDraft(draftFromGame(updated.game));
      onSaved?.(updated.game);
      return updated.game;
    } catch (caught) {
      const apiError = caught as { fields?: Record<string, string>; message?: string };
      setServerErrors(apiError.fields ?? { form: apiError.message ?? 'Could not save.' });
      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <form
      className="stack stack--lg"
      onSubmit={(event) => {
        event.preventDefault();
      }}
      noValidate
    >
      <div className="panel stack stack--md">
        <h2 className="section__title" style={{ fontSize: 'var(--step-2)' }}>
          Step A — Game information
        </h2>

        <div className="field-row">
          <div className="field">
            <label className="field__label" htmlFor="game-title">
              Title
            </label>
            <input
              id="game-title"
              className="input"
              value={draft.title}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((current) => ({
                  ...current,
                  title: value,
                  slug: slugTouched ? current.slug : slugify(value),
                }));
              }}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'game-title-error' : undefined}
              required
            />
            {errors.title ? (
              <p className="field__error" id="game-title-error">
                {errors.title}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="game-slug">
              URL slug
            </label>
            <div className="input-group">
              <span className="input-group__prefix">/games/</span>
              <input
                id="game-slug"
                className="input"
                value={draft.slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  update('slug', event.target.value);
                }}
                aria-invalid={Boolean(errors.slug)}
                required
              />
            </div>
            {errors.slug ? <p className="field__error">{errors.slug}</p> : <p className="field__hint">Lowercase words separated by hyphens. Must be unique.</p>}
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="game-short">
            Short description <span className="field__hint">(shown on cards)</span>
          </label>
          <input
            id="game-short"
            className="input"
            value={draft.shortDescription}
            maxLength={200}
            onChange={(event) => update('shortDescription', event.target.value)}
            aria-invalid={Boolean(errors.shortDescription)}
          />
          {errors.shortDescription ? <p className="field__error">{errors.shortDescription}</p> : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="game-description">
            Full description
          </label>
          <textarea
            id="game-description"
            className="input textarea"
            rows={6}
            value={draft.description}
            onChange={(event) => update('description', event.target.value)}
          />
          <p className="field__hint">Blank lines separate paragraphs on the game page.</p>
        </div>

        {/* ------------------------------------------------------ itch.io */}
        {/*
          The game itself is hosted on itch.io. These two addresses are the
          whole connection: the page address for the fallback link, and the
          iframe address itch generates for the uploaded build. The embed id
          belongs to that uploaded file, so it cannot be worked out from the
          project address — both are stored, and both are validated by the
          Worker as well as here.
        */}
        <div className="stack stack--md itch-fields">
          <div>
            <h3 className="section__title" style={{ fontSize: 'var(--step-1)' }}>
              itch.io game
            </h3>
            <p className="field__hint" style={{ marginTop: 'var(--space-2)' }}>
              Publish the game on itch.io first, then connect it here. Visitors stay on this site; the game runs in an
              iframe from itch.io.
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="game-itch-url">
              itch.io Game URL
            </label>
            <input
              id="game-itch-url"
              className="input"
              inputMode="url"
              autoComplete="url"
              placeholder="https://yourusername.itch.io/your-game"
              value={draft.itchUrl}
              onChange={(event) => update('itchUrl', event.target.value)}
              aria-invalid={Boolean(errors.itchUrl)}
              aria-describedby={errors.itchUrl ? 'game-itch-url-error' : 'game-itch-url-hint'}
            />
            {errors.itchUrl ? (
              <p className="field__error" id="game-itch-url-error">
                {errors.itchUrl}
              </p>
            ) : (
              <p className="field__hint" id="game-itch-url-hint">
                The public page of the game, e.g. https://yourusername.itch.io/your-game. Used for the “play on itch.io”
                link.
              </p>
            )}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="game-itch-embed">
              itch.io Embed URL
            </label>
            <input
              id="game-itch-embed"
              className="input"
              inputMode="url"
              autoComplete="url"
              placeholder="https://itch.io/embed-upload/1234567?color=202124"
              value={draft.itchEmbedUrl}
              onChange={(event) => update('itchEmbedUrl', event.target.value)}
              aria-invalid={Boolean(errors.itchEmbedUrl)}
              aria-describedby={errors.itchEmbedUrl ? 'game-itch-embed-error' : 'game-itch-embed-hint'}
            />
            {errors.itchEmbedUrl ? (
              <p className="field__error" id="game-itch-embed-error">
                {errors.itchEmbedUrl}
              </p>
            ) : (
              <p className="field__hint" id="game-itch-embed-hint">
                In itch.io, open the game → Edit game → Embed, choose the HTML5 upload and copy the iframe <code>src</code>{' '}
                (it starts with <code>itch.io/embed-upload/</code>). The normal project address will not work here.
              </p>
            )}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Genres</span>
          <div className="chip-row" role="group" aria-label="Genres">
            {CATEGORIES.map((category) => {
              const pressed = draft.categories.includes(category.id);
              return (
                <button
                  key={category.id}
                  type="button"
                  className="chip chip--selectable"
                  style={{ ['--chip-accent' as string]: accentColor(category.accent) }}
                  aria-pressed={pressed}
                  onClick={() =>
                    update(
                      'categories',
                      pressed
                        ? draft.categories.filter((entry) => entry !== category.id)
                        : [...draft.categories, category.id].slice(0, 6),
                    )
                  }
                >
                  {category.label}
                </button>
              );
            })}
          </div>
          {errors.categories ? <p className="field__error">{errors.categories}</p> : null}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="game-tags">
            Tags <span className="field__hint">(comma separated)</span>
          </label>
          <input
            id="game-tags"
            className="input"
            value={draft.tags.join(', ')}
            onChange={(event) =>
              update(
                'tags',
                event.target.value
                  .split(',')
                  .map((tag) => tag.trim().toLowerCase())
                  .filter((tag) => tag.length > 0)
                  .slice(0, 20),
              )
            }
            placeholder="roguelike, pixel art, short sessions"
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="game-instructions">
            How to play
          </label>
          <textarea
            id="game-instructions"
            className="input textarea"
            rows={4}
            value={draft.instructions}
            onChange={(event) => update('instructions', event.target.value)}
          />
        </div>

        <div className="field-row field-row--three">
          {CONTROL_FIELDS.map((field) => (
            <div className="field" key={field.key}>
              <label className="field__label" htmlFor={`game-${field.key}`}>
                {field.label} <span className="field__hint">(one per line)</span>
              </label>
              <textarea
                id={`game-${field.key}`}
                className="input textarea"
                rows={3}
                value={(draft.controls[field.key] ?? []).join('\n')}
                placeholder={field.placeholder}
                onChange={(event) =>
                  update('controls', {
                    ...draft.controls,
                    [field.key]: event.target.value
                      .split('\n')
                      .map((line) => line.trim())
                      .filter((line) => line.length > 0),
                  })
                }
              />
            </div>
          ))}
        </div>

        <div className="field-row field-row--three">
          <div className="field">
            <label className="field__label" htmlFor="game-playtime">
              Estimated playtime
            </label>
            <input
              id="game-playtime"
              className="input"
              value={draft.estimatedPlaytime}
              onChange={(event) => update('estimatedPlaytime', event.target.value)}
              placeholder="10–15 minutes"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="game-version">
              Version
            </label>
            <input
              id="game-version"
              className="input"
              value={draft.version}
              onChange={(event) => update('version', event.target.value)}
              placeholder="1.0.0"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="game-release">
              Release date <span className="field__hint">(optional)</span>
            </label>
            <input
              id="game-release"
              className="input"
              type="date"
              value={draft.releaseDate}
              onChange={(event) => update('releaseDate', event.target.value)}
            />
            {errors.releaseDate ? <p className="field__error">{errors.releaseDate}</p> : null}
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="game-notes">
            Update notes <span className="field__hint">(optional)</span>
          </label>
          <textarea
            id="game-notes"
            className="input textarea"
            rows={3}
            value={draft.updateNotes}
            onChange={(event) => update('updateNotes', event.target.value)}
          />
        </div>

        <div className="field-row field-row--three">
          <div className="field">
            <label className="field__label" htmlFor="game-accent">
              Accent colour
            </label>
            <select
              id="game-accent"
              className="select"
              value={draft.accent}
              onChange={(event) => update('accent', event.target.value as GameDraft['accent'])}
            >
              {ACCENTS.map((accent) => (
                <option key={accent} value={accent}>
                  {accent}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="game-status">
              Publication status
            </label>
            <select
              id="game-status"
              className="select"
              value={draft.status}
              onChange={(event) => update('status', event.target.value as GameStatus)}
            >
              {GAME_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_META[status].label}
                  {status === 'published' && !hasPlayer ? ' (needs the itch.io player)' : ''}
                </option>
              ))}
            </select>
            <p className="field__hint">{STATUS_META[draft.status].hint}</p>
          </div>

          <div className="field">
            <span className="field__label">Placement</span>
            <label className="checkbox">
              <input type="checkbox" checked={draft.featured} onChange={(event) => update('featured', event.target.checked)} />
              Feature on the home page
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.listed}
                disabled={!STATUS_META[draft.status].canBePublic || !STATUS_META[draft.status].optIn}
                onChange={(event) => update('listed', event.target.checked)}
              />
              List publicly while unpublished
            </label>
            {!STATUS_META[draft.status].canBePublic ? (
              <p className="field__hint">Drafts and archived games are never public.</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="panel stack stack--md">
        <h2 className="section__title" style={{ fontSize: 'var(--step-2)' }}>
          Step D — Publication
        </h2>

        <ul className="checklist">
          <li data-ok={draft.title.trim().length > 0 && !errors.title}>
            {draft.title.trim().length > 0 ? 'Title set' : 'Add a title'}
          </li>
          <li data-ok={Boolean(draft.slug) && !errors.slug}>Unique URL slug</li>
          <li data-ok={hasPlayer}>
            {hasPlayer ? 'itch.io player connected' : 'Connect the itch.io game and its embed address'}
          </li>
          <li data-ok={hasArtwork}>
            {hasArtwork ? 'Cover art uploaded' : 'Upload cover art (Step C) — required before publishing'}
          </li>
        </ul>

        {errors.form ? <p className="field__error">{errors.form}</p> : null}

        <div className="cluster">
          <button type="button" className="btn btn--secondary" disabled={saving || mode === 'edit'} onClick={() => void submit('draft')}>
            Save draft
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving || Object.keys(errors).length > 0}
            onClick={() => void submit(hasPlayer && hasArtwork ? 'published' : draft.status)}
          >
            {saveLabel ??
              (mode === 'create'
                ? 'Create draft and continue'
                : hasPlayer && hasArtwork
                  ? 'Save and publish'
                  : 'Save changes')}
          </button>
          {mode === 'edit' ? (
            <Link className="btn btn--ghost" to={`/games/${initial.slug}`} target="_blank" rel="noreferrer">
              View public page
            </Link>
          ) : null}
        </div>

        {dirty ? (
          <p className="field__hint" role="status">
            You have unsaved changes.
          </p>
        ) : savedAt ? (
          <p className="field__hint" role="status">
            Last saved {new Date(savedAt).toLocaleTimeString()}.
          </p>
        ) : null}
      </div>
    </form>
  );
}
