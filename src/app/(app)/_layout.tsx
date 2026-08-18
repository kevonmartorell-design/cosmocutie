import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/auth/auth-provider';
import { Loading } from '@/components/loading';

/**
 * Guard for everything behind sign-in. Rendering children before the session
 * has settled would flash protected UI at a signed-out visitor.
 */
export default function AppLayout() {
  const { ready, session } = useAuth();

  if (!ready) return <Loading label="Loading your salon" />;
  if (!session) return <Redirect href="/sign-in" />;

  return <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />;
}
