// Reminders for a booking. States are stated honestly:
//  * push only after the user allows it and a subscription is stored;
//  * iPhone/iPad receive Web Push only when the app is added to the Home Screen;
//  * preview studios never send notifications;
//  * the calendar file is a separate, manual channel.
import {useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {VStack, HStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {BellRing, CalendarPlus} from 'lucide-react';
import {apiRequest, errorMessage} from '@/shared/api';
import {env} from '@/shared/env';
import {pushSupport} from '@/shared/platform';
import {subscribeToPush} from '@/shared/pwa';
import {downloadIcs} from '@/shared/ics-download';
import type {ClientBooking} from '@/shared/types';
import {qk} from '../api';

type Props = {slug: string; token: string; booking: ClientBooking; subscriptions: number; isPreview: boolean};

export function ReminderOptIn({slug, token, booking, subscriptions, isPreview}: Props) {
  const qc = useQueryClient();
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [icsSaved, setIcsSaved] = useState(false);
  const support = pushSupport(env.vapidPublicKey);
  const active = booking.status === 'scheduled';

  const enable = async () => {
    setState('working');
    try {
      const subscription = await subscribeToPush(slug, env.vapidPublicKey);
      await apiRequest('public-api', `/tenant/${slug}/booking/push`, {body: {token, subscription}});
      await qc.invalidateQueries({queryKey: qk.booking(slug, token)});
      setState('done');
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg === 'denied' ? 'Уведомления запрещены в настройках браузера.' : msg === 'dismissed' ? 'Разрешение не выдано.' : errorMessage(e));
      setState('error');
    }
  };

  const ics = () => {
    downloadIcs({
      id: booking.id,
      status: booking.status,
      startAt: booking.startAt,
      endAt: booking.endAt,
      serviceName: booking.service.name,
      studioName: booking.tenant.name,
      address: booking.tenant.address,
      phone: booking.tenant.phone,
      url: `${window.location.origin}/s/${slug}/bookings/${booking.id}`,
      sequence: booking.rescheduleCount,
    });
    setIcsSaved(true);
  };

  if (!active) return null;
  const subscribed = subscriptions > 0 || state === 'done';

  return (
    <VStack gap={3}>
      {isPreview ? (
        <Banner status="info" title="Демо-режим" description="Студия ещё не запущена: уведомления по демо-записям не отправляются." />
      ) : subscribed ? (
        <Banner status="success" title="Напоминания включены" description="Придут на это устройство. Если перенесёте или отмените запись, напоминание обновится." />
      ) : support.ok ? (
        <HStack gap={2} align="center">
          <BellRing size={20} aria-hidden />
          <Text>Напомнить о записи уведомлением?</Text>
        </HStack>
      ) : support.reason === 'ios-not-installed' ? (
        <Banner
          status="info"
          title="Напоминания на iPhone"
          description="Уведомления приходят только из приложения на экране «Домой»: «Поделиться» → «На экран Домой», затем откройте запись оттуда. В обычной вкладке Safari они не работают."
        />
      ) : support.reason === 'denied' ? (
        <Banner status="warning" title="Уведомления запрещены" description="Разрешите их для этого сайта в настройках браузера или добавьте запись в календарь." />
      ) : (
        <Text color="secondary">Этот браузер не поддерживает push-уведомления. Добавьте запись в календарь.</Text>
      )}
      {!isPreview && !subscribed && support.ok ? (
        <Button label="Включить напоминания" icon={<BellRing size={16} />} onClick={() => void enable()} isLoading={state === 'working'} width="100%" />
      ) : null}
      {state === 'error' ? <Text color="secondary" role="alert">{error}</Text> : null}
      <Button label="Добавить в календарь (.ics)" icon={<CalendarPlus size={16} />} variant="ghost" onClick={ics} width="100%" />
      {icsSaved ? (
        <Text type="supporting" role="status">
          Файл календаря создан. Событие появится, только если вы сохраните его в календаре. После переноса скачайте файл заново.
        </Text>
      ) : null}
    </VStack>
  );
}
