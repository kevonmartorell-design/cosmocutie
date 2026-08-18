import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { CCInput } from '@/components/cc-input';
import { GlassCard } from '@/components/glass-card';
import { spacing, typography } from '@/constants/theme';
import { useTheme } from '@/theme/theme-provider';

export default function SignUp() {
  const { theme } = useTheme();
  const { signUp } = useAuth();
  const router = useRouter();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    const res = await signUp(email, password, fullName);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.needsConfirmation) {
      setAwaitingConfirmation(true);
      return;
    }
    router.replace('/');
  };

  const canSubmit =
    fullName.trim().length > 1 && email.trim().length > 0 && password.length >= 8 && !busy;

  if (awaitingConfirmation) {
    return (
      <AmbientBackground>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.centered}>
            <GlassCard rounded="xl">
              <View style={styles.form}>
                <Text style={[typography.title, { color: theme.text }]}>Check your email</Text>
                <Text style={[typography.body, { color: theme.textMuted }]}>
                  We sent a confirmation link to {email.trim()}. Open it, then come
                  back and sign in.
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
              <Text style={[typography.display, { color: theme.text }]}>CosmoCutie</Text>
              <Text style={[typography.caption, { color: theme.textMuted }]}>
                Create your account
              </Text>
            </View>

            <GlassCard rounded="xl">
              <View style={styles.form}>
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
                  hint={password.length > 0 && password.length < 8 ? undefined : 'Minimum 8 characters'}
                  error={
                    error ??
                    (password.length > 0 && password.length < 8 ? 'Too short' : undefined)
                  }
                />
                <CCButton
                  label={busy ? 'Creating…' : 'Create account'}
                  variant="primary"
                  fullWidth
                  disabled={!canSubmit}
                  onPress={submit}
                />
              </View>
            </GlassCard>

            <View style={styles.footer}>
              <Text style={[typography.caption, { color: theme.textMuted }]}>
                Already have an account?
              </Text>
              <Link href="/sign-in" style={[typography.label, { color: theme.primary }]}>
                Sign in
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
