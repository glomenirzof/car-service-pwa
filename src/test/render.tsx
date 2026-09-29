import type {ReactElement} from 'react';
import {render} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {QueryClient} from '@tanstack/react-query';
import {AppRoot} from '@/app/AppRoot';
import {BootProvider} from '@/app/boot-context';
import type {Boot} from '@/shared/boot';

export const testBoot: Boot = {
  app: 'client',
  slug: 'alpha',
  name: 'Alpha Test Studio',
  shortName: 'Alpha',
  accent: '#33AAFF',
  background: '#0B0C0E',
  basePath: '/s/alpha',
  assetBase: '/t/alpha',
  assistantName: 'Ассистент',
};

export function renderApp(ui: ReactElement, {route = '/', boot = testBoot}: {route?: string; boot?: Boot} = {}) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return {
    queryClient,
    ...render(
      <BootProvider boot={boot}>
        <AppRoot boot={boot} queryClient={queryClient}>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </AppRoot>
      </BootProvider>,
    ),
  };
}
