import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { GlassCard } from '@/components/glass-card';
import { spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

/**
 * "My CosmoCutie" — the client's own hub.
 *
 * Built as a shell now so navigation exists before features are bolted on.
 * Likes and following light up in Phase 8, shop orders in Phase 10, the hair
 * journey in Phase 9.
 */
export default function Account() {
  const { theme, scheme, toggle } = useTheme();
  const { user, signOut } = useAuth();
  const router = useRouter();

  const [stylistCount, setStylistCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    const { count } = await supabase
      .from('client_records')
      .select('id', { count: 'exact', head: true });
    setStylistCount(count ?? 0);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const exportData = async () => {
    setExporting(true);
    const [{ data: me }, { data: records }, { data: appts }] = await Promise.all([
      supabase.from('clients').select('*'),
      supabase.from('client_records').select('*'),
      supabase.from('appointments').select('*'),
    ]);
    const payload = JSON.stringify({ profile: me, relationships: records, appointments: appts }, null, 2);
    setExporting(false);

    if (typeof window !== 'undefined' && window.document) {
      const blob = new Blob([payload], { type: 'application/json' });
      const a = window.document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'cosmocutie-my-data.json';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View>
            <Text style={[typography.display, { color: theme.text }]}>My CosmoCutie</Text>
            <Text style={[typography.caption, { color: theme.textMuted }]}>{user?.email}</Text>
          </View>

          <Section title="Appointments">
            <Text style={[typography.body, { color: theme.textMuted }]}>
              Nothing booked yet. Booking opens in the next phase.
            </Text>
          </Section>

          <Section title="My stylists">
            <Text style={[typography.body, { color: theme.text }]}>
              {stylistCount === null
                ? '…'
                : stylistCount === 0
                  ? 'None yet — your stylist can send you an invite link.'
                  : `${stylistCount} stylist${stylistCount === 1 ? '' : 's'}`}
            </Text>
          </Section>

          <Section title="Settings">
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={[typography.heading, { color: theme.text }]}>Dark mode</Text>
                <Text style={[typography.caption, { color: theme.textMuted }]}>
                  {scheme === 'dark' ? 'Cyberpunk Gloss' : 'Frosted Strawberry'}
                </Text>
              </View>
              <Switch
                value={scheme === 'dark'}
                onValueChange={toggle}
                trackColor={{ true: theme.primary, false: theme.border }}
              />
            </View>
          </Section>

          <Section title="Your data">
            <Text style={[typography.body, { color: theme.textMuted }]}>
              Download everything we hold about you.
            </Text>
            <CCButton
              label={exporting ? 'Preparing…' : 'Export my data'}
              variant="secondary"
              disabled={exporting}
              onPress={exportData}
            />
            <Text style={[typography.caption, { color: theme.textMuted }]}>
              Account deletion arrives with the compliance phase, ahead of any
              store submission.
            </Text>
          </Section>

          <CCButton label="Sign out" variant="ghost" onPress={signOut} />
          <CCButton label="Back" variant="ghost" onPress={() => router.back()} />
        </ScrollView>
      </SafeAreaView>
    </AmbientBackground>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[typography.label, { color: theme.textMuted }]}>{title.toUpperCase()}</Text>
      <GlassCard>
        <View style={styles.card}>{children}</View>
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.md },
  section: { gap: spacing.sm },
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: 2 },
});
