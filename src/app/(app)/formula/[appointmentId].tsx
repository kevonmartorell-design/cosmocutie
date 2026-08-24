import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { CCInput } from '@/components/cc-input';
import { GlassCard } from '@/components/glass-card';
import { spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { PhotoGallery } from '@/photos/photo-gallery';
import { useTheme } from '@/theme/theme-provider';

type Component = { product: string; grams: string };

/**
 * The Digital Colour Bar.
 *
 * Formulas attach to the APPOINTMENT, not just the client — a child's colour
 * history must not mix into the guardian's record, and "last formula" returning
 * the wrong person's mix is unsafe on a chemical service.
 */
export default function FormulaEntry() {
  const { theme } = useTheme();
  const { appointmentId } = useLocalSearchParams<{ appointmentId: string }>();
  const router = useRouter();

  const [ctx, setCtx] = useState<{ tenant_id: string; client_record_id: string } | null>(null);
  const [components, setComponents] = useState<Component[]>([{ product: '', grams: '' }]);
  const [developer, setDeveloper] = useState('20');
  const [minutes, setMinutes] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appointmentId) return;
    supabase
      .from('appointments')
      .select('tenant_id, client_record_id')
      .eq('id', appointmentId)
      .maybeSingle()
      .then(({ data }) => setCtx(data));
  }, [appointmentId]);

  const setComponent = (i: number, patch: Partial<Component>) =>
    setComponents((c) => c.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const submit = async () => {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    const payload = components
      .filter((c) => c.product.trim())
      .map((c) => ({
        product: c.product.trim(),
        ...(c.grams ? { grams: Number(c.grams) } : {}),
      }));

    const { error: err } = await supabase.from('formulas').insert({
      tenant_id: ctx.tenant_id,
      appointment_id: appointmentId!,
      client_record_id: ctx.client_record_id,
      components: payload,
      developer_volume: developer.trim() || null,
      processing_time_minutes: minutes ? Number(minutes) : null,
      technique_notes: notes.trim() || null,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.back();
  };

  const canSubmit = components.some((c) => c.product.trim()) && !busy;

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View>
            <Text style={[typography.display, { color: theme.text }]}>Colour formula</Text>
            <Text style={[typography.caption, { color: theme.textMuted }]}>
              Recorded against this appointment
            </Text>
          </View>

          <GlassCard rounded="xl">
            <View style={styles.form}>
              <Text style={[typography.label, { color: theme.textMuted }]}>MIX</Text>
              {components.map((c, i) => (
                <View key={i} style={styles.componentRow}>
                  <View style={{ flex: 3 }}>
                    <CCInput
                      placeholder="Shades EQ 09V"
                      value={c.product}
                      onChangeText={(v) => setComponent(i, { product: v })}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <CCInput
                      placeholder="g"
                      value={c.grams}
                      keyboardType="decimal-pad"
                      onChangeText={(v) => setComponent(i, { grams: v })}
                    />
                  </View>
                </View>
              ))}
              <CCButton
                label="Add another"
                variant="ghost"
                onPress={() => setComponents((c) => [...c, { product: '', grams: '' }])}
              />

              <CCInput
                label="Developer volume"
                placeholder="20"
                value={developer}
                onChangeText={setDeveloper}
                keyboardType="number-pad"
              />
              <CCInput
                label="Processing time (minutes)"
                placeholder="25"
                value={minutes}
                onChangeText={setMinutes}
                keyboardType="number-pad"
              />
              <CCInput
                label="Technique notes"
                placeholder="Root smudge, glossed mid-lengths"
                value={notes}
                onChangeText={setNotes}
              />

              {error ? (
                <Text style={[typography.caption, { color: theme.danger }]}>{error}</Text>
              ) : null}

              <CCButton
                label={busy ? 'Saving…' : 'Save formula'}
                variant="primary"
                fullWidth
                disabled={!canSubmit}
                onPress={submit}
              />
            </View>
          </GlassCard>

          {/* Attached to the appointment, so they are worth taking whether or
              not a formula is written — and they survive if the stylist backs
              out of the form. */}
          {ctx && appointmentId ? (
            <PhotoGallery appointmentId={appointmentId} tenantId={ctx.tenant_id} />
          ) : null}

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
  componentRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
});
