import { useEffect } from 'react';
import { site } from '../data/site';

/**
 * Per-route document metadata.
 *
 * Titles, descriptions, Open Graph and Twitter tags are updated in place. A
 * canonical URL and absolute OG image are only written when a production domain
 * is configured — nothing is ever invented.
 */

interface SeoProps {
  title: string;
  description: string;
  /** Route path used for canonical + og:url, e.g. "/games/pixel-painter". */
  path: string;
  /** Optional image path under public/. */
  image?: string;
  type?: 'website' | 'article' | 'video.other';
  noIndex?: boolean;
  /** Optional structured data (schema.org) emitted as JSON-LD. */
  jsonLd?: Record<string, unknown>;
}

function upsertMeta(selector: string, attrs: Record<string, string>): void {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    document.head.appendChild(element);
  }
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
}

function upsertLink(rel: string, href: string): void {
  let element = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', rel);
    document.head.appendChild(element);
  }
  element.setAttribute('href', href);
}

export function Seo({ title, description, path, image, type = 'website', noIndex, jsonLd }: SeoProps) {
  useEffect(() => {
    const domain = site.productionDomain.replace(/\/+$/, '');
    const canonical = domain ? `${domain}${path === '/' ? '/' : path}` : '';
    const imageUrl = image ? (domain ? `${domain}${image}` : image) : '';

    document.title = title;
    upsertMeta('meta[name="description"]', { name: 'description', content: description });
    upsertMeta('meta[name="robots"]', { name: 'robots', content: noIndex ? 'noindex, follow' : 'index, follow' });

    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title });
    upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description });
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: type });
    upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: site.developerName });
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: title });
    upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description });

    if (imageUrl) {
      upsertMeta('meta[property="og:image"]', { property: 'og:image', content: imageUrl });
      upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: imageUrl });
    }
    if (canonical) {
      upsertMeta('meta[property="og:url"]', { property: 'og:url', content: canonical });
      upsertLink('canonical', canonical);
    } else {
      document.head.querySelector('link[rel="canonical"]')?.remove();
      document.head.querySelector('meta[property="og:url"]')?.remove();
    }
  }, [description, image, noIndex, path, title, type]);

  useEffect(() => {
    const id = 'hg-jsonld';
    document.getElementById(id)?.remove();
    if (!jsonLd) return;

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = id;
    script.textContent = JSON.stringify(jsonLd);
    document.head.appendChild(script);

    return () => {
      document.getElementById(id)?.remove();
    };
  }, [jsonLd]);

  return null;
}
