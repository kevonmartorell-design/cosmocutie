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

  // Someone invited as a stylist signs up like anyone else. Claiming here means
  // they land in their chair automatically rather than having to be told about
  // a separate step.
  useEffect(() => {
    let active = true;
    supabase
      .rpc('claim_stylist_invitation')
      .then(async ({ data }) => {
        if (!active) return;
        if (data) {
          await refreshMemberships();
          router.replace('/(app)/staff');
          return;
        }
        setCheckingInvite(false);
      });
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
              <Text style={[typography.heading, { color: theme.text }]}>No appointments yet</Text>
              <Text style={[typography.body, { color: theme.textMuted }]}>
                Booking opens in the next phase. Your stylist can also send you an
                invite link to get started.
              </Text>
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
