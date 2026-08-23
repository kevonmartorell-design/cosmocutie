import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatSlot } from '@/booking/negotiation';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { GlassCard } from '@/components/glass-card';
import { Loading } from '@/components/loading';
import { spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

type Rec = {
  id: string;
  tenant_id: string;
  visit_count: number;
  no_show_count: number;
  safety_flag: string | null;
  clients: { full_name: string; phone: string | null } | null;
};

type Formula = {
  id: string;
  created_at: string;
  components: { product: string; grams?: number }[];
  developer_volume: string | null;
  processing_time_minutes: number | null;
  technique_notes: string | null;
};

type PatchTest = {
  is_valid: boolean;
  tested_at: string | null;
  expires_at: string | null;
  result: string | null;
};

/**
 * A client's record from the stylist's side: safety flag, patch-test standing,
 * colour history. Tenant-scoped — this is precisely the screen the salon owner
 * must never be able to open for a renter's client.
 */
export default function ClientRecordScreen() {
  const { theme } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [rec, setRec] = useState<Rec | null>(null);
  const [formulas, setFormulas] = useState<Formula[]>([]);
  const [patch, setPatch] = useState<PatchTest | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const { data: r } = await supabase
      .from('client_records')
      .select('id, tenant_id, visit_count, no_show_count, safety_flag, clients(full_name, phone)')
      .eq('id', id)
      .maybeSingle();
    if (!r) return;
    const rr = r as unknown as Rec;
    setRec(rr);

    const { data: f } = await supabase
      .from('formulas')
      .select('id, created_at, components, developer_volume, processing_time_minutes, technique_notes')
      .eq('client_record_id', id)
      .order('created_at', { ascending: false });
    setFormulas((f as unknown as Formula[]) ?? []);

    const { data: p } = await supabase.rpc('patch_test_status', {
      p_tenant_id: rr.tenant_id,
      p_client_record_id: id,
    });
    setPatch((p as unknown as PatchTest[])?.[0] ?? null);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!rec) return <Loading label="Opening record" />;

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View>
            <Text style={[typography.display, { color: theme.text }]}>
              {rec.clients?.full_name ?? 'Client'}
            </Text>
            <Text style={[typography.caption, { color: theme.textMuted }]}>
              {rec.visit_count} visit{rec.visit_count === 1 ? '' : 's'}
              {rec.no_show_count > 0 ? ` · ${rec.no_show_count} no-show` : ''}
            </Text>
          </View>

          {/* The one health-adjacent field kept, deliberately narrow. */}
          {rec.safety_flag ? (
            <GlassCard rounded="md" style={{ borderColor: theme.danger, borderWidth: 2 }}>
              <Text style={[typography.label, { color: theme.danger }]}>SAFETY</Text>
              <Text style={[typography.body, { color: theme.text }]}>{rec.safety_flag}</Text>
            </GlassCard>
          ) : null}

          <Text style={[typography.label, { color: theme.textMuted }]}>PATCH TEST</Text>
          <GlassCard rounded="md">
            {patch?.tested_at ? (
              <View style={{ gap: 2 }}>
                <Text
                  style={[
                    typography.heading,
                    { color: patch.is_valid ? theme.success : theme.danger },
                  ]}>
                  {patch.is_valid
                    ? 'Valid'
                    : patch.result === 'reaction'
                      ? 'Reaction recorded'
                      : 'Expired'}
                </Text>
                <Text style={[typography.caption, { color: theme.textMuted }]}>
                  Tested {formatSlot(patch.tested_at)}
                </Text>
              </View>
            ) : (
              <Text style={[typography.body, { color: theme.textMuted }]}>
                No patch test on file. Chemical services cannot be completed until
                one is recorded.
              </Text>
            )}
          </GlassCard>
          <CCButton
            label="Record a patch test"
            variant="secondary"
            onPress={() =>
              router.push({ pathname: '/(app)/consent/[recordId]', params: { recordId: rec.id } })
            }
          />

          <Text style={[typography.label, { color: theme.textMuted }]}>COLOUR HISTORY</Text>
          {formulas.length === 0 ? (
            <GlassCard>
              <Text style={[typography.body, { color: theme.textMuted }]}>
                No formulas recorded yet.
              </Text>
            </GlassCard>
          ) : (
            formulas.map((f) => (
              <GlassCard key={f.id} rounded="md">
                <View style={{ gap: spacing.sm }}>
                  <Text style={[typography.caption, { color: theme.textMuted }]}>
                    {formatSlot(f.created_at)}
                  </Text>
                  {f.components.map((c, i) => (
                    <View key={i} style={styles.component}>
                      <Text style={[typography.body, { color: theme.text, flex: 1 }]}>
                        {c.product}
                      </Text>
                      {c.grams ? (
                        <Text style={[typography.label, { color: theme.primary }]}>
                          {c.grams}g
                        </Text>
                      ) : null}
                    </View>
                  ))}
                  <Text style={[typography.caption, { color: theme.textMuted }]}>
                    {f.developer_volume ? `${f.developer_volume} vol` : ''}
                    {f.processing_time_minutes ? ` · ${f.processing_time_minutes} min` : ''}
                  </Text>
                  {f.technique_notes ? (
                    <Text style={[typography.body, { color: theme.textMuted }]}>
                      {f.technique_notes}
                    </Text>
                  ) : null}
                </View>
              </GlassCard>
            ))
          )}

          <CCButton label="Back" variant="ghost" onPress={() => router.back()} />
        </ScrollView>
      </SafeAreaView>
    </AmbientBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.md },
  component: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
