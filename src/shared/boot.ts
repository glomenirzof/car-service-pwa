// Tenant boot config rendered into the HTML shell by the tenant pipeline.
// Static per studio (name, accent, paths); runtime data comes from the API.
import {z} from 'zod';

const bootSchema = z.object({
  app: z.enum(['client', 'owner']),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  shortName: z.string(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  basePath: z.string().startsWith('/s/'),
  assetBase: z.string().startsWith('/t/'),
  assistantName: z.string(),
});

export type Boot = z.infer<typeof bootSchema>;

let cached: Boot | null = null;

export function readBoot(doc: Document = document): Boot {
  if (cached && doc === document) return cached;
  const el = doc.getElementById('tenant-boot');
  if (!el?.textContent) throw new Error('tenant boot config is missing from the page');
  const boot = bootSchema.parse(JSON.parse(el.textContent));
  if (doc === document) cached = boot;
  return boot;
}

export function setBootForTests(boot: Boot) {
  cached = boot;
}
