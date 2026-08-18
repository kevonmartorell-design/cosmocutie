import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import { themes, type ThemeTokens } from '@/constants/theme';

/**
 * Three states, not two. "system" is the default and follows the OS; picking
 * light or dark pins it. The plan calls for a user-facing toggle, and a pinned
 * choice has to survive an OS theme change or the toggle feels broken.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'cosmocutie.theme-preference';

type ThemeContextValue = {
  theme: ThemeTokens;
  /** Resolved scheme actually in use, after applying preference to system. */
  scheme: 'light' | 'dark';
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
  /** Flips between light and dark, pinning the result. */
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useSystemColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  // Restore the persisted choice. Failure is non-fatal — we just stay on system.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setPreferenceState(stored);
        }
      })
      .catch(() => {
        // Storage unavailable; system default is a fine fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // Non-fatal: the choice still applies for this session.
    });
  }, []);

  const scheme: 'light' | 'dark' =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const toggle = useCallback(() => {
    setPreference(scheme === 'dark' ? 'light' : 'dark');
  }, [scheme, setPreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: themes[scheme], scheme, preference, setPreference, toggle }),
    [scheme, preference, setPreference, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}
