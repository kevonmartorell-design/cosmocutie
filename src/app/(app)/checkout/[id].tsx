import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { GlassCard } from '@/components/glass-card';
import { Loading } from '@/components/loading';
import { alpha, radius, spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { payBalance } from '@/payments/checkout';
import { useTheme } from '@/theme/theme-provider';

type Line = { name: string; price_cents: number };

const TIP_PERCENTS = [0, 15, 18, 20, 25];

/**
 * Closing out a service.
 *
 * Two steps that are deliberately separate: recording what is owed, and taking
 * it. A stylist whose client pays in cash still needs the first, and pretending
 * the two are one thing would make a cash sale impossible to record.
 *
 * A captured deposit comes off the balance rather than being charged again —
 * it is money already taken, and double-charging it is the single most
 * chargeback-prone mistake a salon app can make.
 */
export default function Checkout() {
  const { theme } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [lines, setLines] = useState<Line[] | null>(null);
  const [depositCents, setDepositCents] = useState(0);
  const [tipPercent, setTipPercent] = useState(0);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;

    const [{ data: services }, { data: payments }] = await Promise.all([
      supabase
        .from('appointment_services')
        .select('price_cents, services(name)')
        .eq('appointment_id', id),
      supabase
        .from('payments')
        .select('id, kind, status, amount_cents, tip_cents')
        .eq('appointment_id', id),
    ]);

    setLines(
      (services ?? []).map((row: any) => ({
        name: row.services?.name ?? 'Service',
        price_cents: row.price_cents,
      })),
    );

    // Only a CAPTURED deposit reduces the balance. One still merely authorised
    // has not taken any money, so subtracting it would undercharge.
    setDepositCents(
      (payments ?? [])
        .filter((p: any) => p.kind === 'deposit' && p.status === 'captured')
        .reduce((a: number, p: any) => a + p.amount_cents, 0),
    );

    const existing = (payments ?? []).find((p: any) => p.kind === 'service');
    if (existing) {
      setPaymentId(existing.id);
      setSettled(existing.status === 'captured');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (lines === null) return <Loading label="Opening checkout" />;

  const servicesCents = lines.reduce((a, l) => a + l.price_cents, 0);
  const afterDeposit = Math.max(servicesCents - depositCents, 0);
  const tipCents = Math.round((servicesCents * tipPercent) / 100);
  const dueCents = afterDeposit + tipCents;

  const recordCheckout = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('record_checkout', {
      p_appointment_id: id,
      p_tip_cents: tipCents,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setPaymentId(data as string);
  };

  const takeCard = async () => {
    if (!paymentId) return;
    setBusy(true);
    setError(null);
    const result = await payBalance(paymentId);
    setBusy(false);
    if (result.status === 'error') {
      setError(result.message);
      return;
    }
    await load();
  };

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View>
            <Text style={[typography.caption, { color: theme.textMuted }]}>CHECKOUT</Text>
            <Text style={[typography.display, { color: theme.text }]}>
              ${(dueCents / 100).toFixed(2)}
            </Text>
          </View>

          <GlassCard>
            <View style={styles.card}>
              {lines.map((l, i) => (
                <View key={i} style={styles.row}>
                  <Text style={[typography.body, { color: theme.text, flex: 1 }]}>{l.name}</Text>
                  <Text style={[typography.body, { color: theme.text }]}>
                    ${(l.price_cents / 100).toFixed(2)}
                  </Text>
                </View>
              ))}

              {depositCents > 0 ? (
                <View style={styles.row}>
                  <Text style={[typography.body, { color: theme.primary, flex: 1 }]}>
                    Deposit already paid
                  </Text>
                  <Text style={[typography.body, { color: theme.primary }]}>
                    −${(depositCents / 100).toFixed(2)}
                  </Text>
                </View>
              ) : null}

              {tipCents > 0 ? (
                <View style={styles.row}>
                  <Text style={[typography.body, { color: theme.text, flex: 1 }]}>Tip</Text>
                  <Text style={[typography.body, { color: theme.text }]}>
                    ${(tipCents / 100).toFixed(2)}
                  </Text>
                </View>
              ) : null}
            </View>
          </GlassCard>

          {paymentId ? null : (
            <>
              <Text style={[typography.label, { color: theme.textMuted }]}>TIP</Text>
              <View style={styles.tips}>
                {TIP_PERCENTS.map((p) => {
                  const active = p === tipPercent;
                  return (
                    <Pressable
                      key={p}
                      onPress={() => setTipPercent(p)}
                      style={[
                        styles.tip,
                        {
                          backgroundColor: active
                            ? alpha(theme.primary, 0.18)
                            : theme.glass.fallbackSurface,
                          borderColor: active ? theme.primary : theme.border,
                        },
                      ]}>
                      <Text
                        style={[
                          typography.body,
                          { color: active ? theme.primary : theme.textMuted },
                        ]}>
                        {p === 0 ? 'None' : `${p}%`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {settled ? (
            <GlassCard rounded="md">
              <Text style={[typography.heading, { color: theme.primary }]}>Paid</Text>
              <Text style={[typography.caption, { color: theme.textMuted }]}>
                This appointment is closed out.
              </Text>
            </GlassCard>
          ) : paymentId ? (
            <>
              <GlassCard rounded="md">
                <Text style={[typography.caption, { color: theme.textMuted }]}>
                  Recorded as owed. Take it by card below, or leave it if the client is
                  paying another way.
                </Text>
              </GlassCard>
              <CCButton
                label={busy ? 'Opening Stripe…' : `Take $${(dueCents / 100).toFixed(2)} by card`}
                variant="primary"
                fullWidth
                disabled={busy}
                onPress={takeCard}
              />
            </>
          ) : (
            <CCButton
              label={busy ? 'Recording…' : 'Complete service'}
              variant="primary"
              fullWidth
              disabled={busy}
              onPress={recordCheckout}
            />
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
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  tip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
