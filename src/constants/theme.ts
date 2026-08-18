/**
 * CosmoCutie design tokens.
 *
 * Single source of truth for colour, glass, radius, spacing and type.
 * Nothing in the app should hardcode a colour or a blur value — import from here.
 *
 * Palette: "Cyber Magical Girl" (see PLAN.md → Design System)
 * Glass:   "Frosted Strawberry" (light) / "Cyberpunk Gloss" (dark)
 */

/** Raw brand colours. Prefer the semantic tokens below in components. */
export const palette = {
  hotPink: '#FF1493',
  bubblegum: '#FF77A9',
  electricViolet: '#9A4DFF',
  laserCyan: '#00F5FF',
  starlightWhite: '#FFF5FB',
  sunshineYellow: '#FFDD00',

  deepPlum: '#2A1028',
  charcoal: '#1A1A1A',
  obsidianViolet: '#0F0817',
  midnight: '#0A0816',

  white: '#FFFFFF',
  black: '#000000',
} as const;

/** rgba() helper so alpha values stay readable at the call site. */
export const alpha = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/**
 * Corner radii. The design brief calls for heavy rounding (24–32px) to keep
 * the app reading youthful rather than corporate.
 */
export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const typography = {
  display: { fontSize: 32, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  label: { fontSize: 14, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
} as const;

/**
 * Glass surface definitions.
 *
 * `blurIntensity` is expo-blur's 0–100 scale, not CSS pixels. The design brief
 * specified ~16px (light) and ~20px (dark); these intensities approximate that
 * on iOS. Android blur is weaker and device-dependent — see `glassFallback`.
 */
export type GlassTokens = {
  blurIntensity: number;
  tint: 'light' | 'dark';
  overlay: string;
  border: string;
  /** Used where real blur is unavailable or too expensive (Android, low-end). */
  fallbackSurface: string;
};

export type ThemeTokens = {
  name: 'light' | 'dark';
  background: string;
  /** Ambient gradient orbs sitting behind the glass layer. */
  orbs: readonly string[];
  surface: string;
  surfaceElevated: string;
  text: string;
  textMuted: string;
  textInverse: string;
  primary: string;
  primaryText: string;
  accent: string;
  highlight: string;
  sparkle: readonly string[];
  border: string;
  danger: string;
  success: string;
  glass: GlassTokens;
};

/** "Frosted Strawberry" — daytime, dreamy, pastel-and-neon. */
export const lightTheme: ThemeTokens = {
  name: 'light',
  background: palette.starlightWhite,
  orbs: [alpha(palette.hotPink, 0.45), alpha(palette.bubblegum, 0.4), alpha(palette.electricViolet, 0.3)],
  surface: alpha(palette.white, 0.5),
  surfaceElevated: alpha(palette.white, 0.72),
  text: palette.deepPlum,
  textMuted: alpha(palette.deepPlum, 0.6),
  textInverse: palette.starlightWhite,
  primary: palette.hotPink,
  primaryText: palette.white,
  accent: palette.electricViolet,
  highlight: palette.laserCyan,
  sparkle: [palette.laserCyan, palette.sunshineYellow, palette.white],
  border: alpha(palette.white, 0.55),
  danger: '#D32F5E',
  success: '#1FA97C',
  glass: {
    blurIntensity: 55,
    tint: 'light',
    overlay: alpha(palette.white, 0.5),
    border: alpha(palette.white, 0.55),
    fallbackSurface: alpha(palette.white, 0.86),
  },
};

/** "Cyberpunk Gloss" — night sky, where hot pink actually glows. */
export const darkTheme: ThemeTokens = {
  name: 'dark',
  background: palette.obsidianViolet,
  orbs: [alpha(palette.hotPink, 0.5), alpha(palette.laserCyan, 0.3), alpha(palette.electricViolet, 0.45)],
  surface: alpha(palette.black, 0.5),
  surfaceElevated: alpha(palette.charcoal, 0.66),
  text: palette.starlightWhite,
  textMuted: alpha(palette.starlightWhite, 0.62),
  textInverse: palette.deepPlum,
  primary: palette.hotPink,
  primaryText: palette.white,
  accent: palette.laserCyan,
  highlight: palette.sunshineYellow,
  sparkle: [palette.laserCyan, palette.sunshineYellow, palette.hotPink],
  border: alpha(palette.hotPink, 0.2),
  danger: '#FF5C8A',
  success: '#3FE0AE',
  glass: {
    blurIntensity: 70,
    tint: 'dark',
    overlay: alpha(palette.black, 0.5),
    border: alpha(palette.white, 0.2),
    fallbackSurface: alpha('#160E22', 0.94),
  },
};

export const themes = { light: lightTheme, dark: darkTheme } as const;

/**
 * Spring presets. The brief asks for squash-and-stretch rather than linear
 * transitions, so these are deliberately bouncy.
 */
export const springs = {
  bouncy: { damping: 10, stiffness: 180, mass: 0.8 },
  gentle: { damping: 18, stiffness: 140 },
  snappy: { damping: 22, stiffness: 260 },
} as const;
