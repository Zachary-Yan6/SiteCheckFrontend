import { Link, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ApiError, NetworkError } from '@/api/client';
import type { FailedItem } from '@/api/types';
import { useAuth, useCurrentUser } from '@/auth/authStore';
import { listSitesWithSchedules } from '@/db/cacheRepository';
import { Chip } from '@/manager/Chip';
import { fetchFailedItems, shareSiteReport } from '@/manager/managerApi';

const PERIODS = [7, 30, 90];

/** Manager home (FR-30): failed items across all sites, filtered by site and period. */
export default function ManagerScreen() {
  const user = useCurrentUser();
  const token = useAuth((state) => state.session?.token);
  const logout = useAuth((state) => state.logout);
  const expireSession = useAuth((state) => state.expireSession);

  const [sites, setSites] = useState<{ id: number; name: string }[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [days, setDays] = useState(30);
  const [items, setItems] = useState<FailedItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [openPhoto, setOpenPhoto] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Site names for the filter come from the cache downloaded at login.
  useEffect(() => {
    let active = true;
    listSitesWithSchedules().then((rows) => {
      if (active) setSites(rows.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
    });
    return () => {
      active = false;
    };
  }, []);

  // Load whenever a filter changes. State is set in the promise callbacks, and `active` drops
  // the answer of a request that a newer filter choice has replaced.
  useEffect(() => {
    if (!token) return;
    let active = true;
    fetchFailedItems(token, days, siteId).then(
      (rows) => {
        if (!active) return;
        setItems(rows);
        setMessage(null);
      },
      (e: unknown) => {
        if (!active) return;
        if (isExpiredSession(e)) expireSession();
        else setMessage(loadErrorMessage(e));
      },
    );
    return () => {
      active = false;
    };
  }, [token, days, siteId, expireSession]);

  async function onRefresh() {
    if (!token) return;
    setRefreshing(true);
    try {
      setItems(await fetchFailedItems(token, days, siteId));
      setMessage(null);
    } catch (e) {
      if (isExpiredSession(e)) expireSession();
      else setMessage(loadErrorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function onExport() {
    if (!token || siteId === null) return;
    setExporting(true);
    try {
      await shareSiteReport(token, siteId, days);
    } catch (e) {
      Alert.alert('No report', e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
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
      <Stack.Screen
        options={{
          title: 'Failed items',
          headerRight: () => (
            <Pressable onPress={onLogout}>
              <Text style={styles.logout}>Log out</Text>
            </Pressable>
          ),
        }}
      />
      <Text style={styles.greeting}>Hi {user?.fullName}</Text>

      <Link href="/assign" asChild>
        <Pressable style={styles.assign}>
          <Text style={styles.assignText}>Assign inspectors to sites</Text>
        </Pressable>
      </Link>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {PERIODS.map((p) => (
          <Chip key={p} label={`${p} days`} selected={days === p} onPress={() => setDays(p)} />
        ))}
        <View style={styles.divider} />
        <Chip label="All sites" selected={siteId === null} onPress={() => setSiteId(null)} />
        {sites.map((s) => (
          <Chip key={s.id} label={s.name} selected={siteId === s.id} onPress={() => setSiteId(s.id)} />
        ))}
      </ScrollView>

      {/* FR-31: the report is per site, so a site must be chosen first. */}
      <Pressable
        style={[styles.export, (siteId === null || exporting) && styles.exportDisabled]}
        disabled={siteId === null || exporting}
        onPress={onExport}>
        <Text style={styles.exportText}>
          {siteId === null
            ? 'Choose a site to export a PDF report'
            : exporting
              ? 'Preparing report...'
              : `PDF report - last ${days} days`}
        </Text>
      </Pressable>

      {message && <Text style={styles.message}>{message}</Text>}

      <FlatList
        data={items}
        keyExtractor={(item) => `${item.inspectionId}-${item.position}`}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => <FailedItemCard item={item} onOpenPhoto={setOpenPhoto} />}
        ListEmptyComponent={<Text style={styles.empty}>No failed items in the last {days} days.</Text>}
      />

      {/* Full-screen photo; tap anywhere to close. */}
      <Modal visible={openPhoto !== null} transparent animationType="fade" onRequestClose={() => setOpenPhoto(null)}>
        <Pressable style={styles.photoBackdrop} onPress={() => setOpenPhoto(null)}>
          {openPhoto && <Image source={{ uri: openPhoto }} style={styles.photoFull} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </View>
  );
}

/** 401: the token expired. A manager has nothing unsynced, so it's straight back to login. */
function isExpiredSession(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}

function loadErrorMessage(e: unknown): string {
  return e instanceof NetworkError ? 'Offline - the manager view needs a connection.' : 'Could not load failed items.';
}

function FailedItemCard({ item, onOpenPhoto }: { item: FailedItem; onOpenPhoto: (url: string) => void }) {
  return (
    <View style={styles.card}>
      <Text style={styles.site}>{item.siteName}</Text>
      <Text style={styles.check}>
        {item.templateName} · item {item.position}
      </Text>
      <Text style={styles.itemTitle}>{item.itemTitle}</Text>
      {item.note && <Text style={styles.note}>{item.note}</Text>}
      {item.photos.length > 0 && (
        <View style={styles.photos}>
          {item.photos.map((photo) => (
            <Pressable key={photo.id} onPress={() => onOpenPhoto(photo.url)}>
              <Image source={{ uri: photo.url }} style={styles.thumb} />
            </Pressable>
          ))}
        </View>
      )}
      <Text style={styles.meta}>
        {item.inspectorName} · {new Date(item.submittedAt).toLocaleString()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  greeting: { fontSize: 16, fontWeight: '600', paddingHorizontal: 16, paddingTop: 12 },
  logout: { color: '#1565c0', fontSize: 15 },
  filters: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  divider: { width: 1, height: 24, backgroundColor: '#ccc', marginHorizontal: 4 },
  assign: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1565c0',
  },
  assignText: { color: '#1565c0', fontWeight: '600' },
  export: {
    marginHorizontal: 16,
    marginBottom: 4,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#1565c0',
  },
  exportDisabled: { opacity: 0.45 },
  exportText: { color: '#fff', fontWeight: '600' },
  message: { backgroundColor: '#fff3e0', color: '#e65100', padding: 12, marginHorizontal: 16, borderRadius: 8 },
  list: { padding: 12, gap: 10 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, gap: 4, borderWidth: 1, borderColor: '#ef9a9a' },
  site: { fontSize: 16, fontWeight: '600' },
  check: { fontSize: 13, color: '#666' },
  itemTitle: { fontSize: 15, fontWeight: '500', marginTop: 4 },
  note: { fontSize: 14, color: '#b71c1c' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  thumb: { width: 72, height: 72, borderRadius: 6, backgroundColor: '#eee' },
  meta: { fontSize: 12, color: '#757575', marginTop: 6 },
  empty: { textAlign: 'center', color: '#666', marginTop: 32 },
  photoBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center' },
  photoFull: { width: '100%', height: '80%' },
});
