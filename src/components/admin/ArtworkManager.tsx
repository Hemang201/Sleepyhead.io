import { useRef, useState, type DragEvent } from 'react';

import type { AdminGame } from '../../shared/catalogue';
import { formatBytes, sniffImage } from '../../shared/media-files';
import { api } from '../../lib/api';
import { useAdmin, useAdminAction } from '../../lib/admin';
import { ConfirmDialog } from './ConfirmDialog';
import { IconImage, IconRestart, IconTrash, IconArrowUp } from '../Icons';

const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;

/**
 * Thumbnail, banner and screenshots.
 *
 * Images are checked in the browser (type by magic bytes, size) so the owner
 * gets an instant answer, and the server checks them again because it never
 * trusts an upload.
 */
export function ArtworkManager({ game, onUpdated }: { game: AdminGame; onUpdated: (game: AdminGame) => void }) {
  const { notify } = useAdmin();
  const { run, busy } = useAdminAction();
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{ kind: 'thumbnail' | 'banner' } | null>(null);
  const [removingScreenshot, setRemovingScreenshot] = useState<number | null>(null);
  const thumbnailInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const screenshotInput = useRef<HTMLInputElement>(null);

  const check = (file: File): string | null => {
    if (file.size > MAX_ARTWORK_BYTES) return `${file.name} is ${formatBytes(file.size)} — the limit is 8 MB.`;
    return null;
  };

  const handleFile = async (kind: 'thumbnail' | 'banner' | 'screenshot', file: File) => {
    const problem = check(file);
    if (problem) {
      notify({ tone: 'error', title: 'That image cannot be used', body: problem });
      return;
    }

    // Reject non-images before spending an upload on them.
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!sniffImage(head)) {
      notify({
        tone: 'error',
        title: 'Not a supported image',
        body: 'PNG, JPEG, WebP, GIF and AVIF are accepted. (SVG is deliberately refused: it can carry scripts.)',
      });
      return;
    }

    const result = await run(
      () => (kind === 'screenshot' ? api.admin.addScreenshot(game.id, file) : api.admin.uploadArtwork(game.id, kind, file)),
      { ok: kind === 'screenshot' ? 'Screenshot added' : `${kind === 'thumbnail' ? 'Thumbnail' : 'Banner'} updated` },
    );
    if (result) onUpdated(result.game);
  };

  const onDrop = (kind: string, event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragTarget(null);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(kind as 'thumbnail' | 'banner' | 'screenshot', file);
  };

  const removeArtwork = async () => {
    if (!pendingRemove) return;
    const kind = pendingRemove.kind;
    const result = await run(() => api.admin.deleteArtwork(game.id, kind), { ok: `${kind === 'thumbnail' ? 'Thumbnail' : 'Banner'} removed` });
    setPendingRemove(null);
    if (result) onUpdated(result.game);
  };

  const removeScreenshot = async () => {
    if (removingScreenshot === null) return;
    const index = removingScreenshot;
    const result = await run(() => api.admin.deleteScreenshot(game.id, index), { ok: 'Screenshot removed' });
    setRemovingScreenshot(null);
    if (result) onUpdated(result.game);
  };

  const slots: { kind: 'thumbnail' | 'banner'; label: string; hint: string; url: string | null; input: React.RefObject<HTMLInputElement | null> }[] = [
    {
      kind: 'thumbnail',
      label: 'Thumbnail',
      hint: 'Shown on cards and in the library. 16:10 suits the layout best.',
      url: game.artwork.thumbnail,
      input: thumbnailInput,
    },
    {
      kind: 'banner',
      label: 'Banner / cover',
      hint: 'Used at the top of the game page and for link previews.',
      url: game.artwork.banner,
      input: bannerInput,
    },
  ];

  return (
    <section className="panel stack stack--md" aria-labelledby="artwork-heading">
      <div>
        <h2 className="section__title" id="artwork-heading" style={{ fontSize: 'var(--step-2)' }}>
          Step C — Artwork
        </h2>
        <p style={{ color: 'var(--text-muted)' }}>
          Optional, but a game without any artwork shows the site&rsquo;s placeholder illustration instead.
        </p>
      </div>

      <div className="artwork-grid">
        {slots.map((slot) => (
          <div key={slot.kind} className="artwork-slot">
            <span className="field__label">{slot.label}</span>
            <label
              className={`dropzone${dragTarget === slot.kind ? ' dropzone--active' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragTarget(slot.kind);
              }}
              onDragLeave={() => setDragTarget(null)}
              onDrop={(event) => onDrop(slot.kind, event)}
            >
              <input
                ref={slot.input}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                className="visually-hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(slot.kind, file);
                  event.target.value = '';
                }}
              />
              {slot.url ? (
                <img src={slot.url} alt={`${slot.label} preview`} width={640} height={400} />
              ) : (
                <span className="dropzone__empty">
                  <IconImage size={22} />
                  Drop an image here or click to choose
                </span>
              )}
            </label>
            <p className="field__hint">{slot.hint}</p>
            <div className="cluster">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => slot.input.current?.click()}
                disabled={busy}
              >
                {slot.url ? <IconRestart size={16} /> : <IconArrowUp size={16} />}
                {slot.url ? 'Replace' : 'Upload'}
              </button>
              {slot.url ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setPendingRemove({ kind: slot.kind })}
                  disabled={busy}
                >
                  <IconTrash size={16} />
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="stack stack--sm">
        <span className="field__label">Screenshots ({game.artwork.screenshots.length}/12)</span>
        <div className="artwork-shots">
          {game.artwork.screenshots.map((shot, index) => (
            <figure key={shot.url} className="artwork-shot">
              <img src={shot.url} alt={shot.alt} width={1280} height={720} />
              <button
                type="button"
                className="artwork-shot__remove"
                onClick={() => setRemovingScreenshot(index)}
                aria-label={`Remove screenshot ${index + 1}`}
                disabled={busy}
              >
                <IconTrash size={14} />
              </button>
            </figure>
          ))}

          {game.artwork.screenshots.length < 12 ? (
            <label
              className={`dropzone dropzone--small${dragTarget === 'screenshot' ? ' dropzone--active' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragTarget('screenshot');
              }}
              onDragLeave={() => setDragTarget(null)}
              onDrop={(event) => onDrop('screenshot', event)}
            >
              <input
                ref={screenshotInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                className="visually-hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile('screenshot', file);
                  event.target.value = '';
                }}
              />
              <span className="dropzone__empty">
                <IconArrowUp size={18} />
                Add screenshot
              </span>
            </label>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={pendingRemove !== null}
        title={`Remove the ${pendingRemove?.kind ?? 'image'}?`}
        body={<p>The file is deleted from storage. You can always upload a new one.</p>}
        confirmLabel="Remove image"
        busy={busy}
        onConfirm={removeArtwork}
        onCancel={() => setPendingRemove(null)}
      />

      <ConfirmDialog
        open={removingScreenshot !== null}
        title="Remove this screenshot?"
        body={<p>Screenshot {removingScreenshot !== null ? removingScreenshot + 1 : ''} is deleted from storage.</p>}
        confirmLabel="Remove screenshot"
        busy={busy}
        onConfirm={removeScreenshot}
        onCancel={() => setRemovingScreenshot(null)}
      />
    </section>
  );
}
