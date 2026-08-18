import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import type { Database } from './database.types';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase config. Copy .env.example to .env and fill in the project URL and anon key.',
  );
}

/**
 * Shared Supabase client.
 *
 * The anon key is public by design — every access rule is enforced by
 * Row-Level Security in Postgres, not by hiding this string. The service_role
 * key must never appear in this bundle.
 *
 * Session storage differs by platform: React Native has no localStorage, so
 * AsyncStorage backs it there. On web, the default storage is correct, and
 * `detectSessionInUrl` handles the OAuth/magic-link redirect that only exists
 * in a browser.
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});
