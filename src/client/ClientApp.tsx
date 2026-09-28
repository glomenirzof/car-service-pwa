import {useState} from 'react';
import {createBrowserRouter, RouterProvider, Outlet, useRouteError} from 'react-router';
import {Button} from '@astryxdesign/core/Button';
import {VStack} from '@astryxdesign/core/Stack';
import {AppRoot} from '@/app/AppRoot';
import {BootProvider, useBoot} from '@/app/boot-context';
import {EmptyBlock, ErrorBlock, LoadingRows} from '@/components/app/StateViews';
import type {Boot} from '@/shared/boot';
import {useTenant} from './api';
import {StudioProvider} from './studio-context';
import {ClientLayout} from './ClientLayout';
import {HomePage} from './pages/HomePage';
import {ServicesPage} from './pages/ServicesPage';
import {MyBookingsPage} from './pages/MyBookingsPage';
import {BookingPage} from './pages/BookingPage';
import {AssistantPage} from './pages/AssistantPage';
import {TokenImportPage} from './pages/TokenImportPage';

function StudioGate() {
  const {slug} = useBoot();
  const tenant = useTenant(slug);
  if (tenant.isPending) {
    return (
      <VStack padding={4} gap={4} className="min-h-[100dvh]">
        <LoadingRows rows={1} height={320} label="Загружаем студию" />
        <LoadingRows rows={3} />
      </VStack>
    );
  }
  if (tenant.isError) {
    return (
      <VStack padding={4} className="min-h-[100dvh] justify-center">
        <ErrorBlock error={tenant.error} onRetry={() => void tenant.refetch()} title="Студия недоступна" />
      </VStack>
    );
  }
  return (
    <StudioProvider tenant={tenant.data}>
      <Outlet />
    </StudioProvider>
  );
}

function RouteError() {
  const error = useRouteError();
  return (
    <VStack padding={4} gap={3}>
      <ErrorBlock error={error} title="Что-то пошло не так" />
      <Button label="На главную" href="/" />
    </VStack>
  );
}

function NotFound() {
  return (
    <main className="app-content" id="main">
      <VStack padding={4}>
        <EmptyBlock title="Страница не найдена" actions={<Button label="На главную" variant="primary" href="/" />} />
      </VStack>
    </main>
  );
}

export function createClientRouter(boot: Boot) {
  return createBrowserRouter(
    [
      {
        element: <StudioGate />,
        errorElement: <RouteError />,
        children: [
          {
            element: <ClientLayout />,
            children: [
              {index: true, element: <HomePage />},
              {path: 'services', element: <ServicesPage />},
              {path: 'bookings', element: <MyBookingsPage />},
              {path: 'bookings/:bookingId', element: <BookingPage />},
              {path: 'assistant', element: <AssistantPage />},
              {path: 'b', element: <TokenImportPage />},
              {path: '*', element: <NotFound />},
            ],
          },
        ],
      },
    ],
    {basename: boot.basePath},
  );
}

export function ClientApp({boot}: {boot: Boot}) {
  const [router] = useState(() => createClientRouter(boot));
  return (
    <BootProvider boot={boot}>
      <AppRoot boot={boot}>
        <RouterProvider router={router} />
      </AppRoot>
    </BootProvider>
  );
}
