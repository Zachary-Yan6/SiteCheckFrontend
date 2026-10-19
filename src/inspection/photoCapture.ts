import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

import { addPhoto, deletePhoto } from '@/db/inspectionRepository';

/** FR-13: photos are compressed to at most 500KB before they're stored (and later uploaded). */
export const MAX_PHOTO_BYTES = 500 * 1024;

/** Tried in order until the JPEG fits; each step trades a little quality for size. */
const COMPRESSION_STEPS = [
  { longestSide: 1600, quality: 0.7 },
  { longestSide: 1280, quality: 0.6 },
  { longestSide: 1024, quality: 0.5 },
  { longestSide: 800, quality: 0.4 },
];

const LOCATION_TIMEOUT_MS = 8_000;

/**
 * Opens the camera and saves the photo as evidence for one checklist item (FR-13):
 * compressed JPEG in the app's own folder, plus GPS position and time in SQLite.
 * Works fully offline. Returns false if the user backed out of the camera.
 */
export async function takeEvidencePhoto(inspectionId: string, templateItemId: number): Promise<boolean> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('SiteCheck needs camera access to take evidence photos. You can allow it in Settings.');
  }

  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
  if (result.canceled) return false;
  const shot = result.assets[0];
  const takenAt = new Date().toISOString();

  // Compress while the GPS fix comes in.
  const [compressedUri, position] = await Promise.all([
    compressToLimit(shot.uri, shot.width, shot.height),
    currentPosition(),
  ]);

  const photoId = Crypto.randomUUID();
  const folder = new Directory(Paths.document, 'photos');
  folder.create({ idempotent: true, intermediates: true });
  // The document folder is kept until the app is uninstalled; the cache folder the camera
  // and compressor write to can be cleared by the OS at any time.
  const stored = new File(folder, `${photoId}.jpg`);
  await new File(compressedUri).move(stored);

  await addPhoto({
    id: photoId,
    inspectionId,
    templateItemId,
    fileUri: stored.uri,
    sizeBytes: stored.size,
    takenAt,
    latitude: position?.latitude ?? null,
    longitude: position?.longitude ?? null,
  });
  return true;
}

/** Deletes a photo from a draft, both the database row and the file. */
export async function removeEvidencePhoto(photoId: string): Promise<void> {
  const fileUri = await deletePhoto(photoId);
  if (fileUri) {
    const file = new File(fileUri);
    if (file.exists) file.delete();
  }
}

/** Re-encodes the photo smaller and smaller until it fits MAX_PHOTO_BYTES. Returns the new file's URI. */
async function compressToLimit(uri: string, width: number, height: number): Promise<string> {
  let lastUri = uri;
  for (const step of COMPRESSION_STEPS) {
    // Shrink the longest side only, never enlarge.
    const resize = width >= height
      ? { width: Math.min(step.longestSide, width) }
      : { height: Math.min(step.longestSide, height) };
    const image = await ImageManipulator.manipulate(uri).resize(resize).renderAsync();
    const saved = await image.saveAsync({ compress: step.quality, format: SaveFormat.JPEG });

    if (lastUri !== uri) new File(lastUri).delete(); // previous, too-big attempt
    lastUri = saved.uri;
    if (new File(saved.uri).size <= MAX_PHOTO_BYTES) break;
  }
  return lastUri;
}

/**
 * Best-effort GPS for the photo, or null. Location is read only here, at the moment a photo is
 * taken - never tracked in the background (NFR-06). GPS works without mobile data, but a fix can
 * take a while indoors, so a recent known position is used if there is one, and we give up after
 * a few seconds rather than hold up the inspector.
 */
async function currentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return null;

    const recent = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000 });
    const fix =
      recent ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCATION_TIMEOUT_MS)),
      ]));
    return fix ? { latitude: fix.coords.latitude, longitude: fix.coords.longitude } : null;
  } catch {
    return null; // location off, no fix... the photo still counts
  }
}
