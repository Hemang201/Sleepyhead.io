import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  DEFAULT_ABOUT,
  DEFAULT_APPEARANCE,
  DEFAULT_CONTACT,
  DEFAULT_SOCIAL,
  type AboutContent,
  type AppearanceSettings,
  type ContactContent,
  type SocialContent,
} from '../shared/site-content';
import { api, ApiError } from './api';
import type { LoadStatus } from './catalogue';

/**
 * Editable public content: the About page, the Contact details, the social links
 * and the decorative background settings.
 *
 * Everything starts from the shipped defaults, so the first paint is complete
 * and the site never flickers into place — the fetched documents simply replace
 * them when they arrive. Nothing here is sensitive: the owner's private
 * authentication address lives in a different table, behind an admin session,
 * and is not part of any of these responses.
 */

export interface SiteContentValue {
  about: AboutContent;
  avatar: { url: string; alt: string } | null;
  contact: ContactContent;
  /** The published social links, already in the owner's saved order. */
  social: SocialContent;
  appearance: AppearanceSettings;
  status: LoadStatus;
  error: string | null;
  /** ISO timestamp of the last published change, when the API reports one. */
  updatedAt: string | null;
  reload: () => void;
}

const DEFAULT_VALUE: SiteContentValue = {
  about: DEFAULT_ABOUT,
  avatar: null,
  contact: DEFAULT_CONTACT,
  social: DEFAULT_SOCIAL,
  appearance: DEFAULT_APPEARANCE,
  status: 'loading',
  error: null,
  updatedAt: null,
  reload: () => undefined,
};

const SiteContentContext = createContext<SiteContentValue>(DEFAULT_VALUE);

/** Focus revalidation window, mirroring the catalogue's behaviour. */
const FRESH_FOR_MS = 60_000;

export function SiteContentProvider({ children }: { children: ReactNode }) {
  const [about, setAbout] = useState<AboutContent>(DEFAULT_ABOUT);
  const [avatar, setAvatar] = useState<{ url: string; alt: string } | null>(null);
  const [contact, setContact] = useState<ContactContent>(DEFAULT_CONTACT);
  const [social, setSocial] = useState<SocialContent>(DEFAULT_SOCIAL);
  const [appearance, setAppearance] = useState<AppearanceSettings>(DEFAULT_APPEARANCE);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const loadedAt = useRef(0);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus((current) => (current === 'ready' ? current : 'loading'));

    try {
      const [aboutResponse, contactResponse, socialResponse, settingsResponse] = await Promise.all([
        api.about(),
        api.contact(),
        api.social(),
        api.settings(),
      ]);
      setAbout(aboutResponse.about);
      setAvatar(aboutResponse.avatar);
      setContact(contactResponse.contact);
      setSocial(socialResponse.social);
      setAppearance(settingsResponse.appearance);
      setUpdatedAt(aboutResponse.updatedAt ?? contactResponse.updatedAt ?? socialResponse.updatedAt);
      setError(null);
      setStatus('ready');
      loadedAt.current = Date.now();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The page content could not be loaded.');
      // The defaults are already rendered, so an outage degrades rather than blanks.
      setStatus('ready');
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - loadedAt.current > FRESH_FOR_MS) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const value = useMemo<SiteContentValue>(
    () => ({ about, avatar, contact, social, appearance, status, error, updatedAt, reload: () => void load() }),
    [about, appearance, avatar, contact, error, load, social, status, updatedAt],
  );

  return <SiteContentContext.Provider value={value}>{children}</SiteContentContext.Provider>;
}

export function useSiteContent(): SiteContentValue {
  return useContext(SiteContentContext);
}

/**
 * The decorative settings, plus whether they have actually been loaded.
 *
 * The decorative layer waits for `ready`: drawing shapes first and then taking
 * them away again would be a visible flash for an owner who has turned
 * animations off. Nothing here is sensitive — the appearance document is
 * presentation-only.
 */
export function useAppearanceState(): { appearance: AppearanceSettings; ready: boolean } {
  const { appearance, status } = useContext(SiteContentContext);
  return { appearance, ready: status === 'ready' };
}
