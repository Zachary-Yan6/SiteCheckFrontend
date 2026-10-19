import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/authStore';
import { bannerMessage, useSyncStatus } from '@/sync/syncStatus';

/**
 * Global status strip at the bottom of every screen (FR-25): offline, "N waiting to sync",
 * syncing, failures, or "log in again". Hidden when everything is on the server.
 */
export function SyncBanner() {
  const { isOnline, isSyncing, waiting, failed, authRequired } = useSyncStatus();
  const expireSession = useAuth((state) => state.expireSession);
  const insets = useSafeAreaInsets();

  const message = bannerMessage({ isOnline, isSyncing, waiting, failed, authRequired });
  if (!message) return null;

  return (
    <View style={[styles.banner, styles[message.tone], { paddingBottom: 10 + insets.bottom }]}>
      <Text style={styles.text}>{message.text}</Text>
      {authRequired && (
        <Pressable onPress={expireSession} style={styles.action}>
          <Text style={styles.actionText}>Log in</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 12,
  },
  info: { backgroundColor: '#e3f2fd' },
  warning: { backgroundColor: '#fff3e0' },
  error: { backgroundColor: '#fdecea' },
  text: { flex: 1, fontSize: 14, color: '#212121' },
  action: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: '#1565c0' },
  actionText: { color: '#fff', fontWeight: '600' },
});
