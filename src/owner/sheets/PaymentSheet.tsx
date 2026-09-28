import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {useToast} from '@astryxdesign/core/Toast';
import {NativeField} from '@/components/app/NativeField';
import {ErrorBlock} from '@/components/app/StateViews';
import {money} from '@/shared/format';
import {useOwnerStudio} from '../owner-context';
import {useOwnerMutation} from '../api';
import {SheetFrame} from './SheetFrame';

export const METHOD_LABEL = {cash: 'Наличные', card: 'Карта', transfer: 'Перевод', other: 'Другое'} as const;

export function PaymentSheet({open, onClose, bookingId, suggested}: {open: boolean; onClose: () => void; bookingId: string; suggested: number}) {
  const studio = useOwnerStudio();
  const toast = useToast();
  const [amount, setAmount] = useState(suggested > 0 ? String(suggested) : '');
  const [method, setMethod] = useState<keyof typeof METHOD_LABEL>('card');
  const [note, setNote] = useState('');
  // One key per opened sheet: double taps / retries record one payment.
  const [key] = useState(() => crypto.randomUUID());
  const value = Number(amount.replace(',', '.'));
  const pay = useOwnerMutation<void>(studio.tenantId, () => ({
    path: `/t/${studio.tenantId}/bookings/${bookingId}/payments`,
    body: {amount: value, method, note, idempotencyKey: key},
  }));
  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      title="Принять оплату"
      description="Фиксируется фактически полученная сумма."
      footer={
        <Button
          label={value > 0 ? `Принять ${money(value)}` : 'Принять'}
          variant="primary"
          size="lg"
          width="100%"
          isDisabled={!(value > 0)}
          isLoading={pay.isPending}
          onClick={() => pay.mutate(undefined, {onSuccess: () => { toast({body: `Оплата ${money(value)} записана`}); onClose(); }})}
        />
      }
    >
      <VStack gap={4}>
        <NativeField label="Сумма, ₽" inputMode="decimal" value={amount} onChange={setAmount} required />
        <SegmentedControl label="Способ оплаты" value={method} onChange={(v) => setMethod(v as keyof typeof METHOD_LABEL)} layout="fill" size="sm">
          {Object.entries(METHOD_LABEL).map(([k, v]) => (
            <SegmentedControlItem key={k} value={k} label={v} />
          ))}
        </SegmentedControl>
        <TextInput label="Комментарий" value={note} onChange={setNote} isOptional width="100%" />
        {suggested > 0 ? <Text type="supporting">Остаток по записи: {money(suggested)}</Text> : null}
        {pay.isError ? <ErrorBlock error={pay.error} title="Оплата не записана" /> : null}
      </VStack>
    </SheetFrame>
  );
}
