import {Button} from '@astryxdesign/core/Button';
import {Heading} from '@astryxdesign/core/Heading';
import {List, ListItem} from '@astryxdesign/core/List';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {ChevronRight} from 'lucide-react';
import {ScreenHeader} from '@/components/app/ScreenHeader';
import {EmptyBlock, LoadingRows} from '@/components/app/StateViews';
import {dateShort, time, STATUS_LABEL} from '@/shared/format';
import {useBoot} from '@/app/boot-context';
import {useStudio} from '../studio-context';
import {useBookings} from '../api';
import {forgetBooking, useSavedBookings} from '../store';
import {useBookingSheet} from '../booking/useBookingSheet';
import type {BookingStatus} from '@/shared/types';
import {useNow} from '@/shared/use-now';

const DOT: Record<BookingStatus, 'success' | 'warning' | 'error' | 'accent' | 'neutral'> = {
  scheduled: 'accent',
  arrived: 'warning',
  completed: 'success',
  cancelled: 'neutral',
  no_show: 'error',
};

export function MyBookingsPage() {
  const {slug} = useBoot();
  const studio = useStudio();
  const sheet = useBookingSheet();
  const saved = useSavedBookings(slug);
  const queries = useBookings(slug, saved.map((s) => s.token));

  const now = useNow();
  const rows = saved.map((s, i) => ({saved: s, q: queries[i]!}));
  const loaded = rows.filter((r) => r.q.data);
  const upcoming = loaded
    .filter((r) => ['scheduled', 'arrived'].includes(r.q.data!.booking.status) && new Date(r.q.data!.booking.endAt).getTime() > now - 86_400_000)
    .sort((a, b) => a.q.data!.booking.startAt.localeCompare(b.q.data!.booking.startAt));
  const past = loaded.filter((r) => !upcoming.includes(r)).sort((a, b) => b.q.data!.booking.startAt.localeCompare(a.q.data!.booking.startAt));
  const failed = rows.filter((r) => r.q.isError);
  const pending = rows.some((r) => r.q.isPending);

  return (
    <main className="app-content" id="main">
      <ScreenHeader title="Мои записи" />
      <VStack gap={5} paddingInline={4}>
        {saved.length === 0 ? (
          <EmptyBlock
            title="Здесь появятся ваши записи"
            description="Записи хранятся на этом устройстве. Если вы записывались с другого телефона, откройте ссылку на запись."
            actions={<Button label="Записаться" variant="primary" onClick={() => sheet.start()} />}
          />
        ) : null}
        {pending && loaded.length === 0 ? <LoadingRows rows={Math.min(saved.length, 3)} height={64} /> : null}
        {upcoming.length ? (
          <VStack gap={2}>
            <Heading level={2}>Предстоящие</Heading>
            <List hasDividers density="spacious">
              {upcoming.map(({saved: s, q}) => {
                const b = q.data!.booking;
                return (
                  <ListItem
                    key={s.bookingId}
                    label={b.service.name}
                    description={`${dateShort(b.startAt, studio.timezone)}, ${time(b.startAt, studio.timezone)} · ${STATUS_LABEL[b.status]}`}
                    startContent={<StatusDot variant={DOT[b.status]} label={STATUS_LABEL[b.status]!} />}
                    endContent={<ChevronRight size={18} aria-hidden />}
                    href={`/bookings/${s.bookingId}`}
                    data-testid="my-booking-row"
                  />
                );
              })}
            </List>
          </VStack>
        ) : null}
        {past.length ? (
          <VStack gap={2}>
            <Heading level={2}>История</Heading>
            <List hasDividers>
              {past.map(({saved: s, q}) => {
                const b = q.data!.booking;
                return (
                  <ListItem
                    key={s.bookingId}
                    label={b.service.name}
                    description={`${dateShort(b.startAt, studio.timezone)} · ${STATUS_LABEL[b.status]}`}
                    startContent={<StatusDot variant={DOT[b.status]} label={STATUS_LABEL[b.status]!} />}
                    href={`/bookings/${s.bookingId}`}
                  />
                );
              })}
            </List>
          </VStack>
        ) : null}
        {failed.length ? (
          <VStack gap={2}>
            <Text color="secondary">Не удалось загрузить {failed.length} из сохранённых записей.</Text>
            {failed.map(({saved: s, q}) => (
              <List key={s.bookingId}>
                <ListItem
                  label={s.serviceName}
                  description={q.error instanceof Error && 'status' in q.error && (q.error as {status: number}).status === 404 ? 'Запись больше недоступна' : 'Ошибка сети'}
                  endContent={
                    <Button label="Убрать" size="sm" variant="ghost" onClick={() => forgetBooking(slug, s.bookingId)} />
                  }
                />
              </List>
            ))}
          </VStack>
        ) : null}
      </VStack>
    </main>
  );
}
