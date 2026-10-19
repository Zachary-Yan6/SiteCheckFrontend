import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  getInspection,
  listAnswers,
  listPhotos,
  saveNote,
  saveResult,
  type Answer,
  type Inspection,
  type PhotoThumb,
} from '@/db/inspectionRepository';
import { removeEvidencePhoto, takeEvidencePhoto } from '@/inspection/photoCapture';
import { checkForSubmit, itemProblems, type ItemResult } from '@/inspection/submitRules';

/**
 * The checklist (FR-10, FR-11). Every change is saved to SQLite immediately (FR-14), so there is
 * no Save button: the user can lock the phone, lose signal or have the app killed and pick up
 * exactly where they were.
 */
export default function InspectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [photos, setPhotos] = useState<PhotoThumb[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [found, rows, thumbs] = await Promise.all([getInspection(id), listAnswers(id), listPhotos(id)]);
    return { found, rows, thumbs };
  }, [id]);

  // Reload on focus, e.g. when coming back from the signature screen.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      reload().then(({ found, rows, thumbs }) => {
        if (!active) return;
        setInspection(found);
        setAnswers(rows);
        setPhotos(thumbs);
      });
      return () => {
        active = false;
      };
    }, [reload]),
  );

  /** Photo counts and thumbnails come from SQLite, so re-read after taking or deleting one. */
  async function refreshPhotos() {
    const { rows, thumbs } = await reload();
    setAnswers(rows);
    setPhotos(thumbs);
  }

  async function onTakePhoto(templateItemId: number) {
    try {
      if (await takeEvidencePhoto(id, templateItemId)) await refreshPhotos();
    } catch (e) {
      Alert.alert('Photo not saved', e instanceof Error ? e.message : String(e));
    }
  }

  function onDeletePhoto(photoId: string) {
    Alert.alert('Delete this photo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => removeEvidencePhoto(photoId).then(refreshPhotos),
      },
    ]);
  }

  const readOnly = inspection?.status !== 'DRAFT';
  const check = useMemo(() => checkForSubmit(answers), [answers]);

  /** Update the screen at once, then write to SQLite. */
  function update(templateItemId: number, change: Partial<Answer>, save: () => Promise<void>) {
    setAnswers((current) => current.map((a) => (a.templateItemId === templateItemId ? { ...a, ...change } : a)));
    save().then(
      () => setSaveError(null),
      (e) => setSaveError(`Not saved: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  if (!inspection) return null;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: inspection.templateName }} />
      <FlatList
        data={answers}
        keyExtractor={(a) => String(a.templateItemId)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.siteName}>{inspection.siteName}</Text>
            <Text style={styles.savedHint}>
              {readOnly ? 'Submitted - read only' : 'Every change is saved on this phone automatically.'}
            </Text>
            {saveError && <Text style={styles.error}>{saveError}</Text>}
          </View>
        }
        renderItem={({ item }) => (
          <ItemCard
            answer={item}
            photos={photos.filter((p) => p.templateItemId === item.templateItemId)}
            readOnly={readOnly}
            onResult={(result) =>
              update(item.templateItemId, { result }, () => saveResult(id, item.templateItemId, result))
            }
            onNote={(note) => update(item.templateItemId, { note }, () => saveNote(id, item.templateItemId, note))}
            onTakePhoto={() => onTakePhoto(item.templateItemId)}
            onDeletePhoto={onDeletePhoto}
          />
        )}
      />

      {!readOnly && (
        <View style={styles.footer}>
          <Text style={styles.progress}>
            {check.answered} of {check.total} answered
            {check.incomplete.length > 0 && ` · ${check.incomplete.length} need attention`}
          </Text>
          <Pressable
            style={[styles.submit, !check.canSubmit && styles.submitDisabled]}
            disabled={!check.canSubmit}
            onPress={() => router.push({ pathname: '/sign/[id]', params: { id } })}>
            <Text style={styles.submitText}>Sign & submit</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const RESULT_OPTIONS: { value: ItemResult; label: string; color: string }[] = [
  { value: 'PASS', label: 'Pass', color: '#2e7d32' },
  { value: 'FAIL', label: 'Fail', color: '#c62828' },
  { value: 'NA', label: 'N/A', color: '#616161' },
];

function ItemCard({
  answer,
  photos,
  readOnly,
  onResult,
  onNote,
  onTakePhoto,
  onDeletePhoto,
}: {
  answer: Answer;
  photos: PhotoThumb[];
  readOnly: boolean;
  onResult: (result: ItemResult) => void;
  onNote: (note: string) => void;
  onTakePhoto: () => void;
  onDeletePhoto: (photoId: string) => void;
}) {
  // Only nag about an item once the user has touched it; untouched items just look unanswered.
  const problems = answer.result === null ? [] : itemProblems(answer);
  const isFail = answer.result === 'FAIL';

  return (
    <View style={[styles.card, isFail && styles.cardFail]}>
      <Text style={styles.itemTitle}>
        {answer.position}. {answer.title}
      </Text>
      {answer.guidance && <Text style={styles.guidance}>{answer.guidance}</Text>}

      <View style={styles.options}>
        {RESULT_OPTIONS.map((option) => {
          const selected = answer.result === option.value;
          return (
            <Pressable
              key={option.value}
              disabled={readOnly}
              onPress={() => onResult(option.value)}
              style={[styles.option, selected && { backgroundColor: option.color, borderColor: option.color }]}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: readOnly }}>
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {(answer.result !== null || answer.note) && (
        <TextInput
          style={styles.note}
          placeholder={isFail ? 'What is wrong? (required)' : 'Note (optional)'}
          value={answer.note ?? ''}
          onChangeText={onNote}
          editable={!readOnly}
          multiline
        />
      )}

      {(isFail || photos.length > 0) && (
        <View style={styles.photos}>
          {photos.map((photo) => (
            <Pressable
              key={photo.id}
              disabled={readOnly}
              onLongPress={() => onDeletePhoto(photo.id)}
              accessibilityLabel="Evidence photo. Long-press to delete.">
              <Image source={{ uri: photo.fileUri }} style={styles.thumb} />
            </Pressable>
          ))}
          {!readOnly && isFail && (
            <Pressable style={styles.addPhoto} onPress={onTakePhoto} accessibilityLabel="Take photo">
              <Text style={styles.addPhotoText}>+ Photo</Text>
            </Pressable>
          )}
        </View>
      )}

      {problems.map((problem) => (
        <Text key={problem} style={styles.problem}>
          • {problem}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  list: { padding: 12, gap: 10, paddingBottom: 24 },
  header: { gap: 4, marginBottom: 4 },
  siteName: { fontSize: 16, fontWeight: '600' },
  savedHint: { fontSize: 13, color: '#666' },
  error: { color: '#c62828', fontSize: 13 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, gap: 8, borderWidth: 1, borderColor: '#e0e0e0' },
  cardFail: { borderColor: '#ef9a9a' },
  itemTitle: { fontSize: 16, fontWeight: '600' },
  guidance: { fontSize: 13, color: '#666' },
  options: { flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#bdbdbd',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  optionText: { fontSize: 15, fontWeight: '600', color: '#424242' },
  optionTextSelected: { color: '#fff' },
  note: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    minHeight: 44,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: 72, height: 72, borderRadius: 6, backgroundColor: '#eee' },
  addPhoto: {
    width: 72,
    height: 72,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#9e9e9e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoText: { fontSize: 13, fontWeight: '600', color: '#424242' },
  problem: { fontSize: 13, color: '#c62828' },
  footer: {
    backgroundColor: '#fff',
    padding: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
  },
  progress: { fontSize: 14, color: '#424242' },
  submit: { backgroundColor: '#1565c0', borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
