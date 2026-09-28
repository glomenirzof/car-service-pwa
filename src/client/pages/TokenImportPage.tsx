// /s/<slug>/b#t=<token> — opens a booking link on another device. The token is
// in the URL fragment, so it is never sent to the web server or its logs.
import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router';
import {VStack} from '@astryxdesign/core/Stack';
import {ScreenHeader} from '@/components/app/ScreenHeader';
import {EmptyBlock, ErrorBlock, LoadingRows} from '@/components/app/StateViews';
import {apiRequest} from '@/shared/api';
import type {ClientBooking} from '@/shared/types';
import {useBoot} from '@/app/boot-context';
import {saveBooking} from '../store';

export function TokenImportPage() {
  const {slug} = useBoot();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const token = new URLSearchParams(window.location.hash.slice(1)).get('t');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiRequest<{booking: ClientBooking}>('public-api', `/tenant/${slug}/booking/get`, {body: {token}})
      .then(({booking}) => {
        if (cancelled) return;
        saveBooking(slug, {token, bookingId: booking.id, startAt: booking.startAt, serviceName: booking.service.name});
        history.replaceState(history.state, '', window.location.pathname); // drop the token from the address bar
        navigate(`/bookings/${booking.id}`, {replace: true});
      })
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [token, slug, navigate]);

  return (
    <main className="app-content" id="main">
      <ScreenHeader title="Открываем запись" back="/" />
      <VStack paddingInline={4}>
        {!token ? (
          <EmptyBlock title="Ссылка неполная" description="Откройте ссылку на запись целиком." />
        ) : error ? (
          <ErrorBlock error={error} title="Запись не найдена" />
        ) : (
          <LoadingRows rows={3} />
        )}
      </VStack>
    </main>
  );
}
