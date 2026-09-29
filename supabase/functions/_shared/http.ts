// Minimal HTTP helpers: JSON responses, CORS, typed errors, request parsing.
import {z} from 'zod';
import {allowedOrigins, optionalEnv} from './env.ts';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public detail?: unknown,
    public headers: Record<string, string> = {},
  ) {
    super(message ?? code);
  }
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = allowedOrigins();
  const allowOrigin = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0] ?? '';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(req: Request, data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Personal data must never be stored by intermediaries or the service worker.
      'Cache-Control': 'no-store',
      ...corsHeaders(req),
      ...extra,
    },
  });
}

export function errorResponse(req: Request, error: unknown): Response {
  if (error instanceof HttpError) {
    return json(req, {error: {code: error.code, message: error.message, detail: error.detail}}, error.status, error.headers);
  }
  if (error instanceof z.ZodError) {
    return json(req, {error: {code: 'invalid_input', message: 'Проверьте данные', detail: error.issues.map((i) => ({path: i.path.join('.'), message: i.message}))}}, 400);
  }
  console.error('unhandled error', error);
  return json(req, {error: {code: 'internal', message: 'Внутренняя ошибка'}}, 500);
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > 64 * 1024) throw new HttpError(413, 'payload_too_large');
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'invalid_json', 'Некорректный JSON');
  }
  return schema.parse(body);
}

export function query<T extends z.ZodType>(url: URL, schema: T): z.infer<T> {
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}

/** Path relative to the function: works for /functions/v1/<fn>/x and /<fn>/x. */
export function routePath(url: URL, fn: string): string {
  const i = url.pathname.indexOf(`/${fn}`);
  const rest = i >= 0 ? url.pathname.slice(i + fn.length + 1) : url.pathname;
  return rest === '' ? '/' : rest;
}

export type Route = {method: string; pattern: RegExp; handler: (req: Request, params: string[], url: URL) => Promise<Response>};

export function serveRoutes(fn: string, routes: Route[]) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: corsHeaders(req)});
    const url = new URL(req.url);
    const path = routePath(url, fn);
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = path.match(r.pattern);
        if (m) return await r.handler(req, m.slice(1), url);
      }
      throw new HttpError(404, 'not_found', `no route ${req.method} ${path}`);
    } catch (error) {
      return errorResponse(req, error);
    }
  };
}

/**
 * Client IP from the first configured proxy header that is present
 * (CLIENT_IP_HEADERS, default "cf-connecting-ip,x-real-ip,x-forwarded-for").
 * List only headers the hosting proxy sets itself. null when none is present:
 * callers must not lump such requests into one shared bucket.
 */
export function clientIp(req: Request): string | null {
  const names = (optionalEnv('CLIENT_IP_HEADERS') ?? 'cf-connecting-ip,x-real-ip,x-forwarded-for')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const name of names) {
    const value = req.headers.get(name)?.split(',')[0]?.trim();
    if (value) return value;
  }
  return null;
}
