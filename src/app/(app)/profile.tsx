import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { CCInput } from '@/components/cc-input';
import { GlassCard } from '@/components/glass-card';
import { Loading } from '@/components/loading';
import { spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

/** A stylist's public face: what a client sees when browsing. */
export default function StylistProfile() {
  const { theme } = useTheme();
  const { stylistTenants } = useAuth();
  const router = useRouter();
  const tenant = stylistTenants[0] ?? null;

  const [displayName, setDisplayName] = useState('');
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [instagram, setInstagram] = useState('');
  const [published, setPublished] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenant) return;
    const { data } = await supabase
      .from('stylist_profiles')
      .select('display_name, headline, bio, instagram_handle, is_published')
      .eq('tenant_id', tenant.tenantId)
      .maybeSingle();
    if (data) {
      setDisplayName(data.display_name ?? '');
      setHeadline(data.headline ?? '');
      setBio(data.bio ?? '');
      setInstagram(data.instagram_handle ?? '');
      setPublished(data.is_published);
    }
    setLoaded(true);
  }, [tenant]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!tenant) return;
    setStatus('Saving…');
    const { error } = await supabase
      .from('stylist_profiles')
      .update({
        display_name: displayName.trim(),
        headline: headline.trim() || null,
        bio: bio.trim() || null,
        instagram_handle: instagram.trim().replace(/^@/, '') || null,
      })
      .eq('tenant_id', tenant.tenantId);
    setStatus(error ? error.message : 'Saved');
    setTimeout(() => setStatus(null), 2500);
  };

  const togglePublished = async (next: boolean) => {
    if (!tenant) return;
    setPublished(next);
    const { error } = await supabase
      .from('stylist_profiles')
      .update({ is_published: next })
      .eq('tenant_id', tenant.tenantId);
    if (error) setPublished(!next);
  };

  if (!tenant) return <Loading label="No chair" />;
  if (!loaded) return <Loading label="Loading profile" />;

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View>
            <Text style={[typography.display, { color: theme.text }]}>Your profile</Text>
            <Text style={[typography.caption, { color: theme.textMuted }]}>
              {status ?? 'What clients see when they find you'}
            </Text>
          </View>

          <GlassCard rounded="xl">
            <View style={styles.form}>
              <CCInput label="Display name" value={displayName} onChangeText={setDisplayName} />
              <CCInput
                label="Headline"
                placeholder="Balayage & lived-in colour"
                value={headline}
                onChangeText={setHeadline}
              />
              <CCInput
                label="About"
                placeholder="A little about how you work"
                value={bio}
                onChangeText={setBio}
                multiline
                numberOfLines={4}
                style={styles.multiline}
                hint={`${bio.length}/600`}
                error={bio.length > 600 ? 'Too long' : undefined}
              />
              <CCInput
                label="Instagram"
                placeholder="raedoeshair"
                value={instagram}
                onChangeText={setInstagram}
                autoCapitalize="none"
                hint="Without the @"
              />
              <CCButton
                label="Save"
                variant="primary"
                fullWidth
                disabled={bio.length > 600}
                onPress={save}
              />
            </View>
          </GlassCard>

          <GlassCard>
            <View style={styles.publishRow}>
              <View style={styles.publishText}>
                <Text style={[typography.heading, { color: theme.text }]}>Visible to clients</Text>
                <Text style={[typography.caption, { color: theme.textMuted }]}>
                  {published
                    ? 'Clients can find and book you'
                    : 'Hidden while you finish setting up'}
                </Text>
              </View>
              <Switch
                value={published}
                onValueChange={togglePublished}
                trackColor={{ true: theme.primary, false: theme.border }}
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
  scroll: { padding: spacing.lg, gap: spacing.md },
  form: { gap: spacing.md },
  multiline: { minHeight: 96, textAlignVertical: 'top', paddingTop: spacing.md },
  publishRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  publishText: { flex: 1, gap: 2 },
});
