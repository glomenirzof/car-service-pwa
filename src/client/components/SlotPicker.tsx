// Date strip + reception-time grid. Used for booking and for rescheduling.
// Times are the studio's reception moments in the studio timezone.
import {useMemo, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Heading} from '@astryxdesign/core/Heading';
import type {UseQueryResult} from '@tanstack/react-query';
import {addDays, localDate} from '@shared/periods';
import type {Availability, Slot} from '@/shared/types';
import {dayChip, relativeDay} from '@/shared/format';
import {cn} from '@/lib/utils';
import {EmptyBlock, ErrorBlock, LoadingRows} from '@/components/app/StateViews';

export const WINDOW_DAYS = 14;

type Props = {
  timezone: string;
  horizonDays: number;
  windowStart: string;
  onWindowChange: (start: string) => void;
  query: UseQueryResult<Availability>;
  value: string | null;
  onChange: (slot: Slot) => void;
  currentStartAt?: string;
};

function part(time: string): 'morning' | 'day' | 'evening' {
  const h = Number(time.slice(0, 2));
  return h < 12 ? 'morning' : h < 17 ? 'day' : 'evening';
}
const PART_LABEL = {morning: 'Утро', day: 'День', evening: 'Вечер'} as const;

export function SlotPicker({timezone, horizonDays, windowStart, onWindowChange, query, value, onChange, currentStartAt}: Props) {
  const today = localDate(new Date(), timezone);
  const lastDay = addDays(today, horizonDays);
  const days = useMemo(() => query.data?.days ?? [], [query.data]);
  const firstWithSlots = days.find((d) => d.slots.length > 0)?.date ?? null;
  // The user's day choice belongs to one window; moving the window resets it.
  const [picked, setPicked] = useState<{window: string; date: string} | null>(null);
  const selectedDate = picked?.window === windowStart ? picked.date : null;
  const setSelectedDate = (date: string) => setPicked({window: windowStart, date});
  const valueDate = useMemo(() => days.find((d) => d.slots.some((s) => s.startAt === value))?.date ?? null, [days, value]);
  const activeDate = selectedDate && days.some((d) => d.date === selectedDate) ? selectedDate : valueDate ?? firstWithSlots;

  const day = days.find((d) => d.date === activeDate);
  const groups = useMemo(() => {
    const g: Record<'morning' | 'day' | 'evening', Slot[]> = {morning: [], day: [], evening: []};
    for (const s of day?.slots ?? []) g[part(s.time)].push(s);
    return g;
  }, [day]);

  return (
    <VStack gap={4}>
      <VStack gap={2}>
        <HStack justify="between" align="center">
          <Text weight="semibold" id="slot-days-label">
            Дата
          </Text>
          <HStack gap={1}>
            <Button
              label="Ранее"
              size="sm"
              variant="ghost"
              isDisabled={windowStart <= today}
              onClick={() => onWindowChange(addDays(windowStart, -WINDOW_DAYS) < today ? today : addDays(windowStart, -WINDOW_DAYS))}
            />
            <Button
              label="Позже"
              size="sm"
              variant="ghost"
              isDisabled={addDays(windowStart, WINDOW_DAYS) > lastDay}
              onClick={() => onWindowChange(addDays(windowStart, WINDOW_DAYS))}
            />
          </HStack>
        </HStack>
        {query.isPending ? (
          <LoadingRows rows={1} height={68} label="Загружаем свободные даты" />
        ) : query.isError ? (
          <ErrorBlock error={query.error} onRetry={() => void query.refetch()} title="Не удалось загрузить свободное время" />
        ) : (
          <ul className="app-scroll-x -mx-4 flex gap-2 px-4 pb-1" role="radiogroup" aria-labelledby="slot-days-label" data-testid="slot-days">
            {days.map((d) => {
              const chip = dayChip(d.date);
              const rel = relativeDay(d.date, today);
              const count = d.slots.length;
              const active = d.date === activeDate;
              return (
                <li key={d.date} className="shrink-0">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={count === 0}
                    aria-label={`${rel ?? chip.weekday}, ${chip.day} ${chip.month}: ${count ? `${count} свободных` : 'нет мест'}`}
                    onClick={() => setSelectedDate(d.date)}
                    className={cn(
                      'flex h-17 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border text-sm transition-colors',
                      active ? 'border-accent-bg bg-accent-bg text-on-accent' : 'border-border bg-surface text-primary',
                      count === 0 && 'opacity-40',
                    )}
                  >
                    <span className="text-[11px] capitalize">{rel ?? chip.weekday}</span>
                    <span className="text-lg font-semibold leading-5">{chip.day}</span>
                    <span className={cn('h-1 w-1 rounded-full', count ? (active ? 'bg-on-accent' : 'bg-accent-bg') : 'bg-transparent')} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </VStack>

      {query.isSuccess && !firstWithSlots ? (
        <EmptyBlock
          title="В эти дни всё занято"
          description="Посмотрите следующие две недели или позвоните в студию."
          actions={
            addDays(windowStart, WINDOW_DAYS) <= lastDay ? (
              <Button label="Показать позже" variant="primary" onClick={() => onWindowChange(addDays(windowStart, WINDOW_DAYS))} />
            ) : undefined
          }
        />
      ) : null}

      {day && day.slots.length > 0 ? (
        <VStack gap={3} aria-live="polite">
          {(['morning', 'day', 'evening'] as const).map((p) =>
            groups[p].length ? (
              <VStack key={p} gap={2}>
                <Heading level={3} className="text-sm text-secondary" id={`slot-${p}`}>
                  {PART_LABEL[p]}
                </Heading>
                <ul className="grid grid-cols-4 gap-2" role="radiogroup" aria-labelledby={`slot-${p}`} data-testid="slot-times">
                  {groups[p].map((s) => {
                    const selected = s.startAt === value;
                    const current = s.startAt === currentStartAt;
                    return (
                      <li key={s.startAt}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={`${s.time}${current ? ', текущее время записи' : ''}`}
                          onClick={() => onChange(s)}
                          className={cn(
                            'h-11 w-full rounded-md border text-base font-medium tabular-nums transition-colors',
                            selected ? 'border-accent-bg bg-accent-bg text-on-accent' : 'border-border bg-surface text-primary',
                            current && !selected && 'border-dashed',
                          )}
                        >
                          {s.time}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </VStack>
            ) : null,
          )}
        </VStack>
      ) : null}
    </VStack>
  );
}
