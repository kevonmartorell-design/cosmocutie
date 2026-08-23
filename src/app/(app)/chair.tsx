import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { GlassCard } from '@/components/glass-card';
import { Loading } from '@/components/loading';
import { spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

type Settings = {
  requires_deposit: boolean;
  deposit_percent: number;
  buffer_minutes: number;
  arrival_note: string;
};

type ServiceRow = { id: string; name: string; duration_minutes: number; price_cents: number };

/**
 * A stylist's own workspace: their menu, their policies, their book.
 *
 * Everything here is scoped to their tenant. The salon owner cannot read it,
 * and that is enforced by RLS rather than by this screen choosing not to ask.
 */
export default function ChairHome() {
  const { theme } = useTheme();
  const { stylistTenants } = useAuth();
  const router = useRouter();
  const tenant = stylistTenants[0] ?? null;

  const [settings, setSettings] = useState<Settings | null>(null);
  const [services, setServices] = useState<ServiceRow[] | null>(null);

  const load = useCallback(async () => {
    if (!tenant) return;
    const [{ data: s }, { data: svc }] = await Promise.all([
      supabase
        .from('stylist_settings')
        .select('requires_deposit, deposit_percent, buffer_minutes, arrival_note')
        .eq('tenant_id', tenant.tenantId)
        .maybeSingle(),
      supabase
        .from('services')
        .select('id, name, duration_minutes, price_cents')
        .eq('tenant_id', tenant.tenantId)
        .order('sort_order'),
    ]);
    setSettings(s ?? null);
    setServices(svc ?? []);
  }, [tenant]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleDeposit = async (next: boolean) => {
    if (!tenant || !settings) return;
    setSettings({ ...settings, requires_deposit: next }); // optimistic
    const { error } = await supabase
      .from('stylist_settings')
      .update({ requires_deposit: next })
      .eq('tenant_id', tenant.tenantId);
    if (error) {
      setSettings({ ...settings, requires_deposit: !next }); // revert
      console.error('[chair] deposit toggle failed', error.message);
    }
  };

  if (!tenant) {
    return (
      <AmbientBackground>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.centered}>
            <GlassCard>
              <Text style={[typography.body, { color: theme.textMuted }]}>
                You do not have a chair yet.
              </Text>
            </GlassCard>
          </View>
        </SafeAreaView>
      </AmbientBackground>
    );
  }

  if (services === null) return <Loading label="Loading your chair" />;

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View>
            <Text style={[typography.caption, { color: theme.textMuted }]}>MY CHAIR</Text>
            <Text style={[typography.display, { color: theme.text }]}>{tenant.tenantName}</Text>
          </View>

          <Text style={[typography.label, { color: theme.textMuted }]}>SERVICE MENU</Text>
          {services.length === 0 ? (
            <GlassCard>
              <View style={styles.card}>
                <Text style={[typography.heading, { color: theme.text }]}>No services yet</Text>
                <Text style={[typography.body, { color: theme.textMuted }]}>
                  Your menu, pricing and durations are yours alone — nobody else
                  sets them for you.
                </Text>
              </View>
            </GlassCard>
          ) : (
            services.map((s) => (
              <GlassCard key={s.id} rounded="md">
                <View style={styles.serviceRow}>
                  <View style={styles.serviceText}>
                    <Text style={[typography.heading, { color: theme.text }]}>{s.name}</Text>
                    <Text style={[typography.caption, { color: theme.textMuted }]}>
                      {s.duration_minutes} min
                    </Text>
                  </View>
                  <Text style={[typography.heading, { color: theme.primary }]}>
                    ${(s.price_cents / 100).toFixed(0)}
                  </Text>
                </View>
              </GlassCard>
            ))
          )}
          <CCButton
            label="Add a service"
            variant="secondary"
            onPress={() => router.push('/(app)/service-new')}
          />

          <Text style={[typography.label, { color: theme.textMuted }]}>POLICIES</Text>
          <GlassCard>
            <View style={styles.settingRow}>
              <View style={styles.serviceText}>
                <Text style={[typography.heading, { color: theme.text }]}>Require deposit</Text>
                <Text style={[typography.caption, { color: theme.textMuted }]}>
                  {settings?.requires_deposit
                    ? `${settings.deposit_percent}% held at booking`
                    : 'Off — no card is held'}
                </Text>
              </View>
              <Switch
                value={settings?.requires_deposit ?? false}
                onValueChange={toggleDeposit}
                trackColor={{ true: theme.primary, false: theme.border }}
              />
            </View>
          </GlassCard>

          <GlassCard>
            <View style={styles.card}>
              <Text style={[typography.label, { color: theme.textMuted }]}>BUFFER</Text>
              <Text style={[typography.body, { color: theme.text }]}>
                {settings?.buffer_minutes ?? 30} minutes between appointments
              </Text>
              <Text style={[typography.caption, { color: theme.textMuted }]}>
                {settings?.arrival_note}
              </Text>
            </View>
          </GlassCard>

          <Text style={[typography.label, { color: theme.textMuted }]}>YOUR CHAIR</Text>
          <GlassCard>
            <View style={styles.card}>
              <CCButton
                label="Booking requests"
                variant="primary"
                fullWidth
                onPress={() => router.push('/(app)/requests')}
              />
              <CCButton
                label="Appointments"
                variant="secondary"
                fullWidth
                onPress={() => router.push('/(app)/appointments')}
              />
              <CCButton
                label="My clients"
                variant="secondary"
                fullWidth
                onPress={() => router.push('/(app)/clients')}
              />
              <CCButton
                label="Edit profile"
                variant="secondary"
                fullWidth
                onPress={() => router.push('/(app)/profile')}
              />
              <CCButton
                label="Set your hours"
                variant="secondary"
                fullWidth
                onPress={() => router.push('/(app)/hours')}
              />
              <CCButton
                label="Invite a client"
                variant="secondary"
                fullWidth
                onPress={() => router.push('/(app)/invite-client')}
              />
            </View>
          </GlassCard>

          <CCButton label="Back" variant="ghost" onPress={() => router.back()} />
        </ScrollView>
      </SafeAreaView>
    </AmbientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.md },
  centered: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  card: { gap: spacing.sm },
  serviceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  serviceText: { gap: 2, flex: 1 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
