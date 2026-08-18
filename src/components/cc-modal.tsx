import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type ModalProps } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { alpha, palette, spacing, springs, typography } from '@/constants/theme';
import { GlassCard } from '@/components/glass-card';
import { useTheme } from '@/theme/theme-provider';

type CCModalProps = Pick<ModalProps, 'onRequestClose'> & {
  visible: boolean;
  title?: string;
  onDismiss: () => void;
  children?: React.ReactNode;
};

/**
 * Centred glass dialog.
 *
 * Springs in with a slight overshoot to match the button feel. Tapping the
 * scrim dismisses; the card itself swallows taps so an accidental press inside
 * doesn't close it.
 */
export function CCModal({ visible, title, onDismiss, children, onRequestClose }: CCModalProps) {
  const { theme } = useTheme();
  const scale = useSharedValue(0.9);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      scale.value = withSpring(1, springs.bouncy);
      opacity.value = withTiming(1, { duration: 160 });
    } else {
      scale.value = 0.9;
      opacity.value = 0;
    }
  }, [visible, scale, opacity]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onRequestClose ?? onDismiss}>
      <Pressable
        style={[styles.scrim, { backgroundColor: alpha(palette.midnight, 0.6) }]}
        onPress={onDismiss}
        accessibilityLabel="Close dialog">
        <Animated.View style={[styles.cardWrap, cardStyle]}>
          {/* Stop propagation so taps inside the dialog don't dismiss it. */}
          <Pressable onPress={(e) => e.stopPropagation()}>
            <GlassCard rounded="xl">
              {title ? (
                <Text style={[typography.title, styles.title, { color: theme.text }]}>{title}</Text>
              ) : null}
              <View style={styles.body}>{children}</View>
            </GlassCard>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  cardWrap: {
    width: '100%',
    maxWidth: 420,
  },
  title: {
    marginBottom: spacing.sm,
  },
  body: {
    gap: spacing.md,
  },
});
