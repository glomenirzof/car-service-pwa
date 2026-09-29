// Thin fetch client for the Edge Functions. All data goes through server
// functions: the browser never talks to tables and never sends tenant_id,
// price or duration for a booking.
import {functionsBase, env} from './env';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiFunction = 'public-api' | 'owner-api' | 'assistant';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  accessToken?: string | null;
  signal?: AbortSignal;
};

const MESSAGES: Record<string, string> = {
  slot_unavailable: 'Это время только что заняли. Выберите другое.',
  too_late: 'Изменить запись онлайн уже нельзя — позвоните в студию.',
  invalid_state: 'Запись уже изменена или отменена.',
  idempotency_conflict: 'Повторный запрос не совпадает с исходным. Обновите страницу.',
  not_found: 'Не найдено.',
  tenant_unavailable: 'Студия временно не принимает записи онлайн.',
  forbidden: 'Нет доступа.',
  unauthenticated: 'Войдите снова.',
  rate_limited: 'Слишком много запросов. Подождите немного.',
  invalid_input: 'Проверьте введённые данные.',
  conflict: 'Время пересекается с существующими записями.',
  network: 'Нет соединения. Проверьте интернет и повторите.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? error.message;
  if (error instanceof Error && error.name === 'AbortError') return 'Запрос отменён.';
  return MESSAGES.network!;
}

export async function apiRequest<T>(fn: ApiFunction, path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${functionsBase()}/${fn}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = {Accept: 'application/json'};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (env.supabaseKey) headers.apikey = env.supabaseKey;
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'network', MESSAGES.network!);
  }
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = {error: {code: 'bad_response', message: text.slice(0, 200)}};
  }
  if (!response.ok) {
    const err = (data as {error?: {code?: string; message?: string; detail?: unknown}})?.error ?? {};
    throw new ApiError(response.status, err.code ?? 'http_error', err.message ?? `HTTP ${response.status}`, err.detail);
  }
  return data as T;
}
