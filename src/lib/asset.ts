/**
 * Asset helper.
 *
 * Artwork and icons arrive from the API as root-relative paths
 * ("/api/media/artwork/<game-id>/thumbnail"). Prefixing them with Vite's
 * BASE_URL at render time keeps the site working when it is deployed to a
 * sub-path, without hardcoding a domain or a deployment folder anywhere.
 */

export function asset(path: string | undefined): string {
  if (!path) return '';
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path;

  const base = import.meta.env.BASE_URL || '/';
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** True for URLs that are already absolute (used to label outbound links). */
export function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
