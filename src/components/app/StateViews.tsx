// Shared network-state views: every screen that loads data renders one of
// loading / error / empty / content, never a blank area.
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {VStack} from '@astryxdesign/core/Stack';
import type {ReactNode} from 'react';
import {errorMessage} from '@/shared/api';

export function LoadingRows({rows = 4, height = 56, label = 'Загрузка'}: {rows?: number; height?: number; label?: string}) {
  return (
    <VStack gap={2} role="status" aria-live="polite" aria-label={label} data-state="loading">
      {Array.from({length: rows}, (_, i) => (
        <Skeleton key={i} index={i} height={height} radius={3} />
      ))}
    </VStack>
  );
}

export function ErrorBlock({error, onRetry, title = 'Не удалось загрузить'}: {error: unknown; onRetry?: () => void; title?: string}) {
  return (
    <Banner
      status="error"
      title={title}
      description={errorMessage(error)}
      data-state="error"
      endContent={onRetry ? <Button label="Повторить" size="sm" onClick={onRetry} /> : undefined}
    />
  );
}

export function EmptyBlock({title, description, actions, icon}: {title: string; description?: string; actions?: ReactNode; icon?: ReactNode}) {
  return (
    <VStack data-state="empty" paddingBlock={6}>
      <EmptyState title={title} description={description} actions={actions} icon={icon} isCompact />
    </VStack>
  );
}
