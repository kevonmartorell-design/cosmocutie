import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { spacing, typography } from '@/constants/theme';
import { AmbientBackground } from '@/components/ambient-background';
import { useTheme } from '@/theme/theme-provider';

export function Loading({ label }: { label?: string }) {
  const { theme } = useTheme();
  return (
    <AmbientBackground>
      <View style={styles.center}>
        <ActivityIndicator color={theme.primary} size="large" />
        {label ? (
          <Text style={[typography.caption, { color: theme.textMuted }]}>{label}</Text>
        ) : null}
      </View>
    </AmbientBackground>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
});
