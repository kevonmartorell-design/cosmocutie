import { Redirect, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth, type Membership } from '@/auth/auth-provider';
import { AmbientBackground } from '@/components/ambient-background';
import { CCButton } from '@/components/cc-button';
import { GlassCard } from '@/components/glass-card';
import { spacing, typography } from '@/constants/theme';
import { useTheme } from '@/theme/theme-provider';

/**
 * Staff home.
 *
 * The owner holds both an admin membership and a stylist one, so this lists
 * them as separate contexts rather than merging them into a single dashboard.
 * Merging is how renter data ends up on an owner screen.
 */
export default function StaffHome() {
  const { theme } = useTheme();
  const { user, adminTenant, stylistTenants, isStaff, signOut } = useAuth();
  const router = useRouter();

  if (!isStaff) return <Redirect href="/(app)/client" />;

  return (
    <AmbientBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View>
            <Text style={[typography.display, { color: theme.text }]}>
              {user?.user_metadata?.full_name ?? 'Welcome'}
            </Text>
            <Text style={[typography.caption, { color: theme.textMuted }]}>
              Choose a workspace
            </Text>
          </View>

          {adminTenant ? (
            <ContextCard
              title="My salon"
              subtitle={adminTenant.tenantName}
              blurb="Facility overview, chairs, rent, and stylist invitations."
              actionLabel="Open salon"
              onPress={() => router.push('/(app)/salon')}
            />
          ) : null}

          {stylistTenants.map((t) => (
            <ContextCard
              key={t.tenantId}
              title="My chair"
              subtitle={t.tenantName}
              blurb="Your own menu, pricing, hours, clients, and policies."
              actionLabel="Open chair"
              onPress={() => router.push('/(app)/chair')}
            />
          ))}

          {!adminTenant && stylistTenants.length === 0 ? (
            <GlassCard>
              <Text style={[typography.body, { color: theme.textMuted }]}>
                You are signed in but not yet part of a salon.
              </Text>
            </GlassCard>
          ) : null}

          <CCButton label="Sign out" variant="ghost" onPress={signOut} />
        </ScrollView>
      </SafeAreaView>
    </AmbientBackground>
  );
}

function ContextCard({
  title,
  subtitle,
  blurb,
  actionLabel,
  onPress,
}: {
  title: string;
  subtitle: string;
  blurb: string;
  actionLabel: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <GlassCard rounded="xl">
      <View style={styles.card}>
        <View>
          <Text style={[typography.caption, { color: theme.textMuted }]}>
            {title.toUpperCase()}
          </Text>
          <Text style={[typography.title, { color: theme.text }]}>{subtitle}</Text>
        </View>
        <Text style={[typography.body, { color: theme.textMuted }]}>{blurb}</Text>
        <CCButton label={actionLabel} variant="primary" onPress={onPress} />
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.lg, gap: spacing.lg },
  card: { gap: spacing.md },
});
