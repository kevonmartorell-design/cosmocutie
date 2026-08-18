import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AmbientBackground } from '@/components/ambient-background';
import { GlassCard } from '@/components/glass-card';
import { spacing, typography } from '@/constants/theme';
import { runDbSmokeTest, type SmokeResult } from '@/db/db-smoke';
import { useTheme } from '@/theme/theme-provider';

/**
 * Dev screen proving the offline database actually works on this platform.
 * Kept in the app because "it compiled" is not evidence that a schema can
 * write, relate and query rows.
 */
export default function DbCheck() {
  const { theme } = useTheme();
  const [results, setResults] = useState<SmokeResult[] | null>(null);

  useEffect(() => {
    runDbSmokeTest().then(setResults);
  }, []);

  const passed = results?.filter((r) => r.ok).length ?? 0;
  const total = results?.length ?? 0;
  const allOk = results !== null && passed === total;

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[typography.title, { color: theme.text }]}>Local database check</Text>
          <Text style={[typography.caption, { color: theme.textMuted }]}>
            WatermelonDB · {results === null ? 'running…' : `${passed}/${total} passed`}
          </Text>

          {results?.map((r) => (
            <GlassCard key={r.step} rounded="md">
              <View style={styles.row}>
                <Text style={[typography.label, { color: r.ok ? theme.success : theme.danger }]}>
                  {r.ok ? '✓' : '✗'}
                </Text>
                <View style={styles.rowText}>
                  <Text style={[typography.label, { color: theme.text }]}>{r.step}</Text>
                  <Text style={[typography.caption, { color: theme.textMuted }]}>{r.detail}</Text>
                </View>
              </View>
            </GlassCard>
          ))}

          {results !== null ? (
            <Text
              testID="db-summary"
              style={[typography.heading, { color: allOk ? theme.success : theme.danger }]}>
              {allOk ? 'DB_SMOKE_OK' : 'DB_SMOKE_FAILED'}
            </Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </AmbientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  rowText: { flex: 1, gap: 2 },
});
