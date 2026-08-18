import { Redirect } from 'expo-router';

import { useAuth } from '@/auth/auth-provider';
import { Loading } from '@/components/loading';

/**
 * Entry point. Decides where a visitor belongs rather than rendering anything
 * itself: signed out goes to sign-in, staff go to the staff area, and everyone
 * else is a client.
 */
export default function Index() {
  const { ready, session, isStaff } = useAuth();

  if (!ready) return <Loading label="Starting up" />;
  if (!session) return <Redirect href="/sign-in" />;
  return <Redirect href={isStaff ? '/(app)/staff' : '/(app)/client'} />;
}
