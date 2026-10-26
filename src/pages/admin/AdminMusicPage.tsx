import { useEffect, useRef, useState } from 'react';

import { api, ApiError, type AdminMusicResponse } from '../../lib/api';
import { useAdminAction } from '../../lib/admin';
import { ConfirmDialog } from '../../components/admin/ConfirmDialog';
import { IconAlert, IconCheck, IconSound, IconTrash } from '../../components/Icons';
import { MUSIC_LIMITS } from '../../shared/music';

/**
 * Background music.
 *
 * The document (title, enabled flag, storage key) is stored in D1 and applies
 * immediately — there is no publish step, because a background track is a
 * setting rather than page content. The audio bytes live in R2, so replacing a
 * file does not grow the database and the storage key never reaches a visitor.
 *
 * New page loads read the published configuration; an open page keeps the track
 * it started with, which is the graceful update the brief asks for without a
 * realtime channel. Every action here is authorised again on the server.
 */

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminMusicPage() {
  const { run, busy } = useAdminAction();
  const [data, setData] = useState<AdminMusicResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await api.admin.music();
        if (cancelled) return;
        setData(response);
        setTitle(response.music.title);
        setEnabled(response.music.enabled);
        setStatus('ready');
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'The music settings could not load.');
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const apply = (response: AdminMusicResponse) => {
    setData(response);
    setTitle(response.music.title);
    setEnabled(response.music.enabled);
  };

  const dirty = data ? title.trim() !== data.music.title || enabled !== data.music.enabled : false;
  const none = data?.music.source === 'none';
  const missing = Boolean(data?.music.source === 'uploaded' && !data.available);

  const save = async () => {
    const result = await run(() => api.admin.saveMusic({ title: title.trim(), enabled }), {
      ok: 'Music settings saved',
      okBody: 'New page loads on the public site use this configuration.',
    });
    if (result) apply(result);
  };

  const upload = async () => {
    if (!file) return;
    const result = await run(() => api.admin.uploadMusic(file, title.trim() || 'Ambient theme'), {
      ok: 'Track uploaded and enabled',
      okBody: 'The previous file was removed from storage. Preview it here, then reload the site to hear it.',
      failure: 'The track could not be uploaded',
    });
    if (!result) return;
    apply(result);
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const remove = async () => {
    const result = await run(() => api.admin.removeMusic(), {
      ok: 'Background music removed',
      okBody: 'The audio object was deleted and the public player is now silent.',
    });
    setRemoveOpen(false);
    if (result) apply(result);
  };

  if (status === 'error') {
    return (
      <div className="admin-page">
        <div className="callout callout--warn">
          <span className="callout__title">The music settings could not load</span>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="stack stack--lg admin-page">
      <header className="admin-page__head">
        <div>
          <p className="section__eyebrow">Background music</p>
          <h1 className="section__title">The ambient track</h1>
          <p className="section__lead">
            One quiet loop for the whole site. It is never played until a visitor asks for it, and their volume is stored
            on their device. Uploads go to object storage; only the reference and metadata are kept in the database.
          </p>
        </div>
        <div className="cluster">
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy || !dirty}>
            {dirty ? 'Save music settings' : 'Saved'}
          </button>
        </div>
      </header>

      {status === 'loading' || !data ? (
        <p className="loading-row" role="status">
          Loading the music configuration…
        </p>
      ) : (
        <div className="split split--about">
          <section className="panel stack stack--md" aria-labelledby="music-settings-heading">
            <h2 className="section__title" id="music-settings-heading" style={{ fontSize: 'var(--step-2)' }}>
              Settings
            </h2>

            {missing ? (
              <div className="callout callout--warn" role="alert">
                <span className="callout__title">
                  <IconAlert size={16} /> The configured file is missing
                </span>
                <span>
                  The database points at an audio object that is no longer in storage, so the public site is silent. Upload
                  the track again (or remove it) to clear this state.
                </span>
              </div>
            ) : null}

            {none ? (
              <div className="callout callout--info" role="status">
                <span className="callout__title">No track configured</span>
                <span>Background music is off and the public control is hidden. Upload a file to bring it back.</span>
              </div>
            ) : null}

            <label className="field">
              <span className="field__label">Track title</span>
              <input
                type="text"
                value={title}
                maxLength={MUSIC_LIMITS.maxTitle}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Ambient theme"
              />
              <span className="field__hint">Shown in the dashboard only. The public control stays icon-sized.</span>
            </label>

            <label className="field field--inline">
              <input
                type="checkbox"
                checked={enabled}
                disabled={none}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              <span>Play background music on the public site</span>
            </label>
            <p className="field__hint">
              Off removes the control from the header and the mobile menu. Visitors who had it on are not interrupted;
              their browser simply finds nothing to play on the next load.
            </p>

            <div className="field">
              <span className="field__label">Audio file</span>
              <input
                ref={fileInput}
                type="file"
                accept=".mp3,.ogg,.wav,.m4a,.flac,audio/*"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <span className="field__hint">
                MP3, OGG, WAV, M4A or FLAC · up to {Math.round(MUSIC_LIMITS.maxBytes / (1024 * 1024))} MB. The format is
                verified from the file itself, not its extension. Uploading replaces the current track and enables it.
              </span>
              <div className="cluster">
                <button type="button" className="btn btn--secondary" onClick={() => void upload()} disabled={busy || !file}>
                  {data.music.source === 'none' ? 'Upload track' : 'Replace track'}
                </button>
                {file ? (
                  <span className="field__hint" role="status">
                    {file.name} · {formatBytes(file.size)}
                  </span>
                ) : null}
              </div>
            </div>

            <dl className="stack stack--sm">
              <div className="cluster" style={{ justifyContent: 'space-between' }}>
                <dt className="field__label">Source</dt>
                <dd>
                  {data.music.source === 'uploaded' ? 'Uploaded file' : data.music.source === 'bundled' ? 'Bundled track' : 'None'}
                </dd>
              </div>
              <div className="cluster" style={{ justifyContent: 'space-between' }}>
                <dt className="field__label">Stored size</dt>
                <dd>{formatBytes(data.music.byteSize)}</dd>
              </div>
              <div className="cluster" style={{ justifyContent: 'space-between' }}>
                <dt className="field__label">Last changed</dt>
                <dd>{data.music.updatedAt ? new Date(data.music.updatedAt).toLocaleString() : 'Never'}</dd>
              </div>
            </dl>

            {data.music.source !== 'none' ? (
              <button type="button" className="btn btn--danger" onClick={() => setRemoveOpen(true)} disabled={busy}>
                <IconTrash size={16} />
                Remove background music
              </button>
            ) : null}

            {dirty ? (
              <div className="callout callout--info" role="status">
                <span className="callout__title">Unsaved changes</span>
                <span>The public site is still using the saved settings.</span>
              </div>
            ) : (
              <p className="callout callout--success" role="status">
                <IconCheck size={16} /> Saved settings are live on the public site.
              </p>
            )}
          </section>

          <section className="stack stack--md" aria-labelledby="music-preview-heading">
            <h2 className="section__title" id="music-preview-heading" style={{ fontSize: 'var(--step-2)' }}>
              Preview
            </h2>
            {data.previewUrl ? (
              <div className="panel stack stack--sm">
                <p className="cluster" style={{ gap: 'var(--space-2)' }}>
                  <IconSound size={16} />
                  <strong>{data.music.title}</strong>
                </p>
                <audio controls preload="metadata" src={data.previewUrl} style={{ width: '100%' }} />
                <p className="field__hint">
                  Playback here is independent of the public player and of your visitor preferences. Disabled music can
                  still be previewed.
                </p>
              </div>
            ) : (
              <p className="callout callout--info">
                There is nothing to preview yet. Upload an audio file to hear it before publishing.
              </p>
            )}
            <p className="field__hint">
              Visitors hear the change on their next page load. An open page keeps playing the track it started with, so a
              replacement never cuts off mid-listen.
            </p>
          </section>
        </div>
      )}

      <ConfirmDialog
        open={removeOpen}
        title="Remove background music?"
        body="This deletes the uploaded audio object and turns the public music off. The action cannot be undone; you would need to upload a file again."
        confirmLabel="Remove track"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoveOpen(false)}
      />
    </div>
  );
}
