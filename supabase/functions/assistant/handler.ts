// AI assistant for clients (/client, anonymous, per studio) and owners
// (/owner, verified JWT + membership). Budget and rate limits are shared
// atomic counters in Postgres. If the LLM is unavailable the endpoint answers
// 503 — booking itself never depends on it.
import {asAnon, asUser, one} from '../_shared/db.ts';
import {HttpError, json, readJson, serveRoutes, clientIp} from '../_shared/http.ts';
import {ipKey} from '../_shared/crypto.ts';
import {requireOwner} from '../_shared/auth.ts';
import {enforce, hit, usage} from '../_shared/limits.ts';
import {envInt, optionalEnv} from '../_shared/env.ts';
import {clientAssistantBody, ownerAssistantBody} from '../_shared/core/contract.ts';
import {llmConfigured, LlmUnavailable, LlmToolsUnsupported} from '../_shared/assistant/llm.ts';
import {route, type RouterMode} from '../_shared/assistant/router.ts';
import type {ClientContext, OwnerContext, ServiceBrief} from '../_shared/assistant/tools.ts';

const DAY = 86_400;

function mode(): RouterMode {
  const m = optionalEnv('LLM_ROUTER') ?? 'auto';
  return m === 'tools' || m === 'json' ? m : 'auto';
}

async function budget(tenantId: string) {
  // Requests per studio per day (atomic), then token ceilings per studio and globally.
  const req = await hit({bucket: `llm:req:${tenantId}`, windowSeconds: DAY, max: envInt('LLM_TENANT_DAILY_REQUESTS', 300)});
  const tenantTokens = await usage(`llm:tok:${tenantId}`, DAY);
  const globalTokens = await usage('llm:tok:global', DAY);
  if (!req.allowed || tenantTokens >= envInt('LLM_TENANT_DAILY_TOKENS', 300_000) || globalTokens >= envInt('LLM_GLOBAL_DAILY_TOKENS', 3_000_000)) {
    throw new HttpError(429, 'ai_budget_exhausted', 'Ассистент на сегодня исчерпал лимит. Запишитесь через каталог услуг.');
  }
  return async (tokens: number) => {
    await hit({bucket: `llm:tok:${tenantId}`, windowSeconds: DAY, max: Number.MAX_SAFE_INTEGER, cost: tokens});
    await hit({bucket: 'llm:tok:global', windowSeconds: DAY, max: Number.MAX_SAFE_INTEGER, cost: tokens});
  };
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof LlmUnavailable || error instanceof LlmToolsUnsupported) {
      console.error('assistant unavailable', error.message);
      throw new HttpError(503, 'ai_unavailable', 'Ассистент временно недоступен. Запись работает как обычно.');
    }
    throw error;
  }
}

type PublicTenant = {slug: string; name: string; timezone: string; profile: {ai?: {enabled?: boolean}} & Record<string, unknown>; services: ServiceBrief[]};

export const handler = serveRoutes('assistant', [
  {
    method: 'POST',
    pattern: /^\/client$/,
    handler: async (req) => {
      const body = await readJson(req, clientAssistantBody);
      const ip = await ipKey(clientIp(req));
      await enforce({bucket: `ai:ip:${ip}`, windowSeconds: 60, max: envInt('RL_AI_PER_MIN', 8)}, {bucket: `ai:ipd:${ip}`, windowSeconds: DAY, max: envInt('RL_AI_PER_DAY', 60)});
      if (!llmConfigured()) throw new HttpError(503, 'ai_unavailable', 'Ассистент не настроен. Запись работает как обычно.');
      const tenant = await asAnon(async (tx) => one<PublicTenant | null>(await tx`select app.public_tenant(${body.slug}) as r`));
      if (!tenant) throw new HttpError(404, 'tenant_unavailable');
      if (tenant.profile.ai?.enabled === false) throw new HttpError(404, 'ai_disabled', 'Ассистент отключён в этой студии');
      const [row] = await asAnon(async (tx) => tx`select app.tenant_id_for_public(${body.slug}) as id`);
      const tenantId = row!.id as string;
      const meter = await budget(tenantId);
      const ctx: ClientContext = {scope: 'client', tenantId, slug: tenant.slug, name: tenant.name, timezone: tenant.timezone, profile: tenant.profile, services: tenant.services, tokens: body.tokens, now: new Date()};
      const result = await run(() => route(ctx, body.messages, mode(), meter));
      const {tokens: _t, ...reply} = result;
      return json(req, reply);
    },
  },
  {
    method: 'POST',
    pattern: /^\/owner$/,
    handler: async (req) => {
      const claims = await requireOwner(req);
      const body = await readJson(req, ownerAssistantBody);
      await enforce({bucket: `ai:owner:${claims.sub}`, windowSeconds: 60, max: envInt('RL_AI_OWNER_PER_MIN', 20)});
      if (!llmConfigured()) throw new HttpError(503, 'ai_unavailable', 'Ассистент не настроен.');
      // Membership is verified by the database (owner_tenant asserts it).
      const tenant = await asUser(claims, async (tx) =>
        one<{tenantId: string; slug: string; name: string; timezone: string; services: (ServiceBrief & {isActive: boolean})[]}>(await tx`select app.owner_tenant(${body.tenantId}) as r`),
      );
      const meter = await budget(tenant.tenantId);
      const ctx: OwnerContext = {
        scope: 'owner', tenantId: tenant.tenantId, slug: tenant.slug, name: tenant.name, timezone: tenant.timezone, claims,
        services: tenant.services.filter((s) => s.isActive), now: new Date(),
      };
      const result = await run(() => route(ctx, body.messages, mode(), meter));
      const {tokens: _t, ...reply} = result;
      return json(req, reply);
    },
  },
]);
