import { useCopyToClipboard } from '../lib/hooks';
import { IconCheck, IconCopy } from './Icons';

interface CopyLinkButtonProps {
  /** Path to share; a canonical origin is used when one is configured. */
  path: string;
  label?: string;
  className?: string;
}

/**
 * Copies the canonical URL of the current page (or an explicit path) and reports
 * the outcome both visually and to screen readers.
 */
export function CopyLinkButton({ path, label = 'Copy link', className }: CopyLinkButtonProps) {
  const { copied, failed, copy } = useCopyToClipboard();

  const resolveUrl = () => {
    try {
      return new URL(path, window.location.origin).toString();
    } catch {
      return path;
    }
  };

  return (
    <>
      <button
        type="button"
        className={`btn btn--secondary btn--sm ${className ?? ''}`.trim()}
        onClick={() => copy(resolveUrl())}
      >
        {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
        {copied ? 'Link copied' : label}
      </button>
      <span className="visually-hidden" role="status" aria-live="polite">
        {copied ? 'Game link copied to the clipboard' : failed ? 'Copying was blocked by the browser' : ''}
      </span>
    </>
  );
}
