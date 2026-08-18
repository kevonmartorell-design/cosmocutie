import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import {
  ACTION_LABELS,
  availableActions,
  formatSlot,
  timeLeft,
  type NegotiationAction,
} from '@/booking/negotiation';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { CCInput } from '@/components/cc-input';
import { GlassCard } from '@/components/glass-card';
import { Loading } from '@/components/loading';
import { alpha, radius, spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

type Req = {
  id: string;
  tenant_id: string;
  status: string;
  proposed_starts_at: string;
  proposed_ends_at: string;
  stylist_offers_used: number;
  client_counters_used: number;
  step_deadline: string;
  deposit_required: boolean;
  deposit_amount_cents: number;
};

type Event = {
  id: string;
  actor: 'client' | 'stylist' | 'system';
  action: string;
  proposed_starts_at: string | null;
  note: string | null;
  created_at: string;
};

/**
 * The negotiation thread.
 *
 * Renders as a chat, but there is no messaging here: each bubble is one row of
 * the negotiation event log, and a note can only be composed alongside an
 * action. There is deliberately no free-text send — see PLAN.md → Communication
 * Policy. Do not add a message box to this screen.
 */
export default function RequestThread() {
  const { theme } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { stylistTenants } = useAuth();
  const router = useRouter();

  const [req, setReq] = useState<Req | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [note, setNote] = useState('');
  const [newTime, setNewTime] = useState<string | null>(null);
  const [slots, setSlots] = useState<{ slot_start: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: r }, { data: e }] = await Promise.all([
      supabase.from('booking_requests').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('negotiation_events')
        .select('id, actor, action, proposed_starts_at, note, created_at')
        .eq('request_id', id)
        .order('created_at'),
    ]);
    setReq((r as Req) ?? null);
    setEvents((e as Event[]) ?? []);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const isStylist = req ? stylistTenants.some((t) => t.tenantId === req.tenant_id) : false;
  const actions = req
    ? availableActions({
        status: req.status as never,
        isStylist,
        stylistOffersUsed: req.stylist_offers_used,
        clientCountersUsed: req.client_counters_used,
      })
    : [];

  const openPicker = async () => {
    if (!req) return;
    setPicking(true);
    const mins =
      (new Date(req.proposed_ends_at).getTime() - new Date(req.proposed_starts_at).getTime()) /
      60000;
    const day = new Date(req.proposed_starts_at).toISOString().slice(0, 10);
    const { data } = await supabase.rpc('available_slots', {
      p_tenant_id: req.tenant_id,
      p_date: day,
      p_duration_minutes: Math.round(mins),
    });
    setSlots(data ?? []);
  };

  const act = async (action: NegotiationAction) => {
    if (!req) return;
    if ((action === 'reschedule' || action === 'counter') && !newTime) {
      void openPicker();
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('respond_to_request', {
      p_request_id: req.id,
      p_action: action,
      p_new_starts_at: newTime ?? undefined,
      p_note: note.trim() || undefined,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setNote('');
    setNewTime(null);
    setPicking(false);
    await load();
  };

  if (!req) return <Loading label="Opening request" />;

  const live = req.status === 'awaiting_stylist' || req.status === 'awaiting_client';

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View>
            <Text style={[typography.title, { color: theme.text }]}>
              {formatSlot(req.proposed_starts_at)}
            </Text>
            <Text style={[typography.caption, { color: theme.textMuted }]}>
              {req.status === 'accepted'
                ? 'Confirmed'
                : live
                  ? timeLeft(req.step_deadline)
                  : req.status}
            </Text>
          </View>

          {req.deposit_required && live ? (
            <GlassCard rounded="md">
              <Text style={[typography.caption, { color: theme.textMuted }]}>
                ${(req.deposit_amount_cents / 100).toFixed(0)} held on your card until this is
                settled. Released automatically if it falls through.
              </Text>
            </GlassCard>
          ) : null}

          {/* The thread: one bubble per logged action. */}
          {events.map((ev) => {
            const mine = isStylist ? ev.actor === 'stylist' : ev.actor === 'client';
            const system = ev.actor === 'system';
            return (
              <View
                key={ev.id}
                style={[
                  styles.bubbleRow,
                  { justifyContent: system ? 'center' : mine ? 'flex-end' : 'flex-start' },
                ]}>
                <View
                  style={[
                    styles.bubble,
                    system
                      ? { backgroundColor: 'transparent' }
                      : {
                          backgroundColor: mine
                            ? alpha(theme.primary, 0.18)
                            : theme.glass.fallbackSurface,
                          borderColor: mine ? alpha(theme.primary, 0.4) : theme.border,
                          borderWidth: 1,
                        },
                  ]}>
                  <Text
                    style={[
                      typography.caption,
                      { color: system ? theme.textMuted : theme.textMuted },
                    ]}>
                    {system ? '' : ev.actor === 'stylist' ? 'Stylist' : 'You'}
                    {system ? '' : ' · '}
                    {ACTION_LABELS[ev.action] ?? ev.action}
                  </Text>
                  {ev.proposed_starts_at ? (
                    <Text style={[typography.heading, { color: theme.text }]}>
                      {formatSlot(ev.proposed_starts_at)}
                    </Text>
                  ) : null}
                  {ev.note ? (
                    <Text style={[typography.body, { color: theme.text }]}>{ev.note}</Text>
                  ) : null}
                </View>
              </View>
            );
          })}

          {/* Time picker, shown only when proposing a different time. */}
          {picking ? (
            <GlassCard rounded="md">
              <Text style={[typography.label, { color: theme.textMuted }]}>PICK A NEW TIME</Text>
              <View style={styles.slots}>
                {slots.length === 0 ? (
                  <Text style={[typography.caption, { color: theme.textMuted }]}>
                    Nothing else open that day.
                  </Text>
                ) : (
                  slots.map((s) => (
                    <CCButton
                      key={s.slot_start}
                      label={new Date(s.slot_start).toLocaleTimeString(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                      variant={newTime === s.slot_start ? 'primary' : 'ghost'}
                      onPress={() => setNewTime(s.slot_start)}
                    />
                  ))
                )}
              </View>
            </GlassCard>
          ) : null}

          {live && actions.length > 0 ? (
            <>
              <CCInput
                label="Add a note (optional)"
                placeholder="Sent with your reply"
                value={note}
                onChangeText={setNote}
                maxLength={200}
              />
              <View style={styles.actions}>
                {actions.map((a) => (
                  <CCButton
                    key={a}
                    label={
                      (a === 'reschedule' || a === 'counter') && !newTime
                        ? 'Suggest another time'
                        : ACTION_LABELS[a] ?? a
                    }
                    variant={a === 'accept' ? 'primary' : a === 'decline' || a === 'cancel' ? 'danger' : 'secondary'}
                    disabled={busy}
                    onPress={() => act(a)}
                  />
                ))}
              </View>
              {isStylist && req.stylist_offers_used >= 2 ? (
                <Text style={[typography.caption, { color: theme.textMuted }]}>
                  Final round — accept or decline.
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={[typography.caption, { color: theme.textMuted }]}>
              {live ? 'Waiting on the other side.' : 'This request is closed.'}
            </Text>
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
  scroll: { padding: spacing.lg, gap: spacing.sm },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '85%', borderRadius: radius.lg, padding: spacing.md, gap: 2 },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
