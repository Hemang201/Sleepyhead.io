import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { isPubliclyVisible, STATUS_META, type PublicGame } from '../shared/catalogue';
import { parseItchProjectUrl } from '../shared/itch';
import { recordPlayed } from '../lib/preferences';
import { IconAlert, IconCollapse, IconExpand, IconExternal, IconLock, IconPlay, IconRestart } from './Icons';
import { StatusBadge } from './Badges';
import { Spinner } from './Spinner';

type PlayerState = 'idle' | 'loading' | 'running';

/** The prefixed API older Safari shipped, kept so the button still works there. */
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/**
 * The play area for an itch.io game.
 *
 * The game is hosted and run by itch.io inside a cross-origin iframe. That
 * origin boundary is what keeps this site safe: the frame cannot read our DOM,
 * cookies or the admin session. The sandbox below only narrows what the game can
 * do on its own page — itch's player needs scripts and its own storage to run,
 * and popups to reach its game page — so it is not the isolation mechanism here.
 *
 * Honesty: a cross-origin frame reports `load` even for an itch.io error page,
 * and nothing inside it is readable, so this component never claims the game
 * works. It says what it did — requested the frame, saw it load — and always
 * offers the direct itch.io address for the case where the embed is refused.
 */
export function GamePlayer({ game }: { game: PublicGame }) {
  const [state, setState] = useState<PlayerState>('idle');
  const [runKey, setRunKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenNote, setFullscreenNote] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const slowTimer = useRef<number | null>(null);

  const meta = STATUS_META[game.status];
  const embedUrl = game.playable ? game.itch.embedUrl : null;
  const project = parseItchProjectUrl(game.itch.projectUrl);
  const canPlay = Boolean(embedUrl);
  const fullscreenSupported =
    typeof document !== 'undefined' && Boolean(((document.fullscreenEnabled as boolean | undefined) ?? true));

  /** Whatever is fullscreen right now, standard or prefixed. */
  const activeFullscreenElement = (): Element | null =>
    document.fullscreenElement ??
    (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement ??
    null;

  /* ------------------------------------------------------------ fullscreen */

  useEffect(() => {
    const onChange = () => {
      setFullscreen(Boolean(activeFullscreenElement()));
      setFullscreenNote(null);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const node = wrapRef.current as FullscreenElement | null;
    if (!node) return;

    try {
      if (activeFullscreenElement()) {
        const exit =
          document.exitFullscreen ??
          (document as Document & { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen;
        await exit?.call(document);
        return;
      }
      const request = node.requestFullscreen?.bind(node) ?? node.webkitRequestFullscreen?.bind(node);
      if (!request) {
        setFullscreenNote('This browser does not allow fullscreen. The game still plays here.');
        return;
      }
      await request();
    } catch {
      // Browsers refuse fullscreen for their own reasons (an embedding policy, a
      // gesture they did not count). Say so instead of silently doing nothing.
      setFullscreenNote('Fullscreen was blocked by the browser. The game still plays here.');
    }
  }, []);

  /* ------------------------------------------------------------- lifecycle */

  const clearSlowTimer = useCallback(() => {
    if (slowTimer.current !== null) window.clearTimeout(slowTimer.current);
    slowTimer.current = null;
  }, []);

  const launch = useCallback(() => {
    if (!canPlay) return;
    setSlow(false);
    setState('loading');
    setRunKey((key) => key + 1);
    recordPlayed(game.slug);
    clearSlowTimer();
    // A frame that stays blank is not detectable from here; after twenty
    // seconds say so, and keep the direct link on screen either way.
    slowTimer.current = window.setTimeout(() => setSlow(true), 20_000);
  }, [canPlay, clearSlowTimer, game.slug]);

  useEffect(() => clearSlowTimer, [clearSlowTimer]);

  /*
   * While the game is up, the page's floating chrome steps aside: a game has its
   * own controls and corners, and a contact bubble over its canvas is in the
   * way. The flag lives on <body> and is removed when the player stops.
   */
  useEffect(() => {
    if (state === 'idle') return undefined;
    document.body.dataset.immersive = 'true';
    return () => {
      delete document.body.dataset.immersive;
    };
  }, [state]);

  /* -------------------------------------------------------------- rendering */

  if (!canPlay) {
    const publicVisible = isPubliclyVisible(game.status, true);
    return (
      <div className="player" id="play">
        <div className="player__frame">
          <div className="player__placeholder">
            <span className="page-state__icon" aria-hidden="true">
              <IconLock size={22} />
            </span>
            <h2>No playable game is connected yet</h2>
            <p>
              {game.status === 'published'
                ? 'This game is published, but its itch.io player has not been connected. The listing is here while the owner finishes it.'
                : meta.hint}
            </p>
            <p className="player__meta">
              <StatusBadge status={game.status} />
              {publicVisible ? null : <span className="badge badge--draft">Owner preview only</span>}
            </p>
            <Link className="btn btn--ghost" to="/games">
              Back to the library
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="player" id="play" ref={wrapRef} data-fullscreen={fullscreen}>
      <div className="player__frame">
        {state === 'idle' ? (
          <div className="player__placeholder">
            <span className="page-state__icon" aria-hidden="true">
              <IconPlay size={22} />
            </span>
            <h2>Play {game.title}</h2>
            <p>
              The game runs in this frame, hosted on itch.io. Nothing is installed and no account is needed to play.
            </p>
            <button type="button" className="btn btn--primary btn--lg" onClick={launch}>
              <IconPlay size={18} />
              Play
            </button>
            <p className="player__meta">
              {game.version ? <span className="badge">v{game.version.replace(/^v/i, '')}</span> : null}
              {game.estimatedPlaytime ? <span className="badge">{game.estimatedPlaytime}</span> : null}
              <span className="badge">Hosted on itch.io</span>
            </p>
            {project.ok ? (
              <a
                className="btn btn--ghost btn--sm"
                href={project.value.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open on itch.io
                <IconExternal size={14} />
              </a>
            ) : null}
          </div>
        ) : null}

        {state === 'loading' && !slow ? (
          <div className="player__loader" role="status">
            <Spinner shape="ring" size="lg" className="player__spinner" />
            <span>Loading the game from itch.io…</span>
          </div>
        ) : null}

        {state !== 'idle' ? (
          <div className="player__stage">
            <iframe
              key={runKey}
              ref={frameRef}
              src={embedUrl ?? undefined}
              title={`${game.title} — playable game on itch.io`}
              // itch.io's player needs scripts, its own origin's storage, forms
              // and popups; the frame is already cross-origin, so this sandbox
              // narrows the game's own page without granting it anything here.
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-pointer-lock allow-downloads allow-modals allow-presentation"
              allow="fullscreen; gamepad; autoplay; clipboard-write"
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => {
                clearSlowTimer();
                setSlow(false);
                setState('running');
              }}
              onError={() => {
                clearSlowTimer();
                setSlow(true);
              }}
            />
          </div>
        ) : null}
      </div>

      {state !== 'idle' ? (
        <div className="player__toolbar">
          <span className="player__status" role="status">
            {slow ? 'Waiting for itch.io…' : state === 'loading' ? 'Loading from itch.io…' : 'Running on itch.io'}
          </span>
          <div className="player__toolbar-group">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setState('loading');
                setRunKey((key) => key + 1);
                clearSlowTimer();
                slowTimer.current = window.setTimeout(() => setSlow(true), 20_000);
              }}
            >
              <IconRestart size={16} />
              Restart
            </button>
            {project.ok ? (
              <a
                className="btn btn--ghost btn--sm"
                href={project.value.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                itch.io
                <IconExternal size={14} />
              </a>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => void toggleFullscreen()}
              aria-pressed={fullscreen}
              disabled={!fullscreenSupported}
              title={fullscreen ? 'Leave fullscreen' : 'Play fullscreen'}
            >
              {fullscreen ? <IconCollapse size={16} /> : <IconExpand size={16} />}
              {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            </button>
          </div>
        </div>
      ) : null}

      {slow ? (
        <div className="player__fallback callout callout--warn" role="alert">
          <span className="callout__title">
            <IconAlert size={16} /> The game has not appeared
          </span>
          <span>
            itch.io may have refused the embed, the project may be private, or its file may not be an HTML5 build. You can
            always play it directly on itch.io.
          </span>
          <div className="cluster" style={{ marginTop: 'var(--space-3)' }}>
            {project.ok ? (
              <a className="btn btn--primary btn--sm" href={project.value.url} target="_blank" rel="noreferrer noopener">
                Play on itch.io
                <IconExternal size={14} />
              </a>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setState('loading');
                setRunKey((key) => key + 1);
                clearSlowTimer();
                slowTimer.current = window.setTimeout(() => setSlow(true), 20_000);
              }}
            >
              Try again
            </button>
            <Link className="btn btn--ghost btn--sm" to="/contact">
              Report a problem
            </Link>
          </div>
        </div>
      ) : null}

      {fullscreenNote ? (
        <p className="player__note" role="status">
          {fullscreenNote}
        </p>
      ) : null}

      {project.ok ? (
        <p className="player__provider field__hint">
          If the game stays blank, the embed may be blocked in your browser —{' '}
          <a href={project.value.url} target="_blank" rel="noreferrer noopener">
            play it on itch.io
          </a>
          . Game hosted by itch.io; the frame cannot read this site, your storage here or the admin session.
        </p>
      ) : (
        <p className="player__provider field__hint">
          Game hosted by itch.io. The frame cannot read this site, your storage here or the admin session.
        </p>
      )}
    </div>
  );
}
