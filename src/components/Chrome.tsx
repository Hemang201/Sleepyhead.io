import { site, isPlaceholderEmail } from '../data/site';
import { scrollToTop, useScrollProgress, useScrolledPast } from '../lib/hooks';
import { useSiteContent } from '../lib/site-content';
import { IconArrowUp, IconMail } from './Icons';

/** Thin gradient bar tracking read progress. Transform-only, so it stays cheap. */
export function ScrollProgress() {
  const progress = useScrollProgress();
  if (!site.features.scrollProgress) return null;

  return (
    <div
      className="scroll-progress"
      role="progressbar"
      aria-label="Page scroll progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      style={{ transform: `scaleX(${progress})` }}
    />
  );
}

function BackToTop() {
  const visible = useScrolledPast(600);
  if (!site.features.backToTop || !visible) return null;

  return (
    <button type="button" className="floating-action" onClick={() => scrollToTop()} aria-label="Back to top">
      <IconArrowUp size={20} />
      <span className="floating-action__tip">Back to top</span>
    </button>
  );
}

function FloatingContact() {
  if (!site.features.floatingContact) return null;
  return <FloatingContactLink />;
}

function FloatingContactLink() {
  const { contact } = useSiteContent();
  const address = contact.email.trim();
  if (isPlaceholderEmail(address)) return null;

  return (
    <a
      className="floating-action"
      href={`mailto:${address}`}
      aria-label={`Email me at ${address}`}
      title="Email me"
    >
      <IconMail size={20} />
      <span className="floating-action__tip">Email me</span>
    </a>
  );
}

/**
 * The floating control stack.
 *
 * Hidden while a game is running (body[data-immersive]) so it can never sit on
 * top of gameplay or the game's own controls, and shifted up while the privacy
 * banner is on screen so the two never overlap.
 */
export function FloatingChrome() {
  return (
    <div className="floating-stack">
      <BackToTop />
      <FloatingContact />
    </div>
  );
}
