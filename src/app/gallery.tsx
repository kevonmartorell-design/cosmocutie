import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { CCInput } from '@/components/cc-input';
import { CCModal } from '@/components/cc-modal';
import { GlassCard } from '@/components/glass-card';
import { palette, radius, spacing, typography } from '@/constants/theme';
import { useTheme } from '@/theme/theme-provider';

/**
 * Component gallery — the Phase 0 deliverable.
 *
 * Every component in every state, on one screen, so the aesthetic can be
 * approved before any features get built on top of it. Kept permanently as a
 * design reference and the fastest place to spot a regression.
 */
export default function ComponentGallery() {
  const { theme, scheme, toggle } = useTheme();
  const [modalOpen, setModalOpen] = useState(false);
  const [text, setText] = useState('');

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}>
          {/* ---- Header ---- */}
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={[typography.display, { color: theme.text }]}>CosmoCutie</Text>
              <Text style={[typography.caption, { color: theme.textMuted }]}>
                Component gallery · {scheme === 'dark' ? 'Cyberpunk Gloss' : 'Frosted Strawberry'}
              </Text>
            </View>
            <CCButton
              label={scheme === 'dark' ? '☀︎ Light' : '☾ Dark'}
              variant="secondary"
              onPress={toggle}
            />
          </View>

          {/* ---- Palette ---- */}
          <Section title="Palette · Cyber Magical Girl" theme={theme}>
            <View style={styles.swatchRow}>
              <Swatch color={palette.hotPink} name="Hot Pink" hex="FF1493" />
              <Swatch color={palette.bubblegum} name="Bubblegum" hex="FF77A9" />
              <Swatch color={palette.electricViolet} name="Violet" hex="9A4DFF" />
              <Swatch color={palette.laserCyan} name="Laser Cyan" hex="00F5FF" />
              <Swatch color={palette.sunshineYellow} name="Sunshine" hex="FFDD00" />
            </View>
          </Section>

          {/* ---- Typography ---- */}
          <Section title="Typography" theme={theme}>
            <Text style={[typography.display, { color: theme.text }]}>Display 32</Text>
            <Text style={[typography.title, { color: theme.text }]}>Title 24</Text>
            <Text style={[typography.heading, { color: theme.text }]}>Heading 18</Text>
            <Text style={[typography.body, { color: theme.text }]}>
              Body 16 — never pink on pink, always plum or charcoal for legibility.
            </Text>
            <Text style={[typography.caption, { color: theme.textMuted }]}>Caption 12 muted</Text>
          </Section>

          {/* ---- Buttons ---- */}
          <Section title="Buttons · press to feel the spring" theme={theme}>
            <View style={styles.buttonRow}>
              <CCButton label="Primary" variant="primary" />
              <CCButton label="Secondary" variant="secondary" />
            </View>
            <View style={styles.buttonRow}>
              <CCButton label="Ghost" variant="ghost" />
              <CCButton label="Danger" variant="danger" />
            </View>
            <CCButton label="Disabled" variant="primary" disabled />
            <CCButton label="Full width" variant="primary" fullWidth />
          </Section>

          {/* ---- Inputs ---- */}
          <Section title="Inputs" theme={theme}>
            <CCInput
              label="Service name"
              placeholder="Balayage"
              value={text}
              onChangeText={setText}
              hint="Tap to see the focus ring"
            />
            <CCInput label="With error" placeholder="60" error="Duration is required" />
            <CCInput label="Disabled" placeholder="Not editable" editable={false} />
          </Section>

          {/* ---- Glass ---- */}
          <Section title="Glass surfaces" theme={theme}>
            <GlassCard>
              <Text style={[typography.heading, { color: theme.text }]}>Blurred glass</Text>
              <Text style={[typography.body, { color: theme.textMuted, marginTop: spacing.xs }]}>
                Client-facing screens. Orbs drift behind this panel — the colour
                shifting through the blur is the effect working.
              </Text>
            </GlassCard>

            <GlassCard solid>
              <Text style={[typography.heading, { color: theme.text }]}>Solid surface</Text>
              <Text style={[typography.body, { color: theme.textMuted, marginTop: spacing.xs }]}>
                Stylist working screens — POS, formula entry, schedule. Same
                palette, no blur cost, better legibility mid-shift.
              </Text>
            </GlassCard>
          </Section>

          {/* ---- Radii ---- */}
          <Section title="Corner radii" theme={theme}>
            <View style={styles.radiusRow}>
              {(['sm', 'md', 'lg', 'xl'] as const).map((key) => (
                <View key={key} style={styles.radiusItem}>
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: radius[key],
                      backgroundColor: theme.primary,
                    }}
                  />
                  <Text style={[typography.caption, { color: theme.textMuted }]}>
                    {key} · {radius[key]}
                  </Text>
                </View>
              ))}
            </View>
          </Section>

          {/* ---- Modal ---- */}
          <Section title="Modal" theme={theme}>
            <CCButton label="Open dialog" variant="primary" onPress={() => setModalOpen(true)} />
          </Section>

          <Text style={[typography.caption, styles.footer, { color: theme.textMuted }]}>
            Phase 0 · foundation
          </Text>
        </ScrollView>
      </SafeAreaView>

      <CCModal
        visible={modalOpen}
        title="Springs in, glass and all"
        onDismiss={() => setModalOpen(false)}>
        <Text style={[typography.body, { color: theme.textMuted }]}>
          Tap outside to dismiss. The card scales with an overshoot rather than
          fading linearly.
        </Text>
        <CCButton label="Got it" variant="primary" fullWidth onPress={() => setModalOpen(false)} />
      </CCModal>
    </AmbientBackground>
  );
}

function Section({
  title,
  theme,
  children,
}: {
  title: string;
  theme: ReturnType<typeof useTheme>['theme'];
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[typography.label, { color: theme.textMuted }]}>{title.toUpperCase()}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Swatch({ color, name, hex }: { color: string; name: string; hex: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.swatch}>
      <View style={[styles.swatchChip, { backgroundColor: color, borderColor: theme.border }]} />
      <Text style={[typography.caption, { color: theme.text }]}>{name}</Text>
      <Text style={[typography.caption, { color: theme.textMuted, fontSize: 10 }]}>#{hex}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    padding: spacing.lg,
    gap: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerText: { flex: 1, gap: 2 },
  section: { gap: spacing.sm },
  sectionBody: { gap: spacing.md },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  swatchRow: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  swatch: { alignItems: 'center', gap: 4, width: 68 },
  swatchChip: { width: 48, height: 48, borderRadius: radius.md, borderWidth: 1 },
  radiusRow: { flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' },
  radiusItem: { alignItems: 'center', gap: spacing.xs },
  footer: { textAlign: 'center', marginTop: spacing.md },
});
