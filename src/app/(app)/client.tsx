import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { supabase } from '@/lib/supabase';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { GlassCard } from '@/components/glass-card';
import { spacing, typography } from '@/constants/theme';
import { useTheme } from '@/theme/theme-provider';

/**
 * Client home. Shell for now — booking lands in Phase 3, the feed in Phase 8,
 * and the shop in Phase 10. Built early so the navigation structure exists
 * before features are bolted onto it.
 */
export default function ClientHome() {
  const { theme } = useTheme();
  const { user, signOut, refreshMemberships } = useAuth();
  const router = useRouter();
  const [checkingInvite, setCheckingInvite] = useState(true);

  // Two kinds of pending invitation resolve here, so a newly signed-up person
  // never has to be told about a separate step:
  //   · a stylist invited by the salon owner (matched on email)
  //   · a client who opened a stylist's link before having an account
  useEffect(() => {
    let active = true;

    const settle = async () => {
      const { data: chair } = await supabase.rpc('claim_stylist_invitation');
      if (!active) return;
      if (chair) {
        await refreshMemberships();
        router.replace('/(app)/staff');
        return;
      }

      let pending: string | null = null;
      try {
        pending = globalThis.localStorage?.getItem('cosmocutie.pending-invite') ?? null;
      } catch {
        // Storage unavailable; nothing to reapply.
      }
      if (pending) {
        await supabase.rpc('claim_client_invite', { p_token: pending });
        try {
          globalThis.localStorage?.removeItem('cosmocutie.pending-invite');
        } catch {
          // Best effort.
        }
      }
      if (active) setCheckingInvite(false);
    };

    void settle();
    return () => {
      active = false;
    };
  }, [refreshMemberships, router]);

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View>
            <Text style={[typography.display, { color: theme.text }]}>
              Hi {(user?.user_metadata?.full_name ?? '').split(' ')[0] || 'there'}
            </Text>
            <Text style={[typography.caption, { color: theme.textMuted }]}>
              Your appointments and stylists
            </Text>
          </View>

          <GlassCard rounded="xl">
            <View style={styles.card}>
              <Text style={[typography.heading, { color: theme.text }]}>Book an appointment</Text>
              <Text style={[typography.body, { color: theme.textMuted }]}>
                Pick a stylist, choose your services, and request a time.
              </Text>
              <CCButton
                label="Find a time"
                variant="primary"
                onPress={() => router.push('/(app)/book')}
              />
              <CCButton
                label="My requests"
                variant="ghost"
                onPress={() => router.push('/(app)/requests')}
              />
            </View>
          </GlassCard>

          <GlassCard rounded="xl">
            <View style={styles.card}>
              <Text style={[typography.heading, { color: theme.text }]}>Run a salon?</Text>
              <Text style={[typography.body, { color: theme.textMuted }]}>
                Set up your salon and your own chair. You will be able to invite
                stylists, who each keep their own client book.
              </Text>
              <CCButton
                label="Set up my salon"
                variant="secondary"
                onPress={() => router.push('/(app)/setup-salon')}
              />
            </View>
          </GlassCard>

          <CCButton
            label="My CosmoCutie"
            variant="secondary"
            onPress={() => router.push('/(app)/account')}
          />

          <CCButton label="Sign out" variant="ghost" onPress={signOut} />
        </ScrollView>
      </SafeAreaView>
    </AmbientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.lg },
  card: { gap: spacing.sm },
});
