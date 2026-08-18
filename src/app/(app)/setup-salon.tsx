import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { CCInput } from '@/components/cc-input';
import { GlassCard } from '@/components/glass-card';
import { spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

/** First run for an owner. Creates the salon and their own chair together. */
export default function SetupSalon() {
  const { theme } = useTheme();
  const { refreshMemberships } = useAuth();
  const router = useRouter();

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.rpc('create_salon', {
      salon_name: name,
      salon_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'America/New_York',
    });
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    await refreshMemberships();
    setBusy(false);
    router.replace('/(app)/staff');
  };

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View>
            <Text style={[typography.display, { color: theme.text }]}>Set up your salon</Text>
            <Text style={[typography.caption, { color: theme.textMuted }]}>
              This creates the salon and your own chair
            </Text>
          </View>

          <GlassCard rounded="xl">
            <View style={styles.form}>
              <CCInput
                label="Salon name"
                placeholder="CosmoCutie Salon"
                value={name}
                onChangeText={setName}
                error={error ?? undefined}
              />
              <Text style={[typography.caption, { color: theme.textMuted }]}>
                You will be set up as the owner and as a working stylist with your
                own chair. Your chair is kept separate from the salon, so your
                client book stays yours — exactly like any stylist who rents here.
              </Text>
              <CCButton
                label={busy ? 'Creating…' : 'Create salon'}
                variant="primary"
                fullWidth
                disabled={name.trim().length < 2 || busy}
                onPress={submit}
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
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.lg },
  form: { gap: spacing.md },
});
