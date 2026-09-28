import {Suspense, type ReactNode} from 'react';
import {VStack} from '@astryxdesign/core/Stack';
import {LoadingRows} from './StateViews';

/** Suspense boundary for code-split screens (the chat UI is loaded on demand). */
export function LazyPage({children}: {children: ReactNode}) {
  return (
    <Suspense
      fallback={
        <VStack padding={4} gap={3}>
          <LoadingRows rows={3} label="Загружаем экран" />
        </VStack>
      }
    >
      {children}
    </Suspense>
  );
}
