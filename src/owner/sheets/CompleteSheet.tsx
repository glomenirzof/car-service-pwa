import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {NativeField} from '@/components/app/NativeField';
import {ErrorBlock} from '@/components/app/StateViews';
import {money} from '@/shared/format';
import {useOwnerStudio} from '../owner-context';
import {useOwnerMutation} from '../api';
import {SheetFrame} from './SheetFrame';

export function CompleteSheet({open, onClose, bookingId, listPrice, isFrom}: {open: boolean; onClose: () => void; bookingId: string; listPrice: number; isFrom: boolean}) {
  const studio = useOwnerStudio();
  const [amount, setAmount] = useState(String(listPrice));
  const value = Number(amount.replace(',', '.'));
  const done = useOwnerMutation<void>(studio.tenantId, () => ({path: `/t/${studio.tenantId}/bookings/${bookingId}/status`, body: {status: 'completed', finalAmount: value}}));
  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      title="Работа выполнена"
      description="Итог заказа попадёт в «Выполненные заказы». Оплату отметьте отдельно."
      footer={<Button label="Завершить заказ" variant="primary" size="lg" width="100%" isDisabled={!(value >= 0) || amount === ''} isLoading={done.isPending} onClick={() => done.mutate(undefined, {onSuccess: onClose})} />}
    >
      <VStack gap={3}>
        <NativeField label="Итоговая стоимость, ₽" inputMode="decimal" value={amount} onChange={setAmount} required />
        <Text type="supporting">Цена при записи: {money(listPrice, isFrom)}. Если автомобиль готов раньше, пост освободится для новых записей.</Text>
        {done.isError ? <ErrorBlock error={done.error} title="Не удалось завершить" /> : null}
      </VStack>
    </SheetFrame>
  );
}
