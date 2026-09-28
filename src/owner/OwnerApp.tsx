import {useState} from 'react';
import {createBrowserRouter, RouterProvider, useRouteError} from 'react-router';
import {Button} from '@astryxdesign/core/Button';
import {VStack} from '@astryxdesign/core/Stack';
import {AppRoot} from '@/app/AppRoot';
import {BootProvider} from '@/app/boot-context';
import {EmptyBlock, ErrorBlock} from '@/components/app/StateViews';
import type {Boot} from '@/shared/boot';
import {AuthProvider} from './auth';
import {OwnerGate} from './OwnerGate';
import {OwnerLayout} from './OwnerLayout';
import {SchedulePage} from './pages/SchedulePage';
import {OwnerBookingPage} from './pages/OwnerBookingPage';
import {StatsPage} from './pages/StatsPage';
import {SearchPage} from './pages/SearchPage';
import {OwnerAssistantPage} from './pages/OwnerAssistantPage';
import {MorePage} from './pages/MorePage';

function RouteError() {
  const error = useRouteError();
  return (
    <VStack padding={4} gap={3}>
      <ErrorBlock error={error} title="Что-то пошло не так" />
      <Button label="К расписанию" href="/" />
    </VStack>
  );
}

export function createOwnerRouter(boot: Boot) {
  return createBrowserRouter(
    [
      {
        element: <OwnerGate />,
        errorElement: <RouteError />,
        children: [
          {
            element: <OwnerLayout />,
            children: [
              {index: true, element: <SchedulePage />},
              {path: 'bookings/:bookingId', element: <OwnerBookingPage />},
              {path: 'stats', element: <StatsPage />},
              {path: 'search', element: <SearchPage />},
              {path: 'assistant', element: <OwnerAssistantPage />},
              {path: 'more', element: <MorePage />},
              {path: '*', element: <EmptyBlock title="Страница не найдена" actions={<Button label="К расписанию" href="/" />} />},
            ],
          },
        ],
      },
    ],
    {basename: boot.basePath},
  );
}

export function OwnerApp({boot}: {boot: Boot}) {
  const [router] = useState(() => createOwnerRouter(boot));
  return (
    <BootProvider boot={boot}>
      <AppRoot boot={boot}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </AppRoot>
    </BootProvider>
  );
}
