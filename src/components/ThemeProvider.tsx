import { createContext, useContext, type ReactNode } from 'react';
import { useThemeController, type ThemeController } from '../lib/hooks';

const ThemeContext = createContext<ThemeController | null>(null);

/**
 * One source of truth for the theme.
 *
 * Several controls toggle the theme (header, mobile menu, footer), so the state
 * lives in a provider rather than in each button. The very first paint is handled
 * by the inline script in index.html, which is why there is no flash on load.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const controller = useThemeController();
  return <ThemeContext.Provider value={controller}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeController {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
