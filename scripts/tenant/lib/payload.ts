// Converts a validated business.json into the payload accepted by
// app.publish_tenant(). Pure function: used by tenant:publish, the seed
// generator and SQL tests.
import {createHash} from 'node:crypto';
import {WEEKDAYS, type BusinessConfig} from '../../../supabase/functions/_shared/core/tenant-config.ts';

export type PublishPayload = {
  tenant: {
    slug: string;
    name: string;
    shortName: string;
    timezone: string;
    currency: string;
    locale: string;
    profile: Record<string, unknown>;
  };
  resources: Array<{key: string; name: string; kind: string; description?: string; capabilities: string[]}>;
  services: Array<{
    key: string;
    name: string;
    category: string;
    description: string;
    durationMinutes: number;
    bufferMinutes: number;
    completion: string;
    capability: string;
    priceAmount: number;
    priceIsFrom: boolean;
    imagePath: string | null;
    popular: boolean;
  }>;
  workingHours: Array<{weekday: number; opens: string; closes: string}>;
  exceptions: Array<{date: string; opens: string | null; closes: string | null; note: string | null}>;
  media: Array<{kind: 'hero' | 'gallery'; path: string; alt: string; width: number | null; height: number | null; sortOrder: number}>;
};

/** Static URL base (without size suffix) of a processed pipeline image. */
export function mediaBase(slug: string, file: string): string {
  const stem = file.replace(/^images\//, '').replace(/\.[a-z]+$/i, '');
  return `/t/${slug}/media/${stem}`;
}

export type ImageMeta = Record<string, {width: number; height: number}>;

export function buildPublishPayload(cfg: BusinessConfig, images: ImageMeta = {}): PublishPayload {
  const meta = (file: string) => images[file] ?? {width: null, height: null};
  return {
    tenant: {
      slug: cfg.slug,
      name: cfg.name,
      shortName: cfg.shortName,
      timezone: cfg.timezone,
      currency: cfg.currency,
      locale: cfg.locale,
      profile: {
        tagline: cfg.tagline,
        description: cfg.description,
        contacts: cfg.contacts,
        brand: {
          accent: cfg.brand.accent,
          background: cfg.brand.background,
          logo: `/t/${cfg.slug}/logo.svg`,
          hero: mediaBase(cfg.slug, cfg.brand.hero),
        },
        booking: cfg.booking,
        ai: cfg.ai,
        legal: cfg.legal,
      },
    },
    resources: cfg.resources.map((r) => ({
      key: r.key,
      name: r.name,
      kind: r.kind,
      ...(r.description ? {description: r.description} : {}),
      capabilities: r.capabilities,
    })),
    services: cfg.services.map((s) => ({
      key: s.key,
      name: s.name,
      category: s.category,
      description: s.description,
      durationMinutes: s.durationMinutes,
      bufferMinutes: s.bufferMinutes,
      completion: s.completion,
      capability: s.capability,
      priceAmount: s.price.amount,
      priceIsFrom: s.price.from,
      imagePath: s.image ? mediaBase(cfg.slug, s.image) : null,
      popular: s.popular,
    })),
    workingHours: WEEKDAYS.flatMap((day, i) =>
      cfg.workingHours[day].map(([opens, closes]) => ({weekday: i + 1, opens, closes})),
    ),
    exceptions: cfg.exceptions.flatMap((e): PublishPayload['exceptions'] =>
      e.hours.length === 0
        ? [{date: e.date, opens: null, closes: null, note: e.note ?? null}]
        : e.hours.map(([opens, closes]) => ({date: e.date, opens, closes, note: e.note ?? null})),
    ),
    media: [
      {kind: 'hero' as const, path: mediaBase(cfg.slug, cfg.brand.hero), alt: cfg.name, ...meta(cfg.brand.hero), sortOrder: 0},
      ...cfg.gallery.map((g, i) => ({
        kind: 'gallery' as const,
        path: mediaBase(cfg.slug, g.file),
        alt: g.alt,
        ...meta(g.file),
        sortOrder: i + 1,
      })),
    ],
  };
}

/** Stable hash of the normalized config (key order independent). */
export function configHash(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
