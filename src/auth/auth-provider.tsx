import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { supabase } from '@/lib/supabase';
import { registerForPush, unregisterPush } from '@/notifications/push';

/**
 * A tenant the signed-in user belongs to, and in what capacity.
 *
 * Roles are composable: the salon owner typically holds `admin` on the salon
 * AND `stylist` on their own chair. These arrive as separate memberships and
 * must stay separate — collapsing them into one "is owner" flag is exactly how
 * the 1099 firewall gets quietly dismantled.
 */
export type Membership = {
  tenantId: string;
  tenantName: string;
  tenantKind: 'salon' | 'stylist';
  role: 'admin' | 'stylist';
  classification: string | null;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  memberships: Membership[];
  /** True once the initial session check and membership load have settled. */
  ready: boolean;
  /** Someone with no memberships is a client, not staff. */
  isStaff: boolean;
  adminTenant: Membership | null;
  stylistTenants: Membership[];
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  refreshMemberships: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [membershipsLoaded, setMembershipsLoaded] = useState(false);

  const loadMemberships = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setMemberships([]);
      setMembershipsLoaded(true);
      return;
    }

    // RLS restricts this to the caller's own rows, so no filter is needed
    // beyond what the policy already enforces.
    const { data, error } = await supabase
      .from('tenant_members')
      .select('tenant_id, role, classification, tenants(name, kind)')
      .eq('profile_id', userId)
      .eq('is_active', true);

    if (error) {
      console.error('[auth] failed to load memberships', error.message);
      setMemberships([]);
    } else {
      setMemberships(
        (data ?? []).map((row) => {
          const tenant = row.tenants as unknown as { name: string; kind: 'salon' | 'stylist' } | null;
          return {
            tenantId: row.tenant_id,
            tenantName: tenant?.name ?? 'Unknown',
            tenantKind: tenant?.kind ?? 'stylist',
            role: row.role as 'admin' | 'stylist',
            classification: row.classification,
          };
        }),
      );
    }
    setMembershipsLoaded(true);
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionChecked(true);
      void loadMemberships(data.session?.user.id);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      setMembershipsLoaded(false);
      void loadMemberships(next?.user.id);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadMemberships]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return { error: error?.message ?? null };
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    });
    if (error) return { error: error.message, needsConfirmation: false };
    // Supabase returns a user with no session when confirmation is required.
    return { error: null, needsConfirmation: !data.session };
  }, []);

  // Register for push once signed in. Deliberately fire-and-forget: a device
  // that cannot get a token (simulator, permission declined) must still be able
  // to use the app.
  useEffect(() => {
    if (!session) return;
    void registerForPush();
  }, [session]);

  const signOut = useCallback(async () => {
    // Drop this device's token first, so a signed-out phone stops receiving
    // someone else's booking alerts.
    await unregisterPush();
    await supabase.auth.signOut();
    setMemberships([]);
  }, []);

  const refreshMemberships = useCallback(
    () => loadMemberships(session?.user.id),
    [loadMemberships, session?.user.id],
  );

  const value = useMemo<AuthContextValue>(() => {
    const adminTenant = memberships.find((m) => m.role === 'admin') ?? null;
    const stylistTenants = memberships.filter((m) => m.role === 'stylist');
    return {
      session,
      user: session?.user ?? null,
      memberships,
      ready: sessionChecked && membershipsLoaded,
      isStaff: memberships.length > 0,
      adminTenant,
      stylistTenants,
      signIn,
      signUp,
      signOut,
      refreshMemberships,
    };
  }, [session, memberships, sessionChecked, membershipsLoaded, signIn, signUp, signOut, refreshMemberships]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
