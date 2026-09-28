import {useState} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {X} from 'lucide-react';
import {Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle} from '@/components/ui/drawer';
import {ErrorBlock} from '@/components/app/StateViews';
import {ApiError} from '@/shared/api';
import {dateLong, time} from '@/shared/format';
import {addDays, localDate} from '@shared/periods';
import type {ClientBooking} from '@/shared/types';
import {useBoot} from '@/app/boot-context';
import {useStudio} from '../studio-context';
import {useBookingAvailability, useReschedule} from '../api';
import {SlotPicker, WINDOW_DAYS} from '../components/SlotPicker';

export function RescheduleSheet({open, onClose, booking, token, onDone}: {open: boolean; onClose: () => void; booking: ClientBooking; token: string; onDone: (b: ClientBooking) => void}) {
  const {slug} = useBoot();
  const studio = useStudio();
  const today = localDate(new Date(), studio.timezone);
  const [windowStart, setWindowStart] = useState(today);
  const [picked, setPicked] = useState<string | null>(null);
  const [key, setKey] = useState<{startAt: string; key: string} | null>(null);
  const query = useBookingAvailability(slug, token, windowStart, addDays(windowStart, WINDOW_DAYS - 1), open);
  const move = useReschedule(slug, token);

  const submit = () => {
    if (!picked) return;
    // Same chosen time => same idempotency key, so a retry can never move twice.
    const k = key?.startAt === picked ? key.key : crypto.randomUUID();
    setKey({startAt: picked, key: k});
    move.mutate({startAt: picked, idempotencyKey: k}, {onSuccess: (r) => onDone(r.booking)});
  };

  const conflict = move.error instanceof ApiError && move.error.code === 'slot_unavailable';
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent
        header={
          <HStack gap={2} align="center">
            <StackItem size="fill">
              <DrawerTitle>Перенести запись</DrawerTitle>
              <DrawerDescription>
                Сейчас: {dateLong(booking.startAt, studio.timezone)}, {time(booking.startAt, studio.timezone)}
              </DrawerDescription>
            </StackItem>
            <DrawerClose render={<IconButton icon={<X size={20} />} label="Закрыть" variant="ghost" />} />
          </HStack>
        }
        footer={
          <VStack gap={2}>
            <Button
              label={picked ? `Перенести на ${time(picked, studio.timezone)}` : 'Выберите новое время'}
              variant="primary"
              size="lg"
              width="100%"
              isDisabled={!picked || picked === booking.startAt}
              isLoading={move.isPending}
              onClick={submit}
            />
            <Text type="supporting" justify="center">
              Если новое время недоступно, текущая запись останется без изменений.
            </Text>
          </VStack>
        }
      >
        <VStack gap={4}>
          {move.isError ? (
            conflict ? (
              <Banner status="warning" title="Это время заняли" description="Ваша текущая запись сохранена. Выберите другое время." />
            ) : (
              <ErrorBlock error={move.error} title="Не удалось перенести" />
            )
          ) : null}
          <SlotPicker
            timezone={studio.timezone}
            horizonDays={studio.profile.booking.horizonDays}
            windowStart={windowStart}
            onWindowChange={setWindowStart}
            query={query}
            value={picked}
            currentStartAt={booking.startAt}
            onChange={(s) => {
              move.reset();
              setPicked(s.startAt);
            }}
          />
        </VStack>
      </DrawerContent>
    </Drawer>
  );
}
