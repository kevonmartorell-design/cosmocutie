import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { GlassCard } from '@/components/glass-card';
import { Loading } from '@/components/loading';
import { spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

const PENDING_KEY = 'cosmocutie.pending-invite';

/**
 * Landing page for a stylist's client invite link.
 *
 * If the visitor is signed out the token is stashed and reapplied after they
 * sign up — without that, the invite is lost at exactly the moment it should
 * convert, and the new client lands on a generic home screen with no idea why
 * they are there.
 */
export default function JoinByToken() {
  const { theme } = useTheme();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session, ready } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<'working' | 'done' | 'invalid'>('working');

  useEffect(() => {
    if (!ready || !token) return;

    if (!session) {
      // Survive the round-trip through sign-up.
      try {
        globalThis.localStorage?.setItem(PENDING_KEY, token);
      } catch {
        // Storage unavailable; the user can re-open the link afterwards.
      }
      router.replace('/sign-up');
      return;
    }

    supabase.rpc('claim_client_invite', { p_token: token }).then(({ data }) => {
      setState(data ? 'done' : 'invalid');
    });
  }, [ready, session, token, router]);

  if (state === 'working') return <Loading label="Opening your invite" />;

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <GlassCard rounded="xl">
            <View style={styles.card}>
              <Text style={[typography.title, { color: theme.text }]}>
                {state === 'done' ? "You're all set" : 'Link not valid'}
              </Text>
              <Text style={[typography.body, { color: theme.textMuted }]}>
                {state === 'done'
                  ? 'Your stylist added you. Booking opens shortly.'
                  : 'This invite has already been used, or the link is incomplete.'}
              </Text>
              <CCButton
                label="Continue"
                variant="primary"
                fullWidth
                onPress={() => router.replace('/')}
              />
            </View>
          </GlassCard>
        </View>
      </SafeAreaView>
    </AmbientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  card: { gap: spacing.md },
});
