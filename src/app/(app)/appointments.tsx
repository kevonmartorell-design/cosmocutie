import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { formatSlot } from '@/booking/negotiation';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { CCModal } from '@/components/cc-modal';
import { GlassCard } from '@/components/glass-card';
import { Loading } from '@/components/loading';
import { spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

type Appt = {
  id: string;
  tenant_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  total_price_cents: number;
  pending_starts_at: string | null;
  pending_requested_by: string | null;
  is_for_child: boolean;
  child_first_name: string | null;
};

/**
 * Appointments, upcoming and past.
 *
 * One screen for both roles: RLS returns a stylist their tenant's appointments
 * and a client their own, so the query does not branch on identity — only the
 * available actions do.
 */
export default function Appointments() {
  const { theme } = useTheme();
  const { stylistTenants, user } = useAuth();
  const router = useRouter();

  const [rows, setRows] = useState<Appt[] | null>(null);
  const [confirming, setConfirming] = useState<Appt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('appointments')
      .select(
        'id, tenant_id, starts_at, ends_at, status, total_price_cents, pending_starts_at, pending_requested_by, is_for_child, child_first_name',
      )
      .order('starts_at', { ascending: false })
      .limit(50);
    setRows((data as Appt[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isStylist = (a: Appt) => stylistTenants.some((t) => t.tenantId === a.tenant_id);

  const cancel = async () => {
    if (!confirming) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('cancel_appointment', {
      p_appointment_id: confirming.id,
    });
    setBusy(false);
    setConfirming(null);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  };

  const respondMove = async (a: Appt, accept: boolean) => {
    setBusy(true);
    const { error: err } = await supabase.rpc('respond_appointment_reschedule', {
      p_appointment_id: a.id,
      p_accept: accept,
    });
    setBusy(false);
    if (err) setError(err.message);
    await load();
  };

  const noShow = async (a: Appt) => {
    setBusy(true);
    const { error: err } = await supabase.rpc('mark_no_show', { p_appointment_id: a.id });
    setBusy(false);
    if (err) setError(err.message);
    await load();
  };

  if (rows === null) return <Loading label="Loading appointments" />;

  const now = Date.now();
  const upcoming = rows.filter(
    (a) => a.status === 'confirmed' && new Date(a.starts_at).getTime() > now,
  );
  const past = rows.filter((a) => !upcoming.includes(a));

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[typography.display, { color: theme.text }]}>Appointments</Text>

          {upcoming.length === 0 ? (
            <GlassCard>
              <Text style={[typography.body, { color: theme.textMuted }]}>
                Nothing coming up.
              </Text>
            </GlassCard>
          ) : (
            upcoming.map((a) => {
              const mine = isStylist(a);
              const theyProposed = a.pending_starts_at && a.pending_requested_by !== user?.id;
              const iProposed = a.pending_starts_at && a.pending_requested_by === user?.id;
              const started = new Date(a.starts_at).getTime() < now;

              return (
                <GlassCard key={a.id} rounded="xl">
                  <View style={styles.card}>
                    <View>
                      <Text style={[typography.heading, { color: theme.text }]}>
                        {formatSlot(a.starts_at)}
                      </Text>
                      <Text style={[typography.caption, { color: theme.textMuted }]}>
                        ${(a.total_price_cents / 100).toFixed(0)}
                        {a.is_for_child ? ` · for ${a.child_first_name}` : ''}
                      </Text>
                    </View>

                    {theyProposed ? (
                      <View style={styles.pending}>
                        <Text style={[typography.caption, { color: theme.primary }]}>
                          Move requested to {formatSlot(a.pending_starts_at!)}
                        </Text>
                        <View style={styles.actions}>
                          <CCButton
                            label="Accept move"
                            variant="primary"
                            disabled={busy}
                            onPress={() => respondMove(a, true)}
                          />
                          <CCButton
                            label="Keep original"
                            variant="ghost"
                            disabled={busy}
                            onPress={() => respondMove(a, false)}
                          />
                        </View>
                      </View>
                    ) : iProposed ? (
                      <Text style={[typography.caption, { color: theme.textMuted }]}>
                        Move to {formatSlot(a.pending_starts_at!)} — waiting on the other side
                      </Text>
                    ) : (
                      <View style={styles.actions}>
                        <CCButton
                          label="Reschedule"
                          variant="secondary"
                          disabled={busy}
                          onPress={() =>
                            router.push({
                              pathname: '/(app)/reschedule/[id]',
                              params: { id: a.id },
                            })
                          }
                        />
                        <CCButton
                          label="Cancel"
                          variant="danger"
                          disabled={busy}
                          onPress={() => setConfirming(a)}
                        />
                        {mine && started ? (
                          <CCButton
                            label="No-show"
                            variant="ghost"
                            disabled={busy}
                            onPress={() => noShow(a)}
                          />
                        ) : null}
                      </View>
                    )}
                  </View>
                </GlassCard>
              );
            })
          )}

          {past.length > 0 ? (
            <>
              <Text style={[typography.label, { color: theme.textMuted }]}>PAST</Text>
              {past.slice(0, 10).map((a) => (
                <GlassCard key={a.id} rounded="md">
                  <View style={styles.row}>
                    <Text style={[typography.body, { color: theme.textMuted, flex: 1 }]}>
                      {formatSlot(a.starts_at)}
                    </Text>
                    <Text style={[typography.caption, { color: theme.textMuted }]}>
                      {a.status.replace('_', ' ')}
                    </Text>
                  </View>
                </GlassCard>
              ))}
            </>
          ) : null}

          {error ? (
            <Text style={[typography.caption, { color: theme.danger }]}>{error}</Text>
          ) : null}

          <CCButton label="Back" variant="ghost" onPress={() => router.back()} />
        </ScrollView>
      </SafeAreaView>

      <CCModal
        visible={confirming !== null}
        title="Cancel this appointment?"
        onDismiss={() => setConfirming(null)}>
        <Text style={[typography.body, { color: theme.textMuted }]}>
          {confirming && isStylist(confirming)
            ? 'The client is refunded in full and offered a rebooking.'
            : 'Cancelling close to the appointment may forfeit your deposit, per your stylist’s policy.'}
        </Text>
        <CCButton label="Cancel appointment" variant="danger" fullWidth onPress={cancel} />
        <CCButton label="Keep it" variant="ghost" fullWidth onPress={() => setConfirming(null)} />
      </CCModal>
    </AmbientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.md },
  card: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pending: { gap: spacing.sm },
});
