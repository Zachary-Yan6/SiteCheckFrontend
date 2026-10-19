import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError, NetworkError } from '@/api/client';
import type { SiteInspection } from '@/api/types';
import { useAuth, useCurrentUser } from '@/auth/authStore';
import { getSiteWithSchedules } from '@/db/cacheRepository';
import {
  findDraftsForSite,
  listSubmittedForSite,
  startOrResumeDraft,
  type InspectionStatus,
  type SubmittedInspection,
} from '@/db/inspectionRepository';
import { DueBadge } from '@/schedule/DueBadge';
import { siteStatus, type SiteStatus } from '@/schedule/dueStatus';
import { fetchSiteHistory } from '@/site/siteApi';
import { retryInspection } from '@/sync/syncManager';
import { useSyncStatus } from '@/sync/syncStatus';

/**
 * One site: its checks with due status and a button to start (or continue) each one, the
 * inspections submitted from this phone with their sync status (FR-24), and the site's
 * history from the server, including colleagues' inspections (FR-09).
 */
export default function SiteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const siteId = Number(id);
  const user = useCurrentUser();
  const token = useAuth((state) => state.session?.token);
  const [site, setSite] = useState<SiteStatus | null | undefined>(undefined); // undefined = loading
  const [drafts, setDrafts] = useState<Map<number, string>>(new Map());
  const [submitted, setSubmitted] = useState<SubmittedInspection[]>([]);
  const [history, setHistory] = useState<SiteInspection[]>([]);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  // Changes whenever the sync engine makes progress, so the statuses below update live.
  const syncProgress = useSyncStatus((s) => `${s.isSyncing}/${s.waiting}/${s.failed}`);

  // Reload whenever the screen is shown again (e.g. after an inspection) or sync makes progress.
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      Promise.all([
        getSiteWithSchedules(siteId),
        findDraftsForSite(user.id, siteId),
        listSubmittedForSite(user.id, siteId),
      ]).then(([found, open, sent]) => {
        if (!active) return;
        setSite(found ? siteStatus(found, new Date()) : null);
        setDrafts(open);
        setSubmitted(sent);
      });
      return () => {
        active = false;
      };
      // syncProgress is only a trigger to reload; its value isn't used.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [siteId, user, syncProgress]),
  );

  // History needs the network, so it loads separately: the local parts above show at once,
  // offline included, and history fills in when (and if) the server answers.
  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      let active = true;
      fetchSiteHistory(token, siteId).then(
        (rows) => {
          if (!active) return;
          setHistory(rows);
          setHistoryNote(null);
        },
        (e: unknown) => {
          if (active) setHistoryNote(historyErrorMessage(e));
        },
      );
      return () => {
        active = false;
      };
    }, [token, siteId]),
  );

  async function start(templateId: number) {
    if (!user) return;
    try {
      const inspectionId = await startOrResumeDraft(user.id, siteId, templateId);
      router.push({ pathname: '/inspection/[id]', params: { id: inspectionId } });
    } catch (e) {
      Alert.alert('Could not start inspection', e instanceof Error ? e.message : String(e));
    }
  }

  if (site === undefined) return null;
  if (site === null) {
    return <Text style={styles.empty}>Site not found on this phone. Pull to refresh on the home screen.</Text>;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: site.name }} />
      <Text style={styles.address}>{site.address}</Text>

      {site.schedules.map((check) => {
        const draftId = drafts.get(check.templateId);
        return (
          <View key={check.templateId} style={styles.card}>
            <Text style={styles.checkName}>{check.templateName}</Text>
            <Text style={styles.frequency}>Every {check.frequencyDays} days</Text>
            <DueBadge state={check.state} daysUntilDue={check.daysUntilDue} />
            <Pressable style={styles.button} onPress={() => start(check.templateId)}>
              <Text style={styles.buttonText}>{draftId ? 'Continue draft' : 'Start inspection'}</Text>
            </Pressable>
          </View>
        );
      })}

      {submitted.length > 0 && <Text style={styles.sectionTitle}>Submitted from this phone</Text>}
      {submitted.map((inspection) => (
        <Pressable
          key={inspection.id}
          style={styles.submittedRow}
          onPress={() => router.push({ pathname: '/inspection/[id]', params: { id: inspection.id } })}>
          <View style={styles.submittedText}>
            <Text style={styles.submittedName}>{inspection.templateName}</Text>
            <Text style={styles.submittedDate}>{new Date(inspection.submittedAt).toLocaleString()}</Text>
            {inspection.status === 'FAILED' && inspection.lastError && (
              <Text style={styles.submittedError}>{inspection.lastError}</Text>
            )}
          </View>
          <SyncChip status={inspection.status} />
          {inspection.status === 'FAILED' && (
            <Pressable style={styles.retry} onPress={() => retryInspection(inspection.id)}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          )}
        </Pressable>
      ))}

      <Text style={styles.sectionTitle}>History</Text>
      {historyNote && <Text style={styles.historyNote}>{historyNote}</Text>}
      {/* Inspections from this phone are already listed above, with their sync status. */}
      {history
        .filter((h) => !submitted.some((s) => s.id === h.id))
        .map((h) => (
          <HistoryRow key={h.id} inspection={h} />
        ))}
      {!historyNote && history.length === 0 && <Text style={styles.historyNote}>No inspections yet.</Text>}
    </ScrollView>
  );
}

function HistoryRow({ inspection }: { inspection: SiteInspection }) {
  const allPassed = inspection.failCount === 0;
  return (
    <View style={styles.historyRow}>
      <View style={styles.submittedText}>
        <Text style={styles.submittedName}>{inspection.templateName}</Text>
        <Text style={styles.submittedDate}>
          {new Date(inspection.submittedAt).toLocaleString()} · {inspection.inspectorName}
        </Text>
        {inspection.failedItems.map((title) => (
          <Text key={title} style={styles.failedItem}>
            ✗ {title}
          </Text>
        ))}
      </View>
      <Text style={[styles.chip, allPassed ? styles.chipPassed : styles.chipFailed]}>
        {allPassed ? 'All passed' : `${inspection.failCount} failed`}
      </Text>
    </View>
  );
}

function historyErrorMessage(e: unknown): string {
  if (e instanceof NetworkError) return 'History needs a connection.';
  if (e instanceof ApiError && e.status === 401) return 'Log in again to see the history.';
  return 'Could not load the history.';
}

/** FR-24: where each submitted inspection is on its way to the server. */
const SYNC_CHIPS: Record<Exclude<InspectionStatus, 'DRAFT'>, { label: string; color: string }> = {
  PENDING: { label: 'Waiting to sync', color: '#a64b00' },
  SYNCING: { label: 'Syncing', color: '#1565c0' },
  SYNCED: { label: 'Synced', color: '#1b5e20' },
  FAILED: { label: 'Failed', color: '#b71c1c' },
};

function SyncChip({ status }: { status: InspectionStatus }) {
  if (status === 'DRAFT') return null;
  const chip = SYNC_CHIPS[status];
  return <Text style={[styles.chip, { color: chip.color, borderColor: chip.color }]}>{chip.label}</Text>;
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  address: { fontSize: 15, color: '#555' },
  card: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10, padding: 14, gap: 6 },
  checkName: { fontSize: 17, fontWeight: '600' },
  frequency: { fontSize: 13, color: '#666' },
  button: { backgroundColor: '#1565c0', borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  empty: { textAlign: 'center', color: '#666', margin: 32 },
  sectionTitle: { fontSize: 15, fontWeight: '600', marginTop: 12 },
  submittedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  submittedText: { flex: 1, gap: 2 },
  submittedName: { fontSize: 15 },
  submittedDate: { fontSize: 13, color: '#666' },
  submittedError: { fontSize: 12, color: '#b71c1c' },
  chip: { fontSize: 12, fontWeight: '600', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  historyNote: { fontSize: 13, color: '#666' },
  failedItem: { fontSize: 13, color: '#b71c1c' },
  chipPassed: { color: '#1b5e20', borderColor: '#1b5e20' },
  chipFailed: { color: '#b71c1c', borderColor: '#b71c1c' },
  retry: { backgroundColor: '#1565c0', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
