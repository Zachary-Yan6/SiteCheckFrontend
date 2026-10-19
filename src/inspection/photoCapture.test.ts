import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

import { addPhoto, deletePhoto } from '@/db/inspectionRepository';

import { MAX_PHOTO_BYTES, removeEvidencePhoto, takeEvidencePhoto } from './photoCapture';

// ------------------------------------------------------------------ fake file system and camera

/** uri -> size in bytes of every file that "exists". */
const mockFiles = new Map<string, number>();
/** Sizes the next compression attempts come out at. */
const mockCompressedSizes: number[] = [];
const mockResizes: unknown[] = [];

jest.mock('expo-file-system', () => {
  const uriOf = (part: string | { uri: string }) => (typeof part === 'string' ? part : part.uri);
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map(uriOf).join('/');
    }
    get size() {
      return mockFiles.get(this.uri) ?? 0;
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    async move(destination: File) {
      mockFiles.set(destination.uri, this.size);
      mockFiles.delete(this.uri);
      this.uri = destination.uri;
    }
    delete() {
      mockFiles.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(parent: string, name: string) {
      this.uri = `${parent}/${name}`;
    }
    create() {}
  }
  return { File, Directory, Paths: { document: 'file:///documents' } };
});

jest.mock('expo-image-manipulator', () => {
  let saved = 0;
  return {
    SaveFormat: { JPEG: 'jpeg' },
    ImageManipulator: {
      manipulate: () => ({
        resize: (size: unknown) => {
          mockResizes.push(size);
          return {
            renderAsync: async () => ({
              saveAsync: async () => {
                const uri = `file:///cache/compressed-${++saved}.jpg`;
                mockFiles.set(uri, mockCompressedSizes.shift() ?? 100_000);
                return { uri };
              },
            }),
          };
        },
      }),
    },
  };
});

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'photo-1' }));
jest.mock('@/db/inspectionRepository', () => ({ addPhoto: jest.fn(), deletePhoto: jest.fn() }));

const CORK_GPS = { coords: { latitude: 51.9, longitude: -8.45 } } as Location.LocationObject;

function cameraReturns(width: number, height: number) {
  mockFiles.set('file:///cache/camera.jpg', 4_000_000);
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cache/camera.jpg', width, height }],
  } as ImagePicker.ImagePickerResult);
}

/** FR-13: evidence photos are compressed under 500KB and tagged with time and GPS. */
describe('takeEvidencePhoto', () => {
  beforeEach(() => {
    // Fake timers: the 8-second GPS timeout is left running after a fix arrives.
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockFiles.clear();
    mockCompressedSizes.length = 0;
    mockResizes.length = 0;
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({ granted: true } as ImagePicker.CameraPermissionResponse);
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: true } as Location.LocationPermissionResponse);
    jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(CORK_GPS);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('compresses the shot, keeps it in the app folder and records it with its position', async () => {
    cameraReturns(4000, 3000);
    mockCompressedSizes.push(300_000);

    await expect(takeEvidencePhoto('insp-1', 10)).resolves.toBe(true);

    expect(mockResizes).toEqual([{ width: 1600 }]);
    expect(addPhoto).toHaveBeenCalledWith({
      id: 'photo-1',
      inspectionId: 'insp-1',
      templateItemId: 10,
      fileUri: 'file:///documents/photos/photo-1.jpg',
      sizeBytes: 300_000,
      takenAt: expect.any(String),
      latitude: 51.9,
      longitude: -8.45,
    });
    expect(mockFiles.has('file:///cache/compressed-1.jpg')).toBe(false); // moved, not copied
  });

  it('tries smaller sizes until it fits, deleting the attempts that were too big', async () => {
    cameraReturns(3000, 4000); // portrait: the height is the long side
    mockCompressedSizes.push(MAX_PHOTO_BYTES + 1, MAX_PHOTO_BYTES + 1, 400_000);

    await takeEvidencePhoto('insp-1', 10);

    expect(mockResizes).toEqual([{ height: 1600 }, { height: 1280 }, { height: 1024 }]);
    expect([...mockFiles.keys()].filter((uri) => uri.includes('compressed'))).toEqual([]);
    expect(jest.mocked(addPhoto).mock.calls[0][0].sizeBytes).toBe(400_000);
  });

  it('never enlarges a small photo, and keeps the last attempt if none fits', async () => {
    cameraReturns(640, 480);
    mockCompressedSizes.push(...Array(4).fill(MAX_PHOTO_BYTES + 1));

    await takeEvidencePhoto('insp-1', 10);

    expect(mockResizes).toEqual([{ width: 640 }, { width: 640 }, { width: 640 }, { width: 640 }]);
    expect(jest.mocked(addPhoto).mock.calls[0][0].sizeBytes).toBe(MAX_PHOTO_BYTES + 1);
  });

  it('waits for a fresh GPS fix when there is no recent one', async () => {
    cameraReturns(4000, 3000);
    jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(null);
    jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue(CORK_GPS);

    await takeEvidencePhoto('insp-1', 10);

    expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 3 });
    expect(jest.mocked(addPhoto).mock.calls[0][0].latitude).toBe(51.9);
  });

  it('saves the photo without a position after 8 seconds without a fix', async () => {
    cameraReturns(4000, 3000);
    jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(null);
    jest.mocked(Location.getCurrentPositionAsync).mockReturnValue(new Promise(() => {})); // basement

    const taking = takeEvidencePhoto('insp-1', 10);
    await jest.advanceTimersByTimeAsync(8_000);
    await taking;

    expect(jest.mocked(addPhoto).mock.calls[0][0]).toMatchObject({ latitude: null, longitude: null });
  });

  it('saves the photo without a position when location is denied or fails', async () => {
    cameraReturns(4000, 3000);
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValueOnce({ granted: false } as Location.LocationPermissionResponse);
    await takeEvidencePhoto('insp-1', 10);

    cameraReturns(4000, 3000);
    jest.mocked(Location.getLastKnownPositionAsync).mockRejectedValueOnce(new Error('Location services are off'));
    await takeEvidencePhoto('insp-1', 10);

    expect(jest.mocked(addPhoto).mock.calls.map(([p]) => p.latitude)).toEqual([null, null]);
  });

  it('returns false when the user backs out of the camera', async () => {
    jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue({ canceled: true, assets: null });
    await expect(takeEvidencePhoto('insp-1', 10)).resolves.toBe(false);
    expect(addPhoto).not.toHaveBeenCalled();
  });

  it('explains when camera access is denied', async () => {
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({ granted: false } as ImagePicker.CameraPermissionResponse);
    await expect(takeEvidencePhoto('insp-1', 10)).rejects.toThrow('needs camera access');
  });
});

describe('removeEvidencePhoto', () => {
  beforeEach(() => {
    mockFiles.clear();
  });

  it('deletes the row and the file', async () => {
    mockFiles.set('file:///documents/photos/p1.jpg', 1);
    jest.mocked(deletePhoto).mockResolvedValueOnce('file:///documents/photos/p1.jpg');

    await removeEvidencePhoto('p1');

    expect(mockFiles.size).toBe(0);
  });

  it('copes with a file that is already gone, and with a refused delete', async () => {
    jest.mocked(deletePhoto).mockResolvedValueOnce('file:///documents/photos/gone.jpg');
    await expect(removeEvidencePhoto('gone')).resolves.toBeUndefined();

    jest.mocked(deletePhoto).mockResolvedValueOnce(null); // inspection already submitted
    await expect(removeEvidencePhoto('p1')).resolves.toBeUndefined();
  });
});
