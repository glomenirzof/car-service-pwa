import {mediaSources} from '@/shared/media';
import {cn} from '@/lib/utils';

export function MediaImage({
  path,
  source = 'config',
  alt,
  sizes = '100vw',
  eager = false,
  className,
}: {
  path: string;
  source?: 'config' | 'owner';
  alt: string;
  sizes?: string;
  eager?: boolean;
  className?: string;
}) {
  const {src, srcSet} = mediaSources(path, source);
  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={eager ? 'high' : 'auto'}
      className={cn('app-media', className)}
    />
  );
}
