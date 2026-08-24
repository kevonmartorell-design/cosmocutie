import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { GlassCard } from '@/components/glass-card';
import { alpha, radius, spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

/**
 * The first screen a new person sees.
 *
 * Role is chosen BEFORE the account exists. The earlier flow created an account
 * and then asked what to do with it, which puts the explanation in the wrong
 * order — someone knows who they are before they know what a "tenant" is.
 */
export default function Join() {
  const { theme } = useTheme();
  const router = useRouter();
  const [salonSignupAvailable, setSalonSignupAvailable] = useState(false);

  useEffect(() => {
    // Callable without a session: the screen must know whether to draw the
    // salon door before anyone has signed in. Returns only a boolean, so
    // nothing about the salon itself leaks to a stranger.
    supabase
      .rpc('salon_signup_available')
      .then(({ data }) => setSalonSignupAvailable(data === true));
  }, []);

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.brand}>
            <Text style={[typography.display, { color: theme.text }]}>CosmoCutie</Text>
            <Text style={[typography.body, { color: theme.textMuted }]}>
              What brings you here?
            </Text>
          </View>

          <Door
            title="I'm booking appointments"
            blurb="Browse stylists, request a time, and keep your appointments in one place."
            onPress={() => router.push({ pathname: '/sign-up', params: { role: 'client' } })}
          />

          <Door
            title="I work at this salon"
            blurb="You'll need the invite code from your salon owner."
            onPress={() => router.push({ pathname: '/sign-up', params: { role: 'stylist' } })}
          />

          {/* Shown only until a salon exists. This app holds one salon, so the
              door closes itself the moment the owner walks through it — no
              setting to remember, and no way for a stranger to set up shop
              inside someone else's app. */}
          {salonSignupAvailable ? (
            <Door
              title="I run this salon"
              blurb="Set up your salon, invite your stylists, and manage the floor."
              onPress={() => router.push({ pathname: '/sign-up', params: { role: 'owner' } })}
            />
          ) : null}

          <View style={styles.footer}>
            <Text style={[typography.caption, { color: theme.textMuted }]}>
              Already have an account?
            </Text>
            <CCButton label="Sign in" variant="ghost" onPress={() => router.push('/sign-in')} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </AmbientBackground>
  );
}

function Door({
  title,
  blurb,
  onPress,
}: {
  title: string;
  blurb: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress}>
      <GlassCard rounded="xl">
        <View style={styles.door}>
          <Text style={[typography.title, { color: theme.text }]}>{title}</Text>
          <Text style={[typography.body, { color: theme.textMuted }]}>{blurb}</Text>
          <View style={[styles.chevron, { backgroundColor: alpha(theme.primary, 0.16) }]}>
            <Text style={[typography.label, { color: theme.primary }]}>Continue →</Text>
          </View>
        </View>
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  brand: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  door: { gap: spacing.sm },
  chevron: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.sm },
});
