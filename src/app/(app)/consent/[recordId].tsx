import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { CCInput } from '@/components/cc-input';
import { GlassCard } from '@/components/glass-card';
import { alpha, radius, spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

const DOC_VERSION = 'patch-test-v1.0';
type Result = 'pass' | 'fail' | 'reaction';

/**
 * Patch test record.
 *
 * Note what this form does NOT ask: no medications, no conditions, no
 * pregnancy. Contraindication screening is a single yes/no outcome — the
 * stylist asks the questions aloud and has the conversation, but the answers
 * do not need a database row. See PLAN.md → Sensitive Data Policy.
 */
export default function ConsentForm() {
  const { theme } = useTheme();
  const { recordId } = useLocalSearchParams<{ recordId: string }>();
  const router = useRouter();

  const [product, setProduct] = useState('');
  const [result, setResult] = useState<Result>('pass');
  const [disclosed, setDisclosed] = useState(false);
  const [proceeded, setProceeded] = useState(true);
  const [signedBy, setSignedBy] = useState('');
  const [guardian, setGuardian] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('record_consent', {
      p_client_record_id: recordId!,
      p_kind: 'patch_test',
      p_signed_by_name: signedBy.trim(),
      p_document_version: DOC_VERSION,
      p_product_tested: product.trim() || undefined,
      p_result: result,
      p_contraindications_disclosed: disclosed,
      p_proceeded: proceeded,
      p_signed_by_guardian: guardian,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.back();
  };

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View>
            <Text style={[typography.display, { color: theme.text }]}>Patch test</Text>
            <Text style={[typography.caption, { color: theme.textMuted }]}>
              {DOC_VERSION}
            </Text>
          </View>

          <GlassCard rounded="xl">
            <View style={styles.form}>
              <CCInput
                label="Product tested"
                placeholder="Shades EQ 09V"
                value={product}
                onChangeText={setProduct}
              />

              <View style={styles.group}>
                <Text style={[typography.label, { color: theme.textMuted }]}>RESULT</Text>
                <View style={styles.choices}>
                  {(['pass', 'fail', 'reaction'] as Result[]).map((r) => (
                    <View
                      key={r}
                      onTouchEnd={() => setResult(r)}
                      style={[
                        styles.choice,
                        {
                          borderColor: result === r ? theme.primary : theme.border,
                          backgroundColor:
                            result === r ? alpha(theme.primary, 0.14) : 'transparent',
                        },
                      ]}>
                      <Text
                        style={[
                          typography.label,
                          { color: result === r ? theme.primary : theme.text },
                        ]}>
                        {r === 'pass' ? 'No reaction' : r === 'fail' ? 'Inconclusive' : 'Reaction'}
                      </Text>
                    </View>
                  ))}
                </View>
                {result === 'reaction' ? (
                  <Text style={[typography.caption, { color: theme.danger }]}>
                    A reaction does not clear this client for chemical services.
                  </Text>
                ) : null}
              </View>

              <View style={styles.settingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.body, { color: theme.text }]}>
                    Contraindications disclosed
                  </Text>
                  <Text style={[typography.caption, { color: theme.textMuted }]}>
                    Yes/no only — details are discussed, not stored
                  </Text>
                </View>
                <Switch
                  value={disclosed}
                  onValueChange={setDisclosed}
                  trackColor={{ true: theme.primary, false: theme.border }}
                />
              </View>

              <View style={styles.settingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.body, { color: theme.text }]}>Proceeding with service</Text>
                </View>
                <Switch
                  value={proceeded}
                  onValueChange={setProceeded}
                  trackColor={{ true: theme.primary, false: theme.border }}
                />
              </View>

              <CCInput
                label="Signed by"
                placeholder="Client's full name"
                value={signedBy}
                onChangeText={setSignedBy}
                hint={guardian ? 'Guardian signs for a minor, in person' : undefined}
              />

              <View style={styles.settingRow}>
                <Text style={[typography.body, { color: theme.text, flex: 1 }]}>
                  Signed by a guardian
                </Text>
                <Switch
                  value={guardian}
                  onValueChange={setGuardian}
                  trackColor={{ true: theme.primary, false: theme.border }}
                />
              </View>

              {error ? (
                <Text style={[typography.caption, { color: theme.danger }]}>{error}</Text>
              ) : null}

              <CCButton
                label={busy ? 'Recording…' : 'Record patch test'}
                variant="primary"
                fullWidth
                disabled={signedBy.trim().length < 2 || busy}
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
  group: { gap: spacing.sm },
  choices: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  choice: { borderWidth: 1.5, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
