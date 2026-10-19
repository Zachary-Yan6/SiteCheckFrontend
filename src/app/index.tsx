import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ApiError, NetworkError } from '@/api/client';
import { useAuth, useCurrentUser } from '@/auth/authStore';
import { listSitesWithSchedules } from '@/db/cacheRepository';
import { DueBadge, dueLabel } from '@/schedule/DueBadge';
import { siteStatus, sortByUrgency, type SiteInput, type SiteStatus } from '@/schedule/dueStatus';
import { downloadBootstrap } from '@/sync/bootstrap';
import { requestSync } from '@/sync/syncManager';

/**
 * Home screen: the inspector's sites, most urgent first - overdue, then due today, then the rest
 * (FR-08). Everything is computed from SQLite and the phone's clock, so it stays right offline.
 */
export default function HomeScreen() {
  const user = useCurrentUser();
  const token = useAuth((state) => state.session?.token);
  const logout = useAuth((state) => state.logout);
  const [sites, setSites] = useState<SiteInput[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadFromDb = useCallback(async () => {
    setSites(await listSitesWithSchedules());
    setNow(new Date());
  }, []);

  // First load. State is set in the promise callback (not synchronously in the effect), and the
  // `active` flag skips it if the screen unmounted before SQLite answered.
  useEffect(() => {
    let active = true;
    listSitesWithSchedules().then((rows) => {
      if (!active) return;
      setSites(rows);
      setNow(new Date());
    });
    return () => {
      active = false;
    };
  }, []);

  // An app left open overnight must not keep showing yesterday's "due today".
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date());
    });
    return () => subscription.remove();
  }, []);

  const sorted = useMemo(() => sortByUrgency(sites.map((site) => siteStatus(site, now))), [sites, now]);

  // Pull-to-refresh: upload waiting inspections (FR-19), then re-download sites (FR-07).
  // Offline, this just fails politely and the cached list stays.
  async function onRefresh() {
    if (!token) return;
    setRefreshing(true);
    setMessage(null);
    try {
      await requestSync();
      await downloadBootstrap(token);
    } catch (e) {
      if (e instanceof NetworkError) setMessage('Offline - showing saved sites.');
      else if (e instanceof ApiError && e.status === 401) setMessage('Session expired - log in again to refresh.');
      else setMessage('Could not refresh. Showing saved sites.');
    } finally {
      await loadFromDb(); // also re-reads the clock
      setRefreshing(false);
    }
  }

  async function onLogout() {
    try {
      await logout();
    } catch (e) {
      Alert.alert('Not logged out', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Hi {user?.fullName}</Text>
        <Pressable onPress={onLogout}>
          <Text style={styles.logout}>Log out</Text>
        </Pressable>
      </View>
      {message && <Text style={styles.message}>{message}</Text>}
      <FlatList
        data={sorted}
        keyExtractor={(site) => String(site.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => <SiteRow site={item} />}
        ListEmptyComponent={
          <Text style={styles.empty}>No sites assigned to you yet. Ask your manager to add you to a site.</Text>
        }
      />
    </View>
  );
}

function SiteRow({ site }: { site: SiteStatus }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => router.push({ pathname: '/site/[id]', params: { id: String(site.id) } })}>
      <View style={styles.rowHeader}>
        <Text style={styles.siteName}>{site.name}</Text>
        <DueBadge state={site.state} daysUntilDue={site.daysUntilDue} />
      </View>
      <Text style={styles.siteAddress}>{site.address}</Text>
      {site.schedules.map((check) => (
        <Text key={check.templateId} style={[styles.check, check.state !== 'ok' && styles.checkUrgent]}>
          {check.templateName} · {dueLabel(check.state, check.daysUntilDue)}
        </Text>
      ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  greeting: { fontSize: 18, fontWeight: '600' },
  logout: { color: '#1565c0', fontSize: 15 },
  message: { backgroundColor: '#fff3e0', color: '#e65100', padding: 12, marginHorizontal: 16, borderRadius: 8 },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  rowPressed: { backgroundColor: '#f5f5f5' },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  siteName: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  siteAddress: { fontSize: 14, color: '#666' },
  check: { fontSize: 13, color: '#666' },
  checkUrgent: { color: '#333', fontWeight: '500' },
  empty: { textAlign: 'center', color: '#666', marginTop: 32 },
});
