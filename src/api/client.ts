import { API_URL } from '@/config';

/**
 * The server answered with an error status. `status` drives what the sync queue does later:
 * 401 -> ask for a new login, other 4xx -> mark failed, 5xx -> retry with backoff.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The request never got an answer (no signal, server down, timeout). Always worth retrying. */
export class NetworkError extends Error {
  constructor(message = 'No connection to the server') {
    super(message);
    this.name = 'NetworkError';
  }
}

const TIMEOUT_MS = 15_000;

/** JSON request to the backend. Throws ApiError or NetworkError, never a raw fetch error. */
export async function apiFetch<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; token?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  // Weak signal can leave a request hanging for minutes; give up and let the caller retry.
  // AbortController is a built-in JavaScript api for cancelling operation.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  // signal is used to abort this request.
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch {
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // The backend sends RFC 7807 problem+json: { status, title, detail }.
    const problem = await response.json().catch(() => null);
    throw new ApiError(response.status, problem?.detail ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T; // No Content, e.g. registering a push token
  }
  return (await response.json()) as T;
}
