import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { GlassCard } from '@/components/glass-card';
import { Loading } from '@/components/loading';
import { spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

type Row = {
  id: string;
  visit_count: number;
  safety_flag: string | null;
  requires_prepay: boolean;
  clients: { full_name: string } | null;
};

/** The stylist's book. Tenant-scoped by RLS — this is theirs alone. */
export default function Clients() {
  const { theme } = useTheme();
  const { stylistTenants } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('client_records')
      .select('id, visit_count, safety_flag, requires_prepay, clients(full_name)')
      .order('last_seen_at', { ascending: false, nullsFirst: false });
    setRows((data as unknown as Row[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The ownership promise made executable: a renter can take their book with
  // them, so staying is a choice rather than a trap.
  const exportBook = async () => {
    const tenant = stylistTenants[0];
    if (!tenant) return;
    setExporting(true);
    const { data } = await supabase.rpc('export_my_book', { p_tenant_id: tenant.tenantId });
    setExporting(false);
    if (!data) return;
    const json = JSON.stringify(data, null, 2);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(json).catch(() => {});
    }
    console.log('[export] book exported', json.length, 'bytes');
  };

  if (rows === null) return <Loading label="Loading your book" />;

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[typography.display, { color: theme.text }]}>My clients</Text>

          {rows.length === 0 ? (
            <GlassCard>
              <Text style={[typography.body, { color: theme.textMuted }]}>
                No clients yet. They appear here after their first booking.
              </Text>
            </GlassCard>
          ) : (
            rows.map((r) => (
              <Pressable
                key={r.id}
                onPress={() =>
                  router.push({ pathname: '/(app)/client-record/[id]', params: { id: r.id } })
                }>
                <GlassCard rounded="md">
                  <View style={styles.row}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[typography.heading, { color: theme.text }]}>
                        {r.clients?.full_name ?? 'Client'}
                      </Text>
                      <Text style={[typography.caption, { color: theme.textMuted }]}>
                        {r.visit_count} visit{r.visit_count === 1 ? '' : 's'}
                        {r.requires_prepay ? ' · prepay required' : ''}
                      </Text>
                    </View>
                    {r.safety_flag ? (
                      <Text style={[typography.label, { color: theme.danger }]}>⚠︎</Text>
                    ) : null}
                  </View>
                </GlassCard>
              </Pressable>
            ))
          )}

          <CCButton
            label={exporting ? 'Exporting…' : 'Export my book'}
            variant="secondary"
            disabled={exporting}
            onPress={exportBook}
          />
          <Text style={[typography.caption, { color: theme.textMuted }]}>
            Your clients, history and formulas are yours. Export them any time.
          </Text>

          <CCButton label="Back" variant="ghost" onPress={() => router.back()} />
        </ScrollView>
      </SafeAreaView>
    </AmbientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
