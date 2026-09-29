import {useState} from 'react';
import {useParams} from 'react-router';
import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {Button} from '@astryxdesign/core/Button';
import {Heading} from '@astryxdesign/core/Heading';
import {List, ListItem} from '@astryxdesign/core/List';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {useToast} from '@astryxdesign/core/Toast';
import {Phone} from 'lucide-react';
import {ScreenHeader} from '@/components/app/ScreenHeader';
import {ErrorBlock, LoadingRows} from '@/components/app/StateViews';
import {errorMessage} from '@/shared/api';
import {dateLong, dateShort, money, STATUS_LABEL, time} from '@/shared/format';
import {formatPhone} from '@shared/phone';
import {useOwnerStudio} from '../owner-context';
import {useOwnerBooking, useOwnerMutation} from '../api';
import {PaymentSheet, METHOD_LABEL} from '../sheets/PaymentSheet';
import {CompleteSheet} from '../sheets/CompleteSheet';
import {OwnerRescheduleSheet} from '../sheets/OwnerRescheduleSheet';

const EVENT_LABEL: Record<string, string> = {
  created: 'Создана',
  rescheduled: 'Перенесена',
  cancelled: 'Отменена',
  status_arrived: 'Автомобиль приехал',
  status_completed: 'Выполнена',
  status_no_show: 'Неявка',
  payment_recorded: 'Оплата',
};
const ACTOR = {client: 'клиент', owner: 'студия', system: 'система'} as Record<string, string>;

export function OwnerBookingPage() {
  const {bookingId = ''} = useParams();
  const studio = useOwnerStudio();
  const toast = useToast();
  const q = useOwnerBooking(studio.tenantId, bookingId);
  const [sheet, setSheet] = useState<'pay' | 'complete' | 'move' | 'cancel' | 'noshow' | null>(null);
  const status = useOwnerMutation<'arrived' | 'no_show'>(studio.tenantId, (s) => ({path: `/t/${studio.tenantId}/bookings/${bookingId}/status`, body: {status: s}}));
  const cancel = useOwnerMutation<void>(studio.tenantId, () => ({path: `/t/${studio.tenantId}/bookings/${bookingId}/cancel`, body: {reason: 'Отменено студией'}}));
  const tz = studio.timezone;
  const b = q.data;
  const paid = b?.payments.reduce((s, p) => s + Number(p.amount), 0) ?? 0;
  const total = b ? Number(b.finalAmount ?? b.price.amount) : 0;
  const remaining = Math.max(0, total - paid);

  return (
    <main className="app-content" id="main">
      <ScreenHeader title="Запись" back="/" />
      <VStack gap={5} paddingInline={4}>
        {q.isPending ? <LoadingRows rows={5} /> : null}
        {q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : null}
        {b ? (
          <>
            <VStack gap={2}>
              <HStack gap={2} wrap="wrap">
                <Token label={STATUS_LABEL[b.status]!} />
                {b.isDemo ? <Token label="Демо" color="yellow" /> : null}
                {b.source === 'owner' ? <Token label="Записал(а) студия" color="gray" /> : null}
              </HStack>
              <Heading level={2}>{b.customerName}</Heading>
              <HStack gap={2}>
                <Button label={formatPhone(b.phone)} icon={<Phone size={16} />} href={`tel:${b.phone}`} />
              </HStack>
              <Text type="supporting">
                Визитов: {b.customerHistory.bookings}, выполнено: {b.customerHistory.completed}
              </Text>
            </VStack>

            <MetadataList>
              <MetadataListItem label="Услуга">{b.serviceName}</MetadataListItem>
              <MetadataListItem label="Когда">
                {dateLong(b.startAt, tz)}, {time(b.startAt, tz)}–{new Date(b.endAt).getTime() - new Date(b.startAt).getTime() >= 86_400_000 ? `${dateShort(b.endAt, tz)} ` : ''}
                {time(b.endAt, tz)}
              </MetadataListItem>
              <MetadataListItem label="Пост">{b.resourceName}</MetadataListItem>
              {b.car || b.carPlate ? <MetadataListItem label="Автомобиль">{[b.car, b.carPlate].filter(Boolean).join(', ')}</MetadataListItem> : null}
              {b.comment ? <MetadataListItem label="Комментарий">{b.comment}</MetadataListItem> : null}
              <MetadataListItem label="Цена при записи">{money(Number(b.price.amount), b.price.isFrom)}</MetadataListItem>
              {b.finalAmount !== null ? <MetadataListItem label="Итог заказа">{money(Number(b.finalAmount))}</MetadataListItem> : null}
              <MetadataListItem label="Оплачено">
                {money(paid)}
                {remaining > 0 && b.status === 'completed' ? ` · долг ${money(remaining)}` : ''}
              </MetadataListItem>
            </MetadataList>

            <HStack gap={2} wrap="wrap">
              {b.status === 'scheduled' ? <Button label="Приехал" variant="primary" isLoading={status.isPending} onClick={() => status.mutate('arrived', {onError: (e) => toast({body: errorMessage(e), type: 'error'})})} /> : null}
              {b.status === 'scheduled' || b.status === 'arrived' ? <Button label="Выполнено" variant={b.status === 'arrived' ? 'primary' : 'secondary'} onClick={() => setSheet('complete')} /> : null}
              {b.status !== 'cancelled' && b.status !== 'no_show' ? <Button label="Принять оплату" onClick={() => setSheet('pay')} /> : null}
              {b.status === 'scheduled' ? <Button label="Перенести" onClick={() => setSheet('move')} /> : null}
              {b.status === 'scheduled' ? <Button label="Неявка" variant="ghost" onClick={() => setSheet('noshow')} /> : null}
              {b.status === 'scheduled' || b.status === 'arrived' ? <Button label="Отменить" variant="destructive" onClick={() => setSheet('cancel')} /> : null}
            </HStack>

            {b.payments.length ? (
              <List header={<Text weight="semibold">Оплаты</Text>} hasDividers density="compact">
                {b.payments.map((p) => (
                  <ListItem key={p.id} label={money(Number(p.amount))} description={`${METHOD_LABEL[p.method]} · ${dateShort(p.receivedAt, tz)} ${time(p.receivedAt, tz)}${p.note ? ` · ${p.note}` : ''}`} />
                ))}
              </List>
            ) : null}

            <List header={<Text weight="semibold">История</Text>} density="compact">
              {b.events.map((e, i) => (
                <ListItem key={i} label={EVENT_LABEL[e.kind] ?? e.kind} description={`${dateShort(e.at, tz)} ${time(e.at, tz)} · ${ACTOR[e.actor] ?? e.actor}`} />
              ))}
            </List>

            <PaymentSheet key={`pay-${b.id}-${sheet === 'pay'}`} open={sheet === 'pay'} onClose={() => setSheet(null)} bookingId={b.id} suggested={remaining} />
            <CompleteSheet key={`done-${b.id}-${sheet === 'complete'}`} open={sheet === 'complete'} onClose={() => setSheet(null)} bookingId={b.id} listPrice={Number(b.price.amount)} isFrom={b.price.isFrom} />
            <OwnerRescheduleSheet key={`move-${b.id}-${sheet === 'move'}`} open={sheet === 'move'} onClose={() => setSheet(null)} booking={b} />
            <AlertDialog
              isOpen={sheet === 'cancel'}
              onOpenChange={(o) => !o && setSheet(null)}
              title="Отменить запись?"
              description="Клиент получит уведомление, если включил напоминания. Время освободится."
              actionLabel="Отменить запись"
              cancelLabel="Назад"
              isActionLoading={cancel.isPending}
              onAction={() => cancel.mutate(undefined, {onSuccess: () => setSheet(null), onError: (e) => toast({body: errorMessage(e), type: 'error'})})}
            />
            <AlertDialog
              isOpen={sheet === 'noshow'}
              onOpenChange={(o) => !o && setSheet(null)}
              title="Отметить неявку?"
              description="Оставшееся время поста освободится для других записей."
              actionLabel="Неявка"
              cancelLabel="Назад"
              isActionLoading={status.isPending}
              onAction={() => status.mutate('no_show', {onSuccess: () => setSheet(null)})}
            />
          </>
        ) : null}
      </VStack>
    </main>
  );
}
