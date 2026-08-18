import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { CCInput } from '@/components/cc-input';
import { GlassCard } from '@/components/glass-card';
import { alpha, radius, spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

type Classification = 'contractor_1099' | 'employee_w2';

/**
 * Owner invites a stylist. Stylists cannot self-register — the owner controls
 * who works in the salon, which is also a security property: nobody can sign
 * up as a stylist here and start receiving bookings.
 */
export default function InviteStylist() {
  const { theme } = useTheme();
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [classification, setClassification] = useState<Classification>('contractor_1099');
  const [rent, setRent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.rpc('invite_stylist', {
      p_display_name: name,
      p_email: email,
      p_classification: classification,
      p_booth_rent_cents: Math.round((parseFloat(rent) || 0) * 100),
      p_rent_interval: 'monthly',
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <AmbientBackground>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.centered}>
            <GlassCard rounded="xl">
              <View style={styles.form}>
                <Text style={[typography.title, { color: theme.text }]}>Invitation ready</Text>
                <Text style={[typography.body, { color: theme.textMuted }]}>
                  {name} has a chair waiting. When they sign up with {email.trim()},
                  it attaches automatically.
                </Text>
                <CCButton
                  label="Back to salon"
                  variant="primary"
                  fullWidth
                  onPress={() => router.replace('/(app)/salon')}
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
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View>
            <Text style={[typography.display, { color: theme.text }]}>Invite a stylist</Text>
          </View>

          <GlassCard rounded="xl">
            <View style={styles.form}>
              <CCInput label="Name" placeholder="Rae Chen" value={name} onChangeText={setName} />
              <CCInput
                label="Email"
                placeholder="rae@example.com"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />

              <View style={styles.group}>
                <Text style={[typography.label, { color: theme.textMuted }]}>Classification</Text>
                <View style={styles.choices}>
                  <Choice
                    label="1099 booth renter"
                    hint="Owns their client book. Pays flat rent."
                    selected={classification === 'contractor_1099'}
                    onPress={() => setClassification('contractor_1099')}
                  />
                  <Choice
                    label="W-2 employee"
                    hint="Salon owns the client relationships."
                    selected={classification === 'employee_w2'}
                    onPress={() => setClassification('employee_w2')}
                  />
                </View>
              </View>

              {classification === 'contractor_1099' ? (
                <CCInput
                  label="Booth rent (monthly)"
                  placeholder="250"
                  value={rent}
                  onChangeText={setRent}
                  keyboardType="decimal-pad"
                  hint="Flat rate only — never a percentage of their sales"
                />
              ) : null}

              {error ? (
                <Text style={[typography.caption, { color: theme.danger }]}>{error}</Text>
              ) : null}

              <CCButton
                label={busy ? 'Creating…' : 'Create invitation'}
                variant="primary"
                fullWidth
                disabled={name.trim().length < 2 || email.trim().length < 3 || busy}
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

function Choice({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.choice,
        {
          borderColor: selected ? theme.primary : theme.border,
          backgroundColor: selected ? alpha(theme.primary, 0.12) : 'transparent',
        },
      ]}
      onTouchEnd={onPress}>
      <Text style={[typography.label, { color: selected ? theme.primary : theme.text }]}>
        {label}
      </Text>
      <Text style={[typography.caption, { color: theme.textMuted }]}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.lg },
  centered: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  form: { gap: spacing.md },
  group: { gap: spacing.sm },
  choices: { gap: spacing.sm },
  choice: { borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, gap: 2 },
});
