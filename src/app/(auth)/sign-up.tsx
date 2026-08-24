import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { CCInput } from '@/components/cc-input';
import { GlassCard } from '@/components/glass-card';
import { spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

type Role = 'client' | 'stylist' | 'owner';

const COPY: Record<Role, { title: string; blurb: string }> = {
  client: { title: 'Create your account', blurb: 'So you can book and keep track of appointments' },
  stylist: { title: 'Join the salon', blurb: 'Enter the invite code from your salon owner' },
  owner: { title: 'Set up your salon', blurb: 'You will be the owner and a working stylist' },
};

export default function SignUp() {
  const { theme } = useTheme();
  const { signUp, refreshMemberships } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ role?: string }>();
  const role: Role =
    params.role === 'stylist' ? 'stylist' : params.role === 'owner' ? 'owner' : 'client';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [salonName, setSalonName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);

    const res = await signUp(email, password, fullName);
    if (res.error) {
      setBusy(false);
      setError(res.error);
      return;
    }
    if (res.needsConfirmation) {
      setBusy(false);
      setAwaitingConfirmation(true);
      return;
    }

    // The role picked on the previous screen decides what happens next. Doing
    // this here rather than after landing keeps the promise the door made.
    if (role === 'stylist') {
      const { error: err } = await supabase.rpc('claim_stylist_invitation', {
        p_code: inviteCode.trim().toUpperCase(),
      });
      if (err) {
        setBusy(false);
        // The account exists; only the code failed. Say so plainly rather than
        // implying signup itself broke.
        setError(`${err.message} — your account was created, so you can sign in and try the code again.`);
        return;
      }
    } else if (role === 'owner') {
      const { error: err } = await supabase.rpc('create_salon', {
        salon_name: salonName.trim(),
        salon_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'America/New_York',
      });
      if (err) {
        setBusy(false);
        setError(err.message);
        return;
      }
    }

    await refreshMemberships();
    setBusy(false);

    // Route on what we just did, not on context state. refreshMemberships
    // resolves when the fetch completes, but the React state update it queues
    // has not necessarily reached the index route by the time it renders —
    // which sent a freshly-claimed stylist to the client screen.
    router.replace(role === 'client' ? '/(app)/client' : '/(app)/staff');
  };

  const canSubmit =
    fullName.trim().length > 1 &&
    email.trim().length > 0 &&
    password.length >= 8 &&
    (role !== 'stylist' || inviteCode.trim().length >= 4) &&
    (role !== 'owner' || salonName.trim().length > 1) &&
    !busy;

  if (awaitingConfirmation) {
    return (
      <AmbientBackground>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.centered}>
            <GlassCard rounded="xl">
              <View style={styles.form}>
                <Text style={[typography.title, { color: theme.text }]}>Check your email</Text>
                <Text style={[typography.body, { color: theme.textMuted }]}>
                  We sent a confirmation link to {email.trim()}. Open it, then come back
                  and sign in.
                </Text>
                <CCButton
                  label="Back to sign in"
                  variant="primary"
                  fullWidth
                  onPress={() => router.replace('/sign-in')}
                />
              </View>
            </GlassCard>
          </View>
        </SafeAreaView>
      </AmbientBackground>
    );
  }

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.brand}>
              <Text style={[typography.display, { color: theme.text }]}>{COPY[role].title}</Text>
              <Text style={[typography.caption, { color: theme.textMuted }]}>
                {COPY[role].blurb}
              </Text>
            </View>

            <GlassCard rounded="xl">
              <View style={styles.form}>
                {role === 'stylist' ? (
                  <CCInput
                    label="Invite code"
                    placeholder="ABC123"
                    value={inviteCode}
                    onChangeText={(v) => setInviteCode(v.toUpperCase())}
                    autoCapitalize="characters"
                    maxLength={8}
                    hint="Six characters, from your salon owner"
                  />
                ) : null}

                {role === 'owner' ? (
                  <CCInput
                    label="Salon name"
                    placeholder="CosmoCutie Salon"
                    value={salonName}
                    onChangeText={setSalonName}
                  />
                ) : null}

                <CCInput
                  label="Full name"
                  placeholder="Dana Rivera"
                  value={fullName}
                  onChangeText={setFullName}
                  autoComplete="name"
                  textContentType="name"
                />
                <CCInput
                  label="Email"
                  placeholder="you@example.com"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                />
                <CCInput
                  label="Password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  error={
                    error ?? (password.length > 0 && password.length < 8 ? 'Too short' : undefined)
                  }
                />
                <CCButton
                  label={busy ? 'Creating…' : COPY[role].title}
                  variant="primary"
                  fullWidth
                  disabled={!canSubmit}
                  onPress={submit}
                />
              </View>
            </GlassCard>

            <View style={styles.footer}>
              <Text style={[typography.caption, { color: theme.textMuted }]}>
                Wrong option?
              </Text>
              <Link href="/join" style={[typography.label, { color: theme.primary }]}>
                Go back
              </Link>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AmbientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.xl },
  centered: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  brand: { alignItems: 'center', gap: 4 },
  form: { gap: spacing.md },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.sm },
});
