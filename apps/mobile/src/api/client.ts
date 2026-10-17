import { API_URL } from '@/config';
import type { ApiErrorCode, ApiResult } from '@/api/types';

/**
 * One fetch wrapper for the whole app: base URL, the bearer token, the
 * { ok, data } envelope, a timeout, and errors people can read. Screens only
 * ever see data or an ApiError.
 */

export type ClientErrorCode = ApiErrorCode | 'OFFLINE' | 'TIMEOUT';

export class ApiError extends Error {
  constructor(
    public code: ClientErrorCode,
    message: string,
    public status = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** No answer from the server at all (offline, wrong address, server down). */
  get unreachable() {
    return this.code === 'OFFLINE' || this.code === 'TIMEOUT';
  }
}

const TIMEOUT_MS = 15_000;

let readToken: () => string | null = () => null;
let onUnauthorized: () => void = () => {};

/** Wired up once by the session provider. */
export function configureApi(opts: { getToken: () => string | null; onUnauthorized: () => void }) {
  readToken = opts.getToken;
  onUnauthorized = opts.onUnauthorized;
}

type Options = { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; token?: string | null; signal?: AbortSignal };

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const token = opts.token === undefined ? readToken() : opts.token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  opts.signal?.addEventListener('abort', () => controller.abort());

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/m${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    if (opts.signal?.aborted) throw new ApiError('TIMEOUT', 'Cancelled.');
    if (controller.signal.aborted) throw new ApiError('TIMEOUT', 'Wildcat Clubs is taking too long to answer. Check your connection and try again.');
    throw new ApiError('OFFLINE', "Can't reach Wildcat Clubs. Check your internet connection and try again.");
  } finally {
    clearTimeout(timer);
  }

  let json: ApiResult<T> | null = null;
  try {
    json = (await res.json()) as ApiResult<T>;
  } catch {
    json = null;
  }
  if (!json || typeof json !== 'object' || !('ok' in json)) {
    throw new ApiError('ERROR', `Wildcat Clubs sent an unexpected answer (HTTP ${res.status}). Please try again in a moment.`, res.status);
  }
  if (!json.ok) {
    // The stored token stopped working (expired or signed out elsewhere): drop it. Not for a
    // token passed in (finishing an old sign-out), which says nothing about who's signed in now.
    if (res.status === 401 && token && opts.token === undefined) onUnauthorized();
    throw new ApiError(json.code, json.error, res.status);
  }
  return json.data;
}

/** A readable message for anything a screen caught. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong. Please try again.';
}
