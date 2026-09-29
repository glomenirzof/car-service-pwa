// Outbox worker, invoked every minute by Supabase Cron (pg_net) with the
// x-cron-secret header. Claims due jobs with a lease, sends Web Push to every
// subscription of the job's audience and reports the outcome back. Jobs of
// preview studios / demo bookings are "suppressed" in SQL and never claimed.
import {asService} from '../_shared/db.ts';
import {HttpError, json, errorResponse, corsHeaders} from '../_shared/http.ts';
import {env, envInt} from '../_shared/env.ts';
import {timingSafeEqual} from '../_shared/crypto.ts';
import {sendPush, vapidConfigured} from '../_shared/push.ts';
import {renderNotification, type ClaimedJob} from '../_shared/notifications.ts';

export type DispatchSummary = {claimed: number; sent: number; retried: number; failed: number; lostLease: number; pushes: number};

export async function dispatchOnce(workerId: string, limit: number, now = new Date()): Promise<DispatchSummary> {
  const summary: DispatchSummary = {claimed: 0, sent: 0, retried: 0, failed: 0, lostLease: 0, pushes: 0};
  const jobs = await asService(async (tx) => {
    const rows = await tx`select app.claim_notification_jobs(${workerId}, ${limit}, ${envInt('PUSH_LEASE_SECONDS', 120)}) as r`;
    return rows[0]!.r as ClaimedJob[];
  });
  summary.claimed = jobs.length;
  for (const job of jobs) {
    const payload = renderNotification(job, now);
    const results = await Promise.all(job.subscriptions.map((s) => sendPush(s, payload)));
    summary.pushes += results.length;
    const delivered = results.filter((r) => r.ok).length;
    const gone = results.filter((r) => r.gone).map((r) => r.endpoint);
    const retryable = results.some((r) => r.retryable);
    const outcome = delivered > 0 ? 'sent' : retryable ? 'retry' : 'failed';
    const error = delivered === results.length ? null : results.filter((r) => !r.ok).map((r) => `${r.status}${r.error ? ` ${r.error}` : ''}`).join(', ');
    const ok = await asService(async (tx) => {
      const rows = await tx`select app.finish_notification_job(${job.id}, ${workerId}, ${outcome}, ${error}, ${delivered}, ${gone}) as ok`;
      return rows[0]!.ok as boolean;
    });
    if (!ok) summary.lostLease++;
    else if (outcome === 'sent') summary.sent++;
    else if (outcome === 'retry') summary.retried++;
    else summary.failed++;
  }
  return summary;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: corsHeaders(req)});
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
    const secret = req.headers.get('x-cron-secret') ?? '';
    if (!timingSafeEqual(secret, env('CRON_SECRET'))) throw new HttpError(401, 'unauthenticated');
    if (!vapidConfigured()) throw new HttpError(503, 'push_not_configured', 'VAPID keys are not set');
    const workerId = `edge-${crypto.randomUUID()}`;
    const deadline = Date.now() + envInt('PUSH_DISPATCH_BUDGET_MS', 20_000);
    const total: DispatchSummary = {claimed: 0, sent: 0, retried: 0, failed: 0, lostLease: 0, pushes: 0};
    while (Date.now() < deadline) {
      const s = await dispatchOnce(workerId, 25);
      for (const k of Object.keys(total) as (keyof DispatchSummary)[]) total[k] += s[k];
      if (s.claimed < 25) break;
    }
    return json(req, {worker: workerId, ...total});
  } catch (error) {
    return errorResponse(req, error);
  }
}
