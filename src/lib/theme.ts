import { site } from '../data/site';
import { STORAGE_KEYS, readRaw, writeRaw } from './storage';

/** Two themes, one design language: warm ivory paper and neutral warm charcoal. */
export type Theme = 'light' | 'dark';

export const THEMES: Theme[] = ['light', 'dark'];

/** Human names, used by the theme control's labels. */
export const THEME_LABELS: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
};

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

/** The theme after this one, for a control that cycles. */
export function nextTheme(theme: Theme): Theme {
  const index = THEMES.indexOf(theme);
  return THEMES[(index + 1) % THEMES.length] ?? site.theme.default;
}

/** The OS preference only ever answers light or dark. */
export function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return site.theme.default;
  }
}

/** Stored choice wins; otherwise the OS preference on a first visit. */
export function resolveInitialTheme(): Theme {
  const stored = readRaw(STORAGE_KEYS.theme);
  if (isTheme(stored)) return stored;
  if (site.theme.respectSystemOnFirstVisit) return systemTheme();
  return site.theme.default;
}

export function persistTheme(theme: Theme): void {
  writeRaw(STORAGE_KEYS.theme, theme);
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** Only follow OS changes while the visitor has not made an explicit choice. */
export function hasStoredPreference(): boolean {
  return isTheme(readRaw(STORAGE_KEYS.theme));
}
