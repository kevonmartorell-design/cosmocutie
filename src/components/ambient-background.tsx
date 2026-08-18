import { BlurView } from 'expo-blur';
import { useEffect } from 'react';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme/theme-provider';

/**
 * The layer that lives *behind* the glass.
 *
 * Coloured orbs drift slowly; glass panels on top pick up the shifting colour
 * through their blur. Per the design brief, ambient motion goes behind the
 * glass and sharp sparkles go in front of it.
 *
 * Two things keep the orbs reading as glows rather than as circles:
 *  1. They are far larger than the viewport and anchored off-screen, so only
 *     the soft centre of each is ever visible — no edge enters the frame.
 *  2. A heavy blur pass sits over the orb layer (but under content), which is
 *     the only way to get a true soft falloff, since React Native has no
 *     equivalent of CSS `filter: blur()` on a view.
 */
export function AmbientBackground({ style, children, ...rest }: ViewProps) {
  const { theme } = useTheme();
  const drift = useSharedValue(0);

  useEffect(() => {
    drift.value = withRepeat(
      withTiming(1, { duration: 18000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [drift]);

  const orbA = useAnimatedStyle(() => ({
    transform: [{ translateX: drift.value * 60 - 30 }, { translateY: drift.value * -50 }],
  }));
  const orbB = useAnimatedStyle(() => ({
    transform: [{ translateX: drift.value * -70 + 35 }, { translateY: drift.value * 60 - 30 }],
  }));
  const orbC = useAnimatedStyle(() => ({
    transform: [{ translateX: drift.value * 50 }, { translateY: drift.value * 55 - 40 }],
  }));

  const [a, b, c] = theme.orbs;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }, style]} {...rest}>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          // Web-only: blur the orb layer directly rather than compositing a
          // backdrop-filter over it.
          Platform.OS === 'web' ? ({ filter: 'blur(70px)' } as object) : null,
        ]}>
        <Animated.View style={[styles.orb, styles.orbA, { backgroundColor: a }, orbA]} />
        <Animated.View style={[styles.orb, styles.orbB, { backgroundColor: b }, orbB]} />
        <Animated.View style={[styles.orb, styles.orbC, { backgroundColor: c }, orbC]} />

        {/*
         * Softening the orbs into glows.
         *
         * Web uses a CSS blur filter on the orb layer itself. The earlier
         * approach — a full-screen BlurView (backdrop-filter) painted over the
         * orbs — ghosted badly in Chromium: resizing the window left the
         * previous frame composited underneath, which reads as the whole screen
         * being drawn twice. A plain filter has no backdrop to sample and no
         * such artifact, and it is considerably cheaper.
         *
         * Android's blur is too weak to be worth the cost, so it leans on the
         * off-screen orb sizing plus a light scrim.
         */}
        {Platform.OS === 'ios' ? (
          <BlurView intensity={100} tint={theme.glass.tint} style={StyleSheet.absoluteFill} />
        ) : Platform.OS === 'android' ? (
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, opacity: 0.35 }]}
          />
        ) : null}
      </View>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
  },
  orb: {
    position: 'absolute',
    borderRadius: 9999,
    opacity: 0.9,
  },
  // Oversized and anchored past the edges so no hard boundary is ever in frame.
  orbA: { width: 620, height: 620, top: -300, left: -240 },
  orbB: { width: 560, height: 560, top: 120, right: -280 },
  orbC: { width: 680, height: 680, bottom: -360, left: -120 },
});
