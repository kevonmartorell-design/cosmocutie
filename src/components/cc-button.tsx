import { Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { alpha, radius, spacing, springs, typography } from '@/constants/theme';
import { useTheme } from '@/theme/theme-provider';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type CCButtonProps = Omit<PressableProps, 'style'> & {
  label: string;
  variant?: ButtonVariant;
  fullWidth?: boolean;
};

/**
 * Primary action control.
 *
 * Uses spring physics with a slight overshoot rather than a linear transition —
 * the brief asks for a satisfying squash-and-stretch on press, and a plain
 * opacity fade reads as generic.
 */
export function CCButton({
  label,
  variant = 'primary',
  fullWidth = false,
  disabled = false,
  onPressIn,
  onPressOut,
  ...rest
}: CCButtonProps) {
  const { theme } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const colors = {
    primary: { bg: theme.primary, fg: theme.primaryText, border: 'transparent' },
    secondary: {
      bg: alpha(theme.accent, 0.16),
      fg: theme.accent,
      border: alpha(theme.accent, 0.4),
    },
    ghost: { bg: 'transparent', fg: theme.text, border: theme.border },
    danger: { bg: theme.danger, fg: theme.primaryText, border: 'transparent' },
  }[variant];

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPressIn={(e) => {
        scale.value = withSpring(0.94, springs.bouncy);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, springs.bouncy);
        onPressOut?.(e);
      }}
      style={[
        styles.base,
        {
          backgroundColor: colors.bg,
          borderColor: colors.border,
          opacity: disabled ? 0.45 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        animatedStyle,
      ]}
      {...rest}>
      <View style={styles.content}>
        <Text style={[typography.label, styles.label, { color: colors.fg }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.xl,
    minHeight: 48, // Comfortable tap target.
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  label: {
    textAlign: 'center',
  },
});
