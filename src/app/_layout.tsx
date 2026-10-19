import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/authStore';
import { configureNotifications, registerForPushNotifications } from '@/notifications/pushNotifications';
import { useReminderNavigation } from '@/notifications/useReminderNavigation';
import { SyncBanner } from '@/sync/SyncBanner';
import { startSyncTriggers } from '@/sync/syncManager';

// Keep the splash screen up until we know whether someone is logged in, so the
// login screen doesn't flash for a user who already has a session.
SplashScreen.preventAutoHideAsync();
configureNotifications();

export default function RootLayout() {
  const status = useAuth((state) => state.status);
  const role = useAuth((state) => state.session?.user.role);
  const sessionToken = useAuth((state) => state.session?.token);
  const restore = useAuth((state) => state.restore);

  useEffect(() => {
    restore().finally(() => SplashScreen.hideAsync());
  }, [restore]);

  const signedIn = status === 'signedIn';
  // Managers get their own read-only screen; only inspectors capture and sync inspections.
  const isInspector = signedIn && role === 'INSPECTOR';
  const isManager = signedIn && role === 'MANAGER';

  // Background sync runs only while an inspector is logged in (FR-19).
  useEffect(() => {
    if (!isInspector) return;
    return startSyncTriggers();
  }, [isInspector]);

  // Reminders are for inspectors (FR-27): register this phone, and open the site on tap (FR-29).
  useEffect(() => {
    if (isInspector && sessionToken) registerForPushNotifications(sessionToken);
  }, [isInspector, sessionToken]);
  useReminderNavigation(isInspector);

  if (status === 'loading') {
    return null;
  }

  return (
    <View style={styles.root}>
      <Stack>
        {/* Protected screens only exist while their guard is true; Expo Router redirects
            to the first allowed screen automatically when login state changes. */}
        <Stack.Protected guard={isInspector}>
          <Stack.Screen name="index" options={{ title: 'My sites' }} />
          <Stack.Screen name="site/[id]" options={{ title: 'Site' }} />
          <Stack.Screen name="inspection/[id]" options={{ title: 'Inspection' }} />
          <Stack.Screen name="sign/[id]" options={{ title: 'Sign & submit' }} />
        </Stack.Protected>
        <Stack.Protected guard={isManager}>
          <Stack.Screen name="manager" options={{ title: 'Failed items' }} />
          <Stack.Screen name="assign" options={{ title: 'Assign inspectors' }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="register" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
      {isInspector && <SyncBanner />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
