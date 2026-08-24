import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { CCModal } from '@/components/cc-modal';
import { GlassCard } from '@/components/glass-card';
import { Loading } from '@/components/loading';
import { spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

type Chair = {
  tenantId: string;
  name: string;
  stylistName: string | null;
  classification: string | null;
  rent: RentStatus | null;
};

/**
 * Rent, and only rent.
 *
 * The owner cannot see a renter's payment rows — that is the firewall, and it
 * holds. But "did my rent arrive?" is the owner's own rental income and a fair
 * question, so the outcome is mirrored onto `booth_rents`, which both parties
 * to the tenancy can read. This shows that and nothing else.
 */
type RentStatus = {
  amount_cents: number;
  interval: string;
  next_due_on: string;
  last_paid_at: string | null;
  last_failure: string | null;
  consecutive_fails: number;
};

/**
 * Salon admin view.
 *
 * Shows facility structure only — which chairs exist, who occupies them, and
 * how they are classified. Deliberately does NOT show a renter's clients,
 * revenue, or formulas: RLS would refuse the query anyway, and building a UI
 * that asks for it invites someone to "fix" the policy later.
 */
export default function SalonHome() {
  const { theme } = useTheme();
  const { adminTenant } = useAuth();
  const router = useRouter();

  const [chairs, setChairs] = useState<Chair[] | null>(null);
  const [offboarding, setOffboarding] = useState<Chair | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!adminTenant) return;

    // Child tenants are visible to an admin (structure), their contents are not.
    const { data: tenants, error } = await supabase
      .from('tenants')
      .select('id, name')
      .eq('parent_salon_id', adminTenant.tenantId);

    if (error) {
      console.error('[salon] failed to load chairs', error.message);
      setChairs([]);
      return;
    }

    const ids = (tenants ?? []).map((t) => t.id);

    // Who occupies each chair. Through an RPC rather than a join on `profiles`,
    // because RLS is row-level: any policy wide enough to expose a renter's
    // NAME would expose their phone and email on the same row. The function
    // returns the name and classification and nothing else.
    const { data: members } = await supabase.rpc('chair_occupants');

    const { data: rents } = ids.length
      ? await supabase
          .from('booth_rents')
          .select('chair_id, amount_cents, interval, next_due_on, last_paid_at, last_failure, consecutive_fails')
          .in('chair_id', ids)
      : { data: [] as never[] };

    setChairs(
      (tenants ?? []).map((t) => {
        const m = (members ?? []).find((x) => x.tenant_id === t.id);
        const rent = (rents ?? []).find((x: any) => x.chair_id === t.id) ?? null;
        return {
          rent: (rent as RentStatus) ?? null,
          tenantId: t.id,
          name: t.name,
          stylistName: m?.full_name ?? null,
          classification: m?.classification ?? null,
        };
      }),
    );
  }, [adminTenant]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!adminTenant) {
    return (
      <AmbientBackground>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.centered}>
            <GlassCard>
              <Text style={[typography.body, { color: theme.textMuted }]}>
                You do not administer a salon.
              </Text>
            </GlassCard>
          </View>
        </SafeAreaView>
      </AmbientBackground>
    );
  }

  if (chairs === null) return <Loading label="Loading salon" />;

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View>
            <Text style={[typography.caption, { color: theme.textMuted }]}>MY SALON</Text>
            <Text style={[typography.display, { color: theme.text }]}>
              {adminTenant.tenantName}
            </Text>
          </View>

          <View style={styles.stats}>
            <Stat label="Chairs" value={String(chairs.length)} />
            <Stat
              label="Occupied"
              value={String(chairs.filter((c) => c.stylistName).length)}
            />
          </View>

          <Text style={[typography.label, { color: theme.textMuted }]}>CHAIRS</Text>

          {chairs.length === 0 ? (
            <GlassCard>
              <View style={styles.card}>
                <Text style={[typography.heading, { color: theme.text }]}>No chairs yet</Text>
                <Text style={[typography.body, { color: theme.textMuted }]}>
                  Invite a stylist to create their chair. Stylists cannot register
                  themselves — you control who works here.
                </Text>
              </View>
            </GlassCard>
          ) : (
            chairs.map((c) => (
              <GlassCard key={c.tenantId}>
                <View style={styles.chairRow}>
                  <View style={styles.chairText}>
                    <Text style={[typography.heading, { color: theme.text }]}>{c.name}</Text>
                    <Text style={[typography.caption, { color: theme.textMuted }]}>
                      {c.stylistName ?? 'Unoccupied'}
                      {c.classification ? ` · ${labelFor(c.classification)}` : ''}
                    </Text>
                  </View>
                  {c.stylistName ? (
                    <CCButton
                      label="Offboard"
                      variant="ghost"
                      onPress={() => setOffboarding(c)}
                    />
                  ) : null}
                </View>

                {/* Rent status only. Whether it arrived, never what they earned. */}
                {c.rent ? (
                  <View style={styles.rentRow}>
                    <Text style={[typography.caption, { color: theme.textMuted, flex: 1 }]}>
                      ${(c.rent.amount_cents / 100).toFixed(0)} {c.rent.interval} · due{' '}
                      {new Date(c.rent.next_due_on).toLocaleDateString()}
                    </Text>
                    {c.rent.last_failure ? (
                      <Text style={[typography.caption, { color: theme.danger }]}>
                        {c.rent.consecutive_fails > 1
                          ? `Unpaid (${c.rent.consecutive_fails} attempts)`
                          : 'Payment failed'}
                      </Text>
                    ) : c.rent.last_paid_at ? (
                      <Text style={[typography.caption, { color: theme.primary }]}>
                        Paid {new Date(c.rent.last_paid_at).toLocaleDateString()}
                      </Text>
                    ) : (
                      <Text style={[typography.caption, { color: theme.textMuted }]}>
                        Not yet due
                      </Text>
                    )}
                  </View>
                ) : null}
              </GlassCard>
            ))
          )}

          <CCButton
            label="Invite a stylist"
            variant="primary"
            fullWidth
            onPress={() => router.push('/(app)/invite')}
          />
          <CCButton label="Back" variant="ghost" onPress={() => router.back()} />
        </ScrollView>
      </SafeAreaView>

      <CCModal
        visible={offboarding !== null}
        title={`Offboard ${offboarding?.stylistName ?? ''}?`}
        onDismiss={() => setOffboarding(null)}>
        <Text style={[typography.body, { color: theme.textMuted }]}>
          They lose access and stop appearing to clients, and their upcoming
          appointments are cancelled with clients notified.
        </Text>
        <Text style={[typography.body, { color: theme.text }]}>
          Their client book, formulas and history are NOT deleted — that data is
          theirs and must be exported to them first.
        </Text>
        <CCButton
          label={busy ? 'Working…' : 'Offboard'}
          variant="danger"
          fullWidth
          disabled={busy}
          onPress={async () => {
            if (!offboarding) return;
            setBusy(true);
            await supabase.rpc('offboard_stylist', { p_chair_id: offboarding.tenantId });
            setBusy(false);
            setOffboarding(null);
            await load();
          }}
        />
        <CCButton label="Cancel" variant="ghost" fullWidth onPress={() => setOffboarding(null)} />
      </CCModal>
    </AmbientBackground>
  );
}

const labelFor = (c: string) =>
  ({
    contractor_1099: '1099 renter',
    employee_w2: 'W-2 employee',
    owner_operator: 'Owner',
  })[c] ?? c;

function Stat({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <GlassCard style={styles.stat} rounded="md">
      <Text style={[typography.display, { color: theme.primary }]}>{value}</Text>
      <Text style={[typography.caption, { color: theme.textMuted }]}>{label}</Text>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  rentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  safe: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.md },
  centered: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  stats: { flexDirection: 'row', gap: spacing.md },
  stat: { flex: 1 },
  card: { gap: spacing.sm },
  chairRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chairText: { gap: 2, flex: 1 },
});
