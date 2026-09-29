import {useMemo, useState, type ReactNode} from 'react';
import {Theme} from '@astryxdesign/core/theme';
import {LinkProvider} from '@astryxdesign/core/Link';
import {InternationalizationProvider} from '@astryxdesign/core/i18n';
import ru from '@astryxdesign/core/locales/ru-RU.json';
import {QueryClientProvider, type QueryClient} from '@tanstack/react-query';
import {tenantTheme} from './theme';
import {createQueryClient} from './query';
import {RouterLink} from './RouterLink';
import type {Boot} from '@/shared/boot';

export function AppRoot({boot, children, queryClient}: {boot: Boot; children: ReactNode; queryClient?: QueryClient}) {
  const theme = useMemo(() => tenantTheme(boot.slug, boot.accent, boot.background), [boot.slug, boot.accent, boot.background]);
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <InternationalizationProvider locale="ru-RU" messages={{'ru-RU': ru}}>
      <Theme theme={theme} mode="dark">
        <QueryClientProvider client={client}>
          <LinkProvider component={RouterLink}>{children}</LinkProvider>
        </QueryClientProvider>
      </Theme>
    </InternationalizationProvider>
  );
}
