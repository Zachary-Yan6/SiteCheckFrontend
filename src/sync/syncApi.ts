import { File, UploadType } from 'expo-file-system';

import { ApiError, apiFetch, NetworkError } from '@/api/client';
import { RetryableError, type SyncApi, type UploadTarget } from '@/sync/syncEngine';

/** The SyncApi the engine uses in the app: the real backend endpoints, plus a direct PUT to S3. */
export function createSyncApi(token: string): SyncApi {
  return {
    submitInspection: (payload) =>
      apiFetch<{ pendingPhotoIds: string[] }>('/api/inspections', { method: 'POST', body: payload, token }),

    requestUploadUrl: (photoId, sizeBytes) =>
      apiFetch<UploadTarget>(`/api/photos/${photoId}/upload-url`, { method: 'POST', body: { sizeBytes }, token }),

    async uploadFile(url, headers, fileUri) {
      let status: number;
      try {
        // Raw JPEG bytes as the request body - what a presigned PUT URL expects (FR-22).
        const result = await new File(fileUri).upload(url, {
          httpMethod: 'PUT',
          uploadType: UploadType.BINARY_CONTENT,
          headers,
        });
        status = result.status;
      } catch {
        throw new NetworkError();
      }
      if (status < 200 || status >= 300) {
        // E.g. 403 when the URL expired during a slow upload: a fresh URL on the next try fixes it.
        throw new RetryableError(`Photo storage rejected the upload (${status})`);
      }
    },

    async confirmPhoto(photoId) {
      try {
        await apiFetch(`/api/photos/${photoId}/confirm`, { method: 'POST', token });
      } catch (error) {
        // 409 = the server can't see the file in S3 yet: upload it again next time.
        if (error instanceof ApiError && error.status === 409) throw new RetryableError(error.message);
        throw error;
      }
    },
  };
}
