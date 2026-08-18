import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { CCInput } from '@/components/cc-input';
import { GlassCard } from '@/components/glass-card';
import { Loading } from '@/components/loading';
import { alpha, radius, spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

type Stylist = { tenant_id: string; display_name: string; headline: string | null };
type Service = { id: string; name: string; duration_minutes: number; price_cents: number };
type Slot = { slot_start: string; slot_end: string };

const dayOptions = (n = 14) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1);
    return d;
  });

/**
 * Client booking: stylist → services → time → request.
 *
 * Times come from `available_slots`, which already excludes anything booked,
 * buffered, blocked, or held by another negotiation. Nothing unbookable is ever
 * rendered, so there is no "that slot just went" error to handle here.
 */
export default function Book() {
  const { theme } = useTheme();
  const router = useRouter();

  const [stylists, setStylists] = useState<Stylist[] | null>(null);
  const [stylist, setStylist] = useState<Stylist | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [day, setDay] = useState<Date>(dayOptions()[0]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('stylist_profiles')
      .select('tenant_id, display_name, headline')
      .eq('is_published', true)
      .then(({ data }) => setStylists(data ?? []));
  }, []);

  useEffect(() => {
    if (!stylist) return;
    setPicked([]);
    supabase
      .from('services')
      .select('id, name, duration_minutes, price_cents')
      .eq('tenant_id', stylist.tenant_id)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setServices(data ?? []));
  }, [stylist]);

  const totalMinutes = services
    .filter((s) => picked.includes(s.id))
    .reduce((a, s) => a + s.duration_minutes, 0);
  const totalCents = services
    .filter((s) => picked.includes(s.id))
    .reduce((a, s) => a + s.price_cents, 0);

  const loadSlots = useCallback(async () => {
    if (!stylist || totalMinutes === 0) {
      setSlots(null);
      return;
    }
    const iso = day.toISOString().slice(0, 10);
    const { data } = await supabase.rpc('available_slots', {
      p_tenant_id: stylist.tenant_id,
      p_date: iso,
      p_duration_minutes: totalMinutes,
    });
    setSlots(data ?? []);
  }, [stylist, day, totalMinutes]);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  const request = async (slot: Slot) => {
    if (!stylist) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('create_booking_request', {
      p_tenant_id: stylist.tenant_id,
      p_service_ids: picked,
      p_starts_at: slot.slot_start,
      p_note: note.trim() || undefined,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      void loadSlots();
      return;
    }
    router.replace({ pathname: '/(app)/request/[id]', params: { id: data as string } });
  };

  if (stylists === null) return <Loading label="Finding stylists" />;

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[typography.display, { color: theme.text }]}>Book</Text>

          {/* 1 — stylist */}
          <Text style={[typography.label, { color: theme.textMuted }]}>STYLIST</Text>
          {stylists.length === 0 ? (
            <GlassCard>
              <Text style={[typography.body, { color: theme.textMuted }]}>
                No stylists are taking bookings yet.
              </Text>
            </GlassCard>
          ) : (
            stylists.map((s) => (
              <Choice
                key={s.tenant_id}
                selected={stylist?.tenant_id === s.tenant_id}
                title={s.display_name}
                subtitle={s.headline ?? undefined}
                onPress={() => setStylist(s)}
              />
            ))
          )}

          {/* 2 — services */}
          {stylist ? (
            <>
              <Text style={[typography.label, { color: theme.textMuted }]}>SERVICES</Text>
              {services.map((s) => (
                <Choice
                  key={s.id}
                  selected={picked.includes(s.id)}
                  title={s.name}
                  subtitle={`${s.duration_minutes} min · $${(s.price_cents / 100).toFixed(0)}`}
                  onPress={() =>
                    setPicked((p) =>
                      p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id],
                    )
                  }
                />
              ))}
              {picked.length > 1 ? (
                <Text style={[typography.caption, { color: theme.textMuted }]}>
                  {totalMinutes} min total · ${(totalCents / 100).toFixed(0)}
                </Text>
              ) : null}
            </>
          ) : null}

          {/* 3 — day + time */}
          {picked.length > 0 ? (
            <>
              <Text style={[typography.label, { color: theme.textMuted }]}>DAY</Text>
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
                        <Text
                          style={[typography.heading, { color: on ? theme.primary : theme.text }]}>
                          {d.getDate()}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>

              <Text style={[typography.label, { color: theme.textMuted }]}>TIME</Text>
              {slots === null ? (
                <Text style={[typography.caption, { color: theme.textMuted }]}>Checking…</Text>
              ) : slots.length === 0 ? (
                <GlassCard>
                  <Text style={[typography.body, { color: theme.textMuted }]}>
                    Nothing open that day. Try another.
                  </Text>
                </GlassCard>
              ) : (
                <View style={styles.slots}>
                  {slots.map((s) => (
                    <Pressable
                      key={s.slot_start}
                      disabled={busy}
                      onPress={() => request(s)}
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

              <CCInput
                label="Anything to add?"
                placeholder="Optional note for your stylist"
                value={note}
                onChangeText={setNote}
                hint="Sent with your request"
              />
            </>
          ) : null}

          {error ? (
            <Text style={[typography.caption, { color: theme.danger }]}>{error}</Text>
          ) : null}

          <CCButton label="Back" variant="ghost" onPress={() => router.back()} />
        </ScrollView>
      </SafeAreaView>
    </AmbientBackground>
  );
}

function Choice({
  title,
  subtitle,
  selected,
  onPress,
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.choice,
        {
          borderColor: selected ? theme.primary : theme.border,
          backgroundColor: selected ? alpha(theme.primary, 0.12) : 'transparent',
        },
      ]}>
      <Text style={[typography.heading, { color: selected ? theme.primary : theme.text }]}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[typography.caption, { color: theme.textMuted }]}>{subtitle}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.sm },
  choice: { borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, gap: 2 },
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
