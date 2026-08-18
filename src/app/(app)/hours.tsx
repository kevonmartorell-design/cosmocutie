import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { CCInput } from '@/components/cc-input';
import { GlassCard } from '@/components/glass-card';
import { Loading } from '@/components/loading';
import { spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Row = { id: string | null; open: string; close: string };

/**
 * Business hours, set by each stylist for their own chair.
 *
 * Per-stylist rather than salon-wide is a compliance requirement, not a
 * convenience: an owner dictating a 1099 renter's working hours is behavioural
 * control, which is what triggers reclassification.
 */
export default function Hours() {
  const { theme } = useTheme();
  const { stylistTenants } = useAuth();
  const router = useRouter();
  const tenant = stylistTenants[0] ?? null;

  const [rows, setRows] = useState<Record<number, Row> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    const { data } = await supabase
      .from('business_hours')
      .select('id, weekday, opens_at, closes_at')
      .eq('tenant_id', tenant.tenantId);

    const next: Record<number, Row> = {};
    for (let d = 0; d < 7; d++) next[d] = { id: null, open: '09:00', close: '17:00' };
    for (const r of data ?? []) {
      next[r.weekday] = {
        id: r.id,
        open: (r.opens_at as string).slice(0, 5),
        close: (r.closes_at as string).slice(0, 5),
      };
    }
    setRows(next);
  }, [tenant]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleDay = async (day: number, on: boolean) => {
    if (!tenant || !rows) return;
    const row = rows[day];
    if (on) {
      const { data } = await supabase
        .from('business_hours')
        .insert({
          tenant_id: tenant.tenantId,
          weekday: day,
          opens_at: row.open,
          closes_at: row.close,
        })
        .select('id')
        .single();
      setRows({ ...rows, [day]: { ...row, id: data?.id ?? null } });
    } else if (row.id) {
      await supabase.from('business_hours').delete().eq('id', row.id);
      setRows({ ...rows, [day]: { ...row, id: null } });
    }
  };

  const saveTimes = async (day: number, open: string, close: string) => {
    if (!rows) return;
    setRows({ ...rows, [day]: { ...rows[day], open, close } });
    const row = rows[day];
    if (!row.id) return;
    setSaving(true);
    await supabase
      .from('business_hours')
      .update({ opens_at: open, closes_at: close })
      .eq('id', row.id);
    setSaving(false);
  };

  if (!tenant) return <Loading label="No chair" />;
  if (!rows) return <Loading label="Loading hours" />;

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View>
            <Text style={[typography.display, { color: theme.text }]}>Your hours</Text>
            <Text style={[typography.caption, { color: theme.textMuted }]}>
              {saving ? 'Saving…' : 'You set these — nobody else does'}
            </Text>
          </View>

          {DAYS.map((label, day) => {
            const row = rows[day];
            const open = row.id !== null;
            return (
              <GlassCard key={label} rounded="md">
                <View style={styles.dayRow}>
                  <Text style={[typography.heading, { color: theme.text, flex: 1 }]}>{label}</Text>
                  <Switch
                    value={open}
                    onValueChange={(v) => toggleDay(day, v)}
                    trackColor={{ true: theme.primary, false: theme.border }}
                  />
                </View>
                {open ? (
                  <View style={styles.times}>
                    <View style={styles.timeField}>
                      <CCInput
                        label="Opens"
                        value={row.open}
                        onChangeText={(v) => saveTimes(day, v, row.close)}
                        placeholder="09:00"
                      />
                    </View>
                    <View style={styles.timeField}>
                      <CCInput
                        label="Closes"
                        value={row.close}
                        onChangeText={(v) => saveTimes(day, row.open, v)}
                        placeholder="17:00"
                      />
                    </View>
                  </View>
                ) : null}
              </GlassCard>
            );
          })}

          <CCButton label="Done" variant="primary" fullWidth onPress={() => router.back()} />
        </ScrollView>
      </SafeAreaView>
    </AmbientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.md },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  times: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  timeField: { flex: 1 },
});
