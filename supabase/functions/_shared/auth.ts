// Owner authentication: verifies the Supabase Auth access token on the server.
// Asymmetric keys (default for new projects) are verified against the project
// JWKS; a legacy HS256 secret can be supplied via AUTH_JWT_SECRET.
// Tenant access is NOT taken from the token — it is checked against
// app.tenant_members inside the database for every owner call.
import {createRemoteJWKSet, jwtVerify, type JWTPayload} from 'jose';
import {optionalEnv} from './env.ts';
import {HttpError} from './http.ts';
import type {Claims} from './db.ts';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksUrl = '';

function issuer(): string | undefined {
  const url = optionalEnv('SUPABASE_URL');
  return url ? `${url.replace(/\/$/, '')}/auth/v1` : optionalEnv('AUTH_JWT_ISSUER');
}

export async function verifyAccessToken(token: string): Promise<Claims> {
  let payload: JWTPayload;
  try {
    const secret = optionalEnv('AUTH_JWT_SECRET');
    const iss = optionalEnv('AUTH_JWT_ISSUER') ?? issuer();
    const options = {audience: 'authenticated', ...(iss ? {issuer: iss} : {})};
    if (secret) {
      ({payload} = await jwtVerify(token, new TextEncoder().encode(secret), {...options, algorithms: ['HS256']}));
    } else {
      const url = optionalEnv('AUTH_JWKS_URL') ?? (iss ? `${iss}/.well-known/jwks.json` : undefined);
      if (!url) throw new Error('no JWKS URL configured');
      if (!jwks || jwksUrl !== url) {
        jwks = createRemoteJWKSet(new URL(url), {cooldownDuration: 30_000, cacheMaxAge: 600_000});
        jwksUrl = url;
      }
      ({payload} = await jwtVerify(token, jwks, {...options, algorithms: ['ES256', 'RS256', 'EdDSA']}));
    }
  } catch (error) {
    throw new HttpError(401, 'unauthenticated', 'Сессия истекла, войдите снова', (error as Error).message);
  }
  if (payload.role !== 'authenticated' || typeof payload.sub !== 'string') {
    throw new HttpError(401, 'unauthenticated', 'Нужен вход владельца');
  }
  return {sub: payload.sub, role: 'authenticated', email: typeof payload.email === 'string' ? payload.email : undefined};
}

export async function requireOwner(req: Request): Promise<Claims> {
  const header = req.headers.get('authorization') ?? '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new HttpError(401, 'unauthenticated', 'Нужен вход владельца');
  return verifyAccessToken(m[1]!);
}
