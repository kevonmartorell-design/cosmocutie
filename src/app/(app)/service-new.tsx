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

export default function NewService() {
  const { theme } = useTheme();
  const { stylistTenants } = useAuth();
  const router = useRouter();
  const tenant = stylistTenants[0] ?? null;

  const [name, setName] = useState('');
  const [duration, setDuration] = useState('60');
  const [price, setPrice] = useState('');
  const [processing, setProcessing] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!tenant) return;
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.from('services').insert({
      tenant_id: tenant.tenantId,
      name: name.trim(),
      duration_minutes: parseInt(duration, 10) || 60,
      price_cents: Math.round((parseFloat(price) || 0) * 100),
      processing_window_minutes: parseInt(processing, 10) || 0,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.replace('/(app)/chair');
  };

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[typography.display, { color: theme.text }]}>New service</Text>

          <GlassCard rounded="xl">
            <View style={styles.form}>
              <CCInput label="Name" placeholder="Balayage" value={name} onChangeText={setName} />
              <CCInput
                label="Duration (minutes)"
                value={duration}
                onChangeText={setDuration}
                keyboardType="number-pad"
              />
              <CCInput
                label="Price"
                placeholder="280"
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
              />
              <CCInput
                label="Processing window (minutes)"
                value={processing}
                onChangeText={setProcessing}
                keyboardType="number-pad"
                hint="Idle time during this service when you could take another client"
              />
              {error ? (
                <Text style={[typography.caption, { color: theme.danger }]}>{error}</Text>
              ) : null}
              <CCButton
                label={busy ? 'Saving…' : 'Add service'}
                variant="primary"
                fullWidth
                disabled={name.trim().length < 2 || busy}
                onPress={submit}
              />
            </View>
          </GlassCard>

          <CCButton label="Cancel" variant="ghost" onPress={() => router.back()} />
        </ScrollView>
      </SafeAreaView>
    </AmbientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.lg },
  form: { gap: spacing.md },
});
