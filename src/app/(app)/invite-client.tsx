import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { CCInput } from '@/components/cc-input';
import { GlassCard } from '@/components/glass-card';
import { spacing, typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/theme-provider';

/**
 * A stylist bringing an existing client onto the platform.
 *
 * The app generates a link; the stylist sends it themselves through whatever
 * they already use with that client. This is deliberate: an app-sent SMS to
 * someone who never consented is an unsolicited commercial message under TCPA,
 * at $500–$1,500 per message. A stylist texting their own client is not.
 */
export default function InviteClient() {
  const { theme } = useTheme();
  const { stylistTenants } = useAuth();
  const router = useRouter();
  const tenant = stylistTenants[0] ?? null;

  const [label, setLabel] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const origin =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : 'https://cosmocutie.vercel.app';

  const create = async () => {
    if (!tenant) return;
    setBusy(true);
    const { data, error } = await supabase
      .from('client_invites')
      .insert({ tenant_id: tenant.tenantId, label: label.trim() || null })
      .select('token')
      .single();
    setBusy(false);
    if (error || !data) return;
    setLink(`${origin}/join/${data.token}`);
  };

  const copy = async () => {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const share = async () => {
    if (!link) return;
    if (Platform.OS === 'web') return copy();
    await Share.share({ message: `Book with me on CosmoCutie: ${link}` });
  };

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View>
            <Text style={[typography.display, { color: theme.text }]}>Invite a client</Text>
            <Text style={[typography.caption, { color: theme.textMuted }]}>
              Send the link yourself — text, Instagram, however you already talk
            </Text>
          </View>

          {link ? (
            <GlassCard rounded="xl">
              <View style={styles.form}>
                <Text style={[typography.label, { color: theme.textMuted }]}>INVITE LINK</Text>
                <Text style={[typography.body, { color: theme.primary }]} selectable>
                  {link}
                </Text>
                <CCButton
                  label={copied ? 'Copied' : Platform.OS === 'web' ? 'Copy link' : 'Share link'}
                  variant="primary"
                  fullWidth
                  onPress={share}
                />
                <Text style={[typography.caption, { color: theme.textMuted }]}>
                  When they open it, they join your book directly — not the salon's.
                </Text>
                <CCButton label="Make another" variant="ghost" onPress={() => setLink(null)} />
              </View>
            </GlassCard>
          ) : (
            <GlassCard rounded="xl">
              <View style={styles.form}>
                <CCInput
                  label="Who is this for?"
                  placeholder="Nina"
                  value={label}
                  onChangeText={setLabel}
                  hint="Just a note for you — the client never sees it"
                />
                <CCButton
                  label={busy ? 'Creating…' : 'Create link'}
                  variant="primary"
                  fullWidth
                  disabled={busy}
                  onPress={create}
                />
              </View>
            </GlassCard>
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
  form: { gap: spacing.md },
});
