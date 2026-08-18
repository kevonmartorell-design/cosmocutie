import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';

import { radius, spacing } from '@/constants/theme';
import { useTheme } from '@/theme/theme-provider';

type GlassCardProps = ViewProps & {
  /** Corner radius token. Defaults to `lg` (24px) per the design brief. */
  rounded?: keyof typeof radius;
  /** Skip padding when the card wraps something that manages its own spacing. */
  padded?: boolean;
  /**
   * Force the non-blurred surface. Use on dense working screens (stylist POS,
   * formula entry) where legibility and scroll performance beat the effect.
   */
  solid?: boolean;
};

/**
 * The frosted panel everything sits on.
 *
 * Real blur is expensive, and it is *notably* weaker on Android than iOS. Rather
 * than shipping a broken-looking blur there, Android and any explicitly `solid`
 * card render a high-opacity tinted surface instead — visually close, far
 * cheaper, and it keeps text legible on low-end hardware.
 */
export function GlassCard({
  rounded = 'lg',
  padded = true,
  solid = false,
  style,
  children,
  ...rest
}: GlassCardProps) {
  const { theme } = useTheme();
  const borderRadius = radius[rounded];

  // iOS and web get genuine blur; Android falls back by default.
  const useBlur = !solid && Platform.OS !== 'android';

  const frame: ViewStyle = {
    borderRadius,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: theme.glass.border,
    overflow: 'hidden',
  };

  const inner: ViewStyle = {
    padding: padded ? spacing.lg : 0,
  };

  if (!useBlur) {
    return (
      <View
        style={[frame, { backgroundColor: theme.glass.fallbackSurface }, inner, style]}
        {...rest}>
        {children}
      </View>
    );
  }

  return (
    <View style={[frame, style]} {...rest}>
      <BlurView
        intensity={theme.glass.blurIntensity}
        tint={theme.glass.tint}
        style={StyleSheet.absoluteFill}
      />
      {/* Tint layer: the blur alone reads too transparent over busy backgrounds. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.glass.overlay }]} />
      <View style={inner}>{children}</View>
    </View>
  );
}
