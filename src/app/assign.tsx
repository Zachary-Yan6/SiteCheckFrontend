import { useEffect, useState } from 'react';
import { Alert, FlatList, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { ApiError, NetworkError } from '@/api/client';
import type { User } from '@/api/types';
import { useAuth } from '@/auth/authStore';
import { listSitesWithSchedules } from '@/db/cacheRepository';
import { Chip } from '@/manager/Chip';
import { assignInspector, fetchInspectors, fetchSiteInspectors, unassignInspector } from '@/manager/managerApi';

/**
 * Manager: pick a site, then switch inspectors on or off for it. Online-only like the rest of the
 * manager view. A new assignment reaches the inspector's phone on their next pull-to-refresh.
 */
export default function AssignScreen() {
  const token = useAuth((state) => state.session?.token);
  const expireSession = useAuth((state) => state.expireSession);

  const [sites, setSites] = useState<{ id: number; name: string }[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [inspectors, setInspectors] = useState<User[]>([]);
  const [assigned, setAssigned] = useState<ReadonlySet<number>>(new Set());
  const [saving, setSaving] = useState<ReadonlySet<number>>(new Set()); // user ids with a request in flight
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Site names come from the cache downloaded at login; start on the first one.
  useEffect(() => {
    let active = true;
    listSitesWithSchedules().then((rows) => {
      if (!active) return;
      const sorted = rows.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
      setSites(sorted);
      setSiteId((current) => current ?? sorted[0]?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  // Reload when the site changes; `active` drops the answer for a site that is no longer selected.
  useEffect(() => {
    if (!token || siteId === null) return;
    let active = true;
    loadAssignments(token, siteId).then(
      (result) => {
        if (!active) return;
        setInspectors(result.inspectors);
        setAssigned(result.assigned);
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
  }, [token, siteId, expireSession]);

  async function onRefresh() {
    if (!token || siteId === null) return;
    setRefreshing(true);
    try {
      const result = await loadAssignments(token, siteId);
      setInspectors(result.inspectors);
      setAssigned(result.assigned);
      setMessage(null);
    } catch (e) {
      if (isExpiredSession(e)) expireSession();
      else setMessage(loadErrorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function onToggle(inspector: User, on: boolean) {
    if (!token || siteId === null) return;
    if (!on && !(await confirmUnassign(inspector.fullName, siteName(sites, siteId)))) return;

    // Show the change straight away; put it back if the server says no.
    setAssigned((current) => withId(current, inspector.id, on));
    setSaving((current) => withId(current, inspector.id, true));
    try {
      await (on ? assignInspector : unassignInspector)(token, siteId, inspector.id);
    } catch (e) {
      setAssigned((current) => withId(current, inspector.id, !on));
      if (isExpiredSession(e)) expireSession();
      else Alert.alert('Not saved', saveErrorMessage(e));
    } finally {
      setSaving((current) => withId(current, inspector.id, false));
    }
  }

  // Switching site while a save is in flight could put its rollback on the wrong site.
  const busy = saving.size > 0;

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {sites.map((s) => (
          <Chip
            key={s.id}
            label={s.name}
            selected={siteId === s.id}
            disabled={busy}
            onPress={() => setSiteId(s.id)}
          />
        ))}
      </ScrollView>

      {message && <Text style={styles.message}>{message}</Text>}

      <FlatList
        data={inspectors}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.person}>
              <Text style={styles.name}>{item.fullName}</Text>
              <Text style={styles.email}>{item.email}</Text>
            </View>
            <Switch
              value={assigned.has(item.id)}
              disabled={saving.has(item.id)}
              onValueChange={(on) => onToggle(item, on)}
            />
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>{siteId === null ? 'No sites downloaded yet.' : 'No inspector accounts yet.'}</Text>
        }
      />
    </View>
  );
}

async function loadAssignments(token: string, siteId: number) {
  const [inspectors, onSite] = await Promise.all([fetchInspectors(token), fetchSiteInspectors(token, siteId)]);
  return { inspectors, assigned: new Set(onSite.map((u) => u.id)) as ReadonlySet<number> };
}

/** A copy of `set` with `id` added (on) or removed (off). */
function withId(set: ReadonlySet<number>, id: number, on: boolean): ReadonlySet<number> {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

function siteName(sites: { id: number; name: string }[], siteId: number): string {
  return sites.find((s) => s.id === siteId)?.name ?? 'this site';
}

/** Unassigning bounces any of their inspections for the site that haven't synced yet. */
function confirmUnassign(name: string, site: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(
      `Remove ${name} from ${site}?`,
      "Inspections they haven't synced for this site yet will be rejected. Only remove inspectors who are done with the site.",
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Remove', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

function isExpiredSession(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}

function loadErrorMessage(e: unknown): string {
  return e instanceof NetworkError ? 'Offline - assigning inspectors needs a connection.' : 'Could not load inspectors.';
}

function saveErrorMessage(e: unknown): string {
  if (e instanceof NetworkError) return 'No connection - the change was not saved.';
  if (e instanceof ApiError) return e.message;
  return 'Something went wrong. Please try again.';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  filters: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' },
  message: { backgroundColor: '#fff3e0', color: '#e65100', padding: 12, marginHorizontal: 16, borderRadius: 8 },
  list: { padding: 12, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    gap: 12,
  },
  person: { flex: 1 },
  name: { fontSize: 16, fontWeight: '500' },
  email: { fontSize: 13, color: '#757575' },
  empty: { textAlign: 'center', color: '#666', marginTop: 32 },
});
