// Publishes one studio's business.json into the runtime database (one SQL
// transaction in app.publish_tenant). Shared by `tenant:publish` and `cloud:prepare`.
import type postgres from 'postgres';
import {checkTenant, printReport} from './checks.ts';
import {imageMeta} from './assets.ts';
import {buildPublishPayload, configHash} from './payload.ts';

export type PublishResult = {
  configVersion: number;
  status: string;
  created: boolean;
  services: unknown;
  resources: unknown;
  preserved: unknown;
  warnings?: string[];
};

/** Validates and publishes; returns null (after printing the reasons) when the config is invalid. */
export async function publishTenant(sql: postgres.Sql, slug: string, opts: {quiet?: boolean} = {}): Promise<PublishResult | null> {
  const report = await checkTenant(slug);
  if (!opts.quiet || !report.ok) printReport(report);
  if (!report.ok || !report.config) return null;
  const payload = buildPublishPayload(report.config, await imageMeta(report.config));
  const [row] = await sql`select app.publish_tenant(${sql.json(payload as never)}, ${configHash(report.config)}) as r`;
  return row!.r as PublishResult;
}
