import { useEffect, useState } from 'react';

import { asset } from '../lib/asset';

interface GameThumbProps {
  /** Artwork path from the API, or null when the owner has not uploaded any. */
  src?: string | null;
  alt: string;
  className?: string;
  /** Above-the-fold artwork is loaded eagerly; everything else lazily. */
  priority?: boolean;
  /** Intrinsic size keeps the layout stable before the image arrives. */
  width?: number;
  height?: number;
  /** Rendered when the artwork fails to load (missing/broken file). */
  fallbackSrc?: string;
}

const FALLBACK_ART = '/art/fallback.svg';

/**
 * Thumbnail with graceful failure handling.
 *
 * Every image declares dimensions and lazy-loads by default, so artwork can never
 * cause a layout shift, and a missing file (or no upload at all) degrades to the
 * labelled placeholder instead of a broken-image icon.
 */
export function GameThumb({
  src,
  alt,
  className,
  priority = false,
  width = 640,
  height = 400,
  fallbackSrc = FALLBACK_ART,
}: GameThumbProps) {
  const [current, setCurrent] = useState(src ?? fallbackSrc);
  const [failed, setFailed] = useState(!src);

  // Artwork can be replaced through the dashboard while a page is open.
  useEffect(() => {
    setCurrent(src ?? fallbackSrc);
    setFailed(!src);
  }, [fallbackSrc, src]);

  return (
    <img
      className={className}
      src={asset(current)}
      alt={failed ? `${alt} (placeholder artwork)` : alt}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      draggable={false}
      onError={() => {
        if (current !== fallbackSrc) {
          setFailed(true);
          setCurrent(fallbackSrc);
        }
      }}
    />
  );
}
