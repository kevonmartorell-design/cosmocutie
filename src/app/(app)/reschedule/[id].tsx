import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatSlot } from '@/booking/negotiation';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { GlassCard } from '@/components/glass-card';
import { Loading } from '@/components/loading';
import { alpha, radius, spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

const dayOptions = (n = 14) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1);
    return d;
  });

/**
 * Propose a new time for a confirmed appointment.
 *
 * One proposal, one answer — not the six-step negotiation. Moving an
 * appointment is usually trivial and does not warrant that machinery.
 */
export default function Reschedule() {
  const { theme } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [appt, setAppt] = useState<{ tenant_id: string; starts_at: string; ends_at: string } | null>(
    null,
  );
  const [day, setDay] = useState<Date>(dayOptions()[0]);
  const [slots, setSlots] = useState<{ slot_start: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    supabase
      .from('appointments')
      .select('tenant_id, starts_at, ends_at')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => setAppt(data));
  }, [id]);

  const loadSlots = useCallback(async () => {
    if (!appt) return;
    const mins =
      (new Date(appt.ends_at).getTime() - new Date(appt.starts_at).getTime()) / 60000;
    const { data } = await supabase.rpc('available_slots', {
      p_tenant_id: appt.tenant_id,
      p_date: day.toISOString().slice(0, 10),
      p_duration_minutes: Math.round(mins),
    });
    setSlots(data ?? []);
  }, [appt, day]);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  const propose = async (slotStart: string) => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('request_appointment_reschedule', {
      p_appointment_id: id!,
      p_new_starts_at: slotStart,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      void loadSlots();
      return;
    }
    router.replace('/(app)/appointments');
  };

  if (!appt) return <Loading label="Loading appointment" />;

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View>
            <Text style={[typography.display, { color: theme.text }]}>Move appointment</Text>
            <Text style={[typography.caption, { color: theme.textMuted }]}>
              Currently {formatSlot(appt.starts_at)}
            </Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.days}>
              {dayOptions().map((d) => {
                const on = d.toDateString() === day.toDateString();
                return (
                  <Pressable
                    key={d.toISOString()}
                    onPress={() => setDay(d)}
                    style={[
                      styles.day,
                      {
                        borderColor: on ? theme.primary : theme.border,
                        backgroundColor: on ? alpha(theme.primary, 0.15) : 'transparent',
                      },
                    ]}>
                    <Text style={[typography.caption, { color: theme.textMuted }]}>
                      {d.toLocaleDateString(undefined, { weekday: 'short' })}
                    </Text>
                    <Text style={[typography.heading, { color: on ? theme.primary : theme.text }]}>
                      {d.getDate()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          {slots === null ? (
            <Text style={[typography.caption, { color: theme.textMuted }]}>Checking…</Text>
          ) : slots.length === 0 ? (
            <GlassCard>
              <Text style={[typography.body, { color: theme.textMuted }]}>
                Nothing open that day.
              </Text>
            </GlassCard>
          ) : (
            <View style={styles.slots}>
              {slots.map((s) => (
                <Pressable
                  key={s.slot_start}
                  disabled={busy}
                  onPress={() => propose(s.slot_start)}
                  style={[styles.slot, { borderColor: theme.border }]}>
                  <Text style={[typography.label, { color: theme.text }]}>
                    {new Date(s.slot_start).toLocaleTimeString(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {error ? (
            <Text style={[typography.caption, { color: theme.danger }]}>{error}</Text>
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
  days: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  day: {
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    minWidth: 58,
  },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  slot: {
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
});
