import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { File } from 'expo-file-system';

import { ApiError, apiFetch, NetworkError } from '@/api/client';
import { RetryableError, type SubmitPayload } from '@/sync/syncEngine';

import { createSyncApi } from './syncApi';

jest.mock('@/api/client', () => ({ ...jest.requireActual<object>('@/api/client'), apiFetch: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: jest.fn(),
  UploadType: { BINARY_CONTENT: 0 },
}));

const upload = jest.fn<(url: string, options: unknown) => Promise<{ status: number }>>();

/** The real endpoints the sync engine talks to, with the HTTP layer mocked. */
describe('createSyncApi', () => {
  const api = createSyncApi('jwt');

  beforeEach(() => {
    jest.clearAllMocks();
    (File as unknown as jest.Mock<() => unknown>).mockImplementation(() => ({ upload }));
  });

  it('submits the inspection and asks for upload URLs with the token', async () => {
    const payload = { id: 'i1' } as SubmitPayload;
    await api.submitInspection(payload);
    await api.requestUploadUrl('p1', 1234);

    expect(apiFetch).toHaveBeenCalledWith('/api/inspections', { method: 'POST', body: payload, token: 'jwt' });
    expect(apiFetch).toHaveBeenCalledWith('/api/photos/p1/upload-url', { method: 'POST', body: { sizeBytes: 1234 }, token: 'jwt' });
  });

  it('PUTs the raw JPEG to the presigned URL', async () => {
    upload.mockResolvedValue({ status: 200 });

    await api.uploadFile('https://s3.test/put', { 'Content-Type': 'image/jpeg' }, 'file:///p1.jpg');

    expect(File).toHaveBeenCalledWith('file:///p1.jpg');
    expect(upload).toHaveBeenCalledWith('https://s3.test/put', {
      httpMethod: 'PUT',
      uploadType: 0,
      headers: { 'Content-Type': 'image/jpeg' },
    });
  });

  it('retries an upload S3 rejected, e.g. because the URL expired', async () => {
    upload.mockResolvedValue({ status: 403 });
    await expect(api.uploadFile('u', {}, 'f')).rejects.toThrow(new RetryableError('Photo storage rejected the upload (403)'));
  });

  it('treats an upload that never got an answer as a network error', async () => {
    upload.mockRejectedValue(new Error('socket closed'));
    await expect(api.uploadFile('u', {}, 'f')).rejects.toBeInstanceOf(NetworkError);
  });

  it('confirms the photo; 409 means upload it again', async () => {
    await api.confirmPhoto('p1');
    expect(apiFetch).toHaveBeenCalledWith('/api/photos/p1/confirm', { method: 'POST', token: 'jwt' });

    jest.mocked(apiFetch).mockRejectedValueOnce(new ApiError(409, 'Photo file has not been uploaded yet'));
    await expect(api.confirmPhoto('p1')).rejects.toBeInstanceOf(RetryableError);

    jest.mocked(apiFetch).mockRejectedValueOnce(new ApiError(404, 'Photo not found'));
    await expect(api.confirmPhoto('p1')).rejects.toBeInstanceOf(ApiError);
  });
});
