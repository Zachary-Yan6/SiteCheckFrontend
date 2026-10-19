import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import SignatureView, { type SignatureViewRef } from 'react-native-signature-canvas';

import { getInspection, submitInspection, type Inspection } from '@/db/inspectionRepository';
import { refreshCounts, requestSync } from '@/sync/syncManager';

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

/**
 * Hand-written signature, then submit (FR-15). Submitting only writes to SQLite and the sync
 * queue, so it succeeds instantly even with no signal; the upload happens later in the background.
 */
export default function SignScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const signatureRef = useRef<SignatureViewRef>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    getInspection(id).then((found) => {
      if (active) setInspection(found);
    });
    return () => {
      active = false;
    };
  }, [id]);

  async function onSigned(dataUrl: string) {
    if (!inspection || submitting) return;
    setSubmitting(true);
    try {
      await submitInspection(id, dataUrl.replace(PNG_DATA_URL_PREFIX, ''));
      // Show "1 waiting to sync" at once, and try to upload straight away if there's signal.
      refreshCounts();
      requestSync();
      // Back to the site, skipping the now read-only form.
      router.dismissTo({ pathname: '/site/[id]', params: { id: String(inspection.siteId) } });
    } catch (e) {
      setSubmitting(false);
      Alert.alert('Not submitted', e instanceof Error ? e.message : String(e));
    }
  }

  if (!inspection) return null;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Sign & submit' }} />
      <Text style={styles.summary}>
        {inspection.templateName} at {inspection.siteName}
      </Text>
      <Text style={styles.hint}>
        Once submitted the inspection can no longer be changed. It is saved on this phone and uploads
        automatically when there is signal.
      </Text>
      <View style={styles.canvas}>
        <SignatureView
          ref={signatureRef}
          onOK={onSigned}
          onEmpty={() => Alert.alert('Please sign in the box first')}
          descriptionText="Sign above"
          clearText="Clear"
          confirmText={submitting ? 'Submitting...' : 'Submit'}
          imageType="image/png"
          trimWhitespace
          autoClear={false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8, backgroundColor: '#fff' },
  summary: { fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 13, color: '#666' },
  canvas: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, overflow: 'hidden' },
});
