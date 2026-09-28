import {storagePublicUrl} from './env';

/** Pipeline images are static WebP pairs (-800/-1600); owner uploads live in Storage. */
export function mediaSources(path: string, source: 'config' | 'owner' = 'config'): {src: string; srcSet?: string} {
  if (source === 'owner') return {src: storagePublicUrl(path)};
  return {src: `${path}-800.webp`, srcSet: `${path}-800.webp 800w, ${path}-1600.webp 1600w`};
}
