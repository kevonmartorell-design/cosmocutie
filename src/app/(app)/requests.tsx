import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { formatSlot, timeLeft } from '@/booking/negotiation';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { GlassCard } from '@/components/glass-card';
import { Loading } from '@/components/loading';
import { alpha, spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

type Row = {
  id: string;
  tenant_id: string;
  status: string;
  proposed_starts_at: string;
  step_deadline: string;
};

/**
 * Pending negotiations for whoever is looking.
 *
 * RLS returns a stylist their tenant's requests and a client their own, so one
 * query serves both roles without branching on identity here.
 */
export default function Requests() {
  const { theme } = useTheme();
  const { stylistTenants } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('booking_requests')
      .select('id, tenant_id, status, proposed_starts_at, step_deadline')
      .order('created_at', { ascending: false })
      .limit(50);
    setRows((data as Row[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows === null) return <Loading label="Loading requests" />;

  const live = rows.filter((r) => r.status === 'awaiting_stylist' || r.status === 'awaiting_client');
  const done = rows.filter((r) => !live.includes(r));

  const needsYou = (r: Row) => {
    const mine = stylistTenants.some((t) => t.tenantId === r.tenant_id);
    return mine ? r.status === 'awaiting_stylist' : r.status === 'awaiting_client';
  };

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[typography.display, { color: theme.text }]}>Requests</Text>

          {live.length === 0 ? (
            <GlassCard>
              <Text style={[typography.body, { color: theme.textMuted }]}>
                Nothing pending right now.
              </Text>
            </GlassCard>
          ) : (
            live.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => router.push({ pathname: '/(app)/request/[id]', params: { id: r.id } })}>
                <GlassCard
                  style={
                    needsYou(r)
                      ? { borderColor: alpha(theme.primary, 0.6), borderWidth: 2 }
                      : undefined
                  }>
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <Text style={[typography.heading, { color: theme.text }]}>
                        {formatSlot(r.proposed_starts_at)}
                      </Text>
                      <Text style={[typography.caption, { color: theme.textMuted }]}>
                        {timeLeft(r.step_deadline)}
                      </Text>
                    </View>
                    {needsYou(r) ? (
                      <Text style={[typography.label, { color: theme.primary }]}>Your turn</Text>
                    ) : (
                      <Text style={[typography.caption, { color: theme.textMuted }]}>Waiting</Text>
                    )}
                  </View>
                </GlassCard>
              </Pressable>
            ))
          )}

          {done.length > 0 ? (
            <>
              <Text style={[typography.label, { color: theme.textMuted }]}>PAST</Text>
              {done.slice(0, 10).map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() =>
                    router.push({ pathname: '/(app)/request/[id]', params: { id: r.id } })
                  }>
                  <GlassCard rounded="md">
                    <View style={styles.row}>
                      <Text style={[typography.body, { color: theme.textMuted, flex: 1 }]}>
                        {formatSlot(r.proposed_starts_at)}
                      </Text>
                      <Text style={[typography.caption, { color: theme.textMuted }]}>
                        {r.status}
                      </Text>
                    </View>
                  </GlassCard>
                </Pressable>
              ))}
            </>
          ) : null}

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
  rowText: { flex: 1, gap: 2 },
});
