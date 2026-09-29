import {useState} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {VStack} from '@astryxdesign/core/Stack';
import {ErrorBlock} from '@/components/app/StateViews';
import {ApiError} from '@/shared/api';
import {time} from '@/shared/format';
import {addDays, localDate} from '@shared/periods';
import {SlotPicker, WINDOW_DAYS} from '@/client/components/SlotPicker';
import {useOwnerStudio} from '../owner-context';
import {useOwnerAvailability, useOwnerMutation} from '../api';
import type {OwnerBooking} from '../types';
import {SheetFrame} from './SheetFrame';

export function OwnerRescheduleSheet({open, onClose, booking}: {open: boolean; onClose: () => void; booking: OwnerBooking}) {
  const studio = useOwnerStudio();
  const [windowStart, setWindowStart] = useState(() => localDate(new Date(booking.startAt), studio.timezone));
  const [picked, setPicked] = useState<string | null>(null);
  const [key, setKey] = useState<{at: string; key: string} | null>(null);
  const availability = useOwnerAvailability(studio.tenantId, open ? booking.serviceId : null, windowStart, addDays(windowStart, WINDOW_DAYS - 1), booking.id);
  const move = useOwnerMutation<{at: string; key: string}>(studio.tenantId, (v) => ({path: `/t/${studio.tenantId}/bookings/${booking.id}/reschedule`, body: {startAt: v.at, idempotencyKey: v.key}}));
  const conflict = move.error instanceof ApiError && move.error.code === 'slot_unavailable';
  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      title="Перенести запись"
      description={`${booking.customerName} · ${booking.serviceName}`}
      footer={
        <Button
          label={picked ? `Перенести на ${time(picked, studio.timezone)}` : 'Выберите время'}
          variant="primary"
          size="lg"
          width="100%"
          isDisabled={!picked || picked === booking.startAt}
          isLoading={move.isPending}
          onClick={() => {
            if (!picked) return;
            const k = key?.at === picked ? key : {at: picked, key: crypto.randomUUID()};
            setKey(k);
            move.mutate(k, {onSuccess: onClose});
          }}
        />
      }
    >
      <VStack gap={4}>
        {move.isError ? conflict ? <Banner status="warning" title="Время занято" description="Запись осталась на прежнем времени." /> : <ErrorBlock error={move.error} title="Не удалось перенести" /> : null}
        <SlotPicker timezone={studio.timezone} horizonDays={180} windowStart={windowStart} onWindowChange={setWindowStart} query={availability} value={picked} currentStartAt={booking.startAt} onChange={(s) => { move.reset(); setPicked(s.startAt); }} />
      </VStack>
    </SheetFrame>
  );
}
