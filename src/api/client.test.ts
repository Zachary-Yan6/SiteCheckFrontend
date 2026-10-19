import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { API_URL } from '@/config';

import { ApiError, apiFetch, NetworkError } from './client';

const fetchMock = jest.fn<typeof fetch>();

function respond(status: number, body?: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('apiFetch', () => {
  beforeEach(() => {
    global.fetch = fetchMock;
  });

  afterEach(() => {
    fetchMock.mockReset();
    jest.useRealTimers();
  });

  it('sends JSON with the token and returns the parsed body', async () => {
    respond(200, { id: 1 });

    await expect(apiFetch('/api/things', { method: 'POST', body: { a: 1 }, token: 'jwt' })).resolves.toEqual({ id: 1 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_URL}/api/things`);
    expect(init).toMatchObject({
      method: 'POST',
      body: '{"a":1}',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer jwt' },
    });
  });

  it('defaults to a GET without body or token', async () => {
    respond(200, []);
    await apiFetch('/api/things');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', body: undefined, headers: { Accept: 'application/json' } });
  });

  it('returns undefined for 204 No Content', async () => {
    respond(204);
    await expect(apiFetch('/api/devices', { method: 'POST', body: {} })).resolves.toBeUndefined();
  });

  it('turns a problem+json error into an ApiError with the server message', async () => {
    respond(409, { status: 409, title: 'Conflict', detail: 'An account with this email already exists' });
    const error = await apiFetch('/api/auth/register').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, message: 'An account with this email already exists', name: 'ApiError' });
  });

  it('still gives an ApiError when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ status: 502, message: 'Request failed (502)' });
  });

  it('turns a failed connection into a NetworkError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    const error = await apiFetch('/api/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({ name: 'NetworkError', message: 'No connection to the server' });
  });

  it('gives up after 15 seconds on a hanging request', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const request = apiFetch('/api/x').catch((e: unknown) => e);
    jest.advanceTimersByTime(15_000);

    expect(await request).toBeInstanceOf(NetworkError);
  });
});
