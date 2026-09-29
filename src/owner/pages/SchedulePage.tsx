import {useState} from 'react';
import {useNavigate, useSearchParams} from 'react-router';
import {Button} from '@astryxdesign/core/Button';
import {Heading} from '@astryxdesign/core/Heading';
import {IconButton} from '@astryxdesign/core/IconButton';
import {List, ListItem} from '@astryxdesign/core/List';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Stack';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {ChevronLeft, ChevronRight, Lock, Plus, Search} from 'lucide-react';
import {ScreenHeader} from '@/components/app/ScreenHeader';
import {EmptyBlock, ErrorBlock, LoadingRows} from '@/components/app/StateViews';
import {addDays, localDate} from '@shared/periods';
import {dateLong, dateShort, money, plural, STATUS_LABEL, time} from '@/shared/format';
import {useNow} from '@/shared/use-now';
import {useOwnerStudio} from '../owner-context';
import {useSchedule} from '../api';
import {NewBookingSheet} from '../sheets/NewBookingSheet';
import {BlockSheet} from '../sheets/BlockSheet';
import type {ScheduleBooking} from '../types';

const DOT = {scheduled: 'accent', arrived: 'warning', completed: 'success', cancelled: 'neutral', no_show: 'error'} as const;

export function SchedulePage() {
  const studio = useOwnerStudio();
  const navigate = useNavigate();
  const now = useNow();
  const today = localDate(new Date(now), studio.timezone);
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? today;
  const setDate = (d: string) => setParams(d === today ? {} : {date: d}, {replace: true});
  const [sheet, setSheet] = useState<'new' | 'block' | null>(null);
  const q = useSchedule(studio.tenantId, date, date);

  const dayStart = q.data ? new Date(q.data.period.startsAt).getTime() : 0;
  const tz = studio.timezone;
  const label = (b: ScheduleBooking) => {
    const started = new Date(b.startAt).getTime() < dayStart;
    const endsLater = new Date(b.endAt).getTime() > dayStart + 86_400_000;
    const range = started
      ? `с ${dateShort(b.startAt, tz)} до ${endsLater ? dateShort(b.endAt, tz) : time(b.endAt, tz)}`
      : `${time(b.startAt, tz)}–${endsLater ? `до ${dateShort(b.endAt, tz)}` : time(b.endAt, tz)}`;
    return `${range} · ${b.serviceName}`;
  };

  return (
    <main className="app-content" id="main">
      <ScreenHeader
        title="Расписание"
        actions={
          <HStack gap={1}>
            <IconButton icon={<Search size={20} />} label="Поиск записи" variant="ghost" onClick={() => navigate('/search')} />
            <IconButton icon={<Plus size={20} />} label="Новая запись" variant="ghost" onClick={() => setSheet('new')} />
          </HStack>
        }
      />
      <VStack gap={4} paddingInline={4}>
        <HStack gap={2} align="center">
          <IconButton icon={<ChevronLeft size={20} />} label="Предыдущий день" onClick={() => setDate(addDays(date, -1))} />
          <StackItem size="fill">
            <VStack gap={0} hAlign="center">
              <Text weight="semibold" data-testid="schedule-date">
                {date === today ? 'Сегодня, ' : ''}
                {dateLong(`${date}T12:00:00Z`, 'UTC')}
              </Text>
              {date !== today ? (
                <Button label="К сегодня" size="sm" variant="ghost" onClick={() => setDate(today)} />
              ) : null}
            </VStack>
          </StackItem>
          <IconButton icon={<ChevronRight size={20} />} label="Следующий день" onClick={() => setDate(addDays(date, 1))} />
        </HStack>

        {q.isPending ? <LoadingRows rows={5} /> : null}
        {q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : null}
        {q.data ? (
          <>
            <Text color="secondary">
              {(() => {
                const n = q.data.bookings.filter((b) => b.status !== 'cancelled').length;
                const k = q.data.blocks.length;
                return `${n} ${plural(n, 'запись', 'записи', 'записей')} · ${k} ${plural(k, 'блокировка', 'блокировки', 'блокировок')}`;
              })()}
            </Text>
            {q.data.resources.length === 0 ? <EmptyBlock title="Нет постов" /> : null}
            {q.data.resources.map((r) => {
              const bookings = q.data!.bookings.filter((b) => b.resourceId === r.id);
              const blocks = q.data!.blocks.filter((b) => b.resourceId === r.id);
              return (
                <VStack key={r.id} gap={1} data-testid={`resource-${r.id}`}>
                  <HStack gap={2} align="center">
                    <Heading level={2} className="text-base">
                      {r.name}
                    </Heading>
                    {r.isPaused ? <Token label="На паузе" size="sm" color="yellow" /> : null}
                    {!r.isActive ? <Token label="Выключен" size="sm" color="gray" /> : null}
                  </HStack>
                  {bookings.length === 0 && blocks.length === 0 ? (
                    <Text type="supporting">Свободно весь день</Text>
                  ) : (
                    <List hasDividers density="compact">
                      {[...bookings.map((b) => ({t: b.startAt, b})), ...blocks.map((k) => ({t: k.from, k}))]
                        .sort((x, y) => x.t.localeCompare(y.t))
                        .map((item) =>
                          'b' in item ? (
                            <ListItem
                              key={item.b.id}
                              label={label(item.b)}
                              description={[item.b.customerName, item.b.car, item.b.carPlate, item.b.isDemo ? 'демо' : null].filter(Boolean).join(' · ')}
                              startContent={<StatusDot variant={DOT[item.b.status]} label={STATUS_LABEL[item.b.status]!} />}
                              endContent={
                                item.b.status === 'completed' ? (
                                  <Text type="supporting" hasTabularNumbers>
                                    {item.b.paid >= (item.b.finalAmount ?? 0) ? 'оплачено' : `долг ${money((item.b.finalAmount ?? 0) - item.b.paid)}`}
                                  </Text>
                                ) : undefined
                              }
                              href={`/bookings/${item.b.id}`}
                              data-testid="owner-booking-row"
                            />
                          ) : (
                            <ListItem
                              key={item.k.id}
                              label={`${time(item.k.from, tz)}–${time(item.k.to, tz)} · Блокировка`}
                              description={item.k.note ?? undefined}
                              startContent={<Lock size={16} aria-hidden />}
                              href={`/more?block=${item.k.id}`}
                            />
                          ),
                        )}
                    </List>
                  )}
                </VStack>
              );
            })}
          </>
        ) : null}
        <HStack gap={2}>
          <Button label="Новая запись" variant="primary" icon={<Plus size={16} />} onClick={() => setSheet('new')} />
          <Button label="Заблокировать пост" icon={<Lock size={16} />} onClick={() => setSheet('block')} />
        </HStack>
      </VStack>
      <NewBookingSheet open={sheet === 'new'} onClose={() => setSheet(null)} defaultDate={date} />
      <BlockSheet open={sheet === 'block'} onClose={() => setSheet(null)} defaultDate={date} />
    </main>
  );
}
