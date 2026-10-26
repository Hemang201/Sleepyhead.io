import { useState } from 'react';
import { Link } from 'react-router-dom';

import type { AdminGame } from '../../shared/catalogue';
import { parseItchEmbedUrl, parseItchProjectUrl } from '../../shared/itch';
import { IconExternal, IconPlay, IconRestart } from '../Icons';

/**
 * Step B — the itch.io player.
 *
 * Nothing is uploaded here: the game lives on itch.io, and this panel is where
 * the owner checks that the two stored addresses really do produce a player
 * before publishing. The preview is opt-in (no request to itch.io until the
 * button is pressed), clearly labelled as a preview, and never changes the
 * publication state of the game.
 *
 * A preview that never loads cannot be detected from a cross-origin frame, so
 * this panel does not promise that the game works: it shows what the site will
 * embed and offers the direct itch.io link to check alongside it.
 */
export function ItchManager({ game }: { game: AdminGame }) {
  const [previewing, setPreviewing] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  const project = parseItchProjectUrl(game.itch.projectUrl);
  const embed = parseItchEmbedUrl(game.itch.embedUrl);
  const ready = project.ok && embed.ok;

  return (
    <section className="panel stack stack--md" aria-labelledby="itch-heading">
      <div>
        <h2 className="section__title" id="itch-heading" style={{ fontSize: 'var(--step-2)' }}>
          Step B — itch.io player
        </h2>
        <p style={{ color: 'var(--text-muted)' }}>
          The playable game is hosted by itch.io and embedded on your game page. Cover art and screenshots stay on this
          site — only the game itself is theirs.
        </p>
      </div>

      <ul className="checklist">
        <li data-ok={project.ok}>
          {project.ok ? `itch.io page: ${project.value.url.replace('https://', '')}` : 'No valid itch.io page address saved'}
        </li>
        <li data-ok={embed.ok}>
          {embed.ok ? `Playable embed id ${embed.value.id}` : 'No valid itch.io embed address saved'}
        </li>
        <li data-ok={Boolean(game.artwork.thumbnail ?? game.artwork.banner)}>
          {game.artwork.thumbnail ?? game.artwork.banner
            ? 'Cover art on this site'
            : 'Cover art is still missing (Step C)'}
        </li>
      </ul>

      {!project.ok || !embed.ok ? (
        <div className="callout callout--warn">
          <span className="callout__title">The player is not connected yet</span>
          <span>
            Add both addresses in{' '}
            <Link to={`/admin/games/${game.id}?step=info`}>Step A</Link>. The game URL and the embed URL are different
            things: itch.io generates the embed address for the uploaded HTML5 file.
          </span>
        </div>
      ) : null}

      <div className="stack stack--sm">
        <span className="field__label">How to get the embed address</span>
        <ol className="itch-steps">
          <li>Open the game on itch.io and choose Edit game → Embed.</li>
          <li>Select the uploaded HTML5 build, then copy the iframe src that starts with https://itch.io/embed-upload/.</li>
          <li>Paste it into the Embed URL field. The normal project address will not play inside a frame.</li>
        </ol>
        <p className="field__hint">
          The game must be published (or at least accessible) on itch.io, with its HTML5 file available to the public.
          An unlisted itch.io page is still reachable by anyone who has its address.
        </p>
      </div>

      {ready ? (
        <div className="stack stack--sm">
          <div className="cluster">
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setPreviewing(true)}>
              <IconPlay size={16} />
              {previewing ? 'Reload preview' : 'Preview the player'}
            </button>
            {previewing ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setPreviewKey((key) => key + 1)}
              >
                <IconRestart size={16} />
                Reload
              </button>
            ) : null}
            <a
              className="btn btn--ghost btn--sm"
              href={project.value.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open on itch.io
              <IconExternal size={14} />
            </a>
          </div>

          {previewing ? (
            <div className="itch-preview">
              <iframe
                key={previewKey}
                src={game.itch.embedUrl ?? undefined}
                title={`${game.title} — itch.io player preview`}
                className="itch-preview__frame"
                // The frame is a different origin, so it cannot read this
                // dashboard. The sandbox only narrows what it can do on its own
                // page; itch.io's player needs scripts, storage and pointer lock.
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-pointer-lock allow-downloads allow-modals"
                allow="fullscreen; gamepad; autoplay"
                referrerPolicy="strict-origin-when-cross-origin"
                loading="lazy"
              />
              <p className="field__hint">
                This is a preview only — the game is still {game.status === 'published' ? 'published' : 'not published'}.
                A blank or apologetic frame here usually means the itch.io project is private, the file is not HTML5, or
                embedding is disabled for it.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="field__hint">
        Draft games stay private whatever is saved here. Only a published game with a saved embed address appears in the
        library, and the public player reads the same values this preview uses.
      </p>
    </section>
  );
}
