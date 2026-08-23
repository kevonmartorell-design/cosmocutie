import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/**
 * Push registration.
 *
 * The negotiation is deadline-driven, so being told it is your turn is not a
 * nicety — without it a request sits unanswered until it expires.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPush(): Promise<string | null> {
  // Simulators cannot receive push tokens, and asking produces a confusing
  // failure rather than a useful one.
  if (!Device.isDevice) return null;
  if (Platform.OS === 'web') return null;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;

  // Only prompt if we have not already been answered. Re-asking a user who
  // declined is both futile and irritating.
  if (status !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Bookings',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  try {
    const projectId =
      (await import('expo-constants')).default.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return token;

    // Upsert on the token: reinstalling gives a new token, and the same device
    // signing in as someone else should re-point the existing row.
    await supabase.from('push_tokens').upsert(
      { profile_id: auth.user.id, token, platform: Platform.OS, last_seen_at: new Date().toISOString() },
      { onConflict: 'token' },
    );
    return token;
  } catch {
    // A missing token is not worth breaking the session over.
    return null;
  }
}

/** Removes this device's token, so a signed-out phone stops receiving alerts. */
export async function unregisterPush(): Promise<void> {
  if (!Device.isDevice || Platform.OS === 'web') return;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync();
    await supabase.from('push_tokens').delete().eq('token', token);
  } catch {
    // Nothing to remove.
  }
}
