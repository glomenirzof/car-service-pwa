import {useState} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {List, ListItem} from '@astryxdesign/core/List';
import {VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {useToast} from '@astryxdesign/core/Toast';
import {ChevronRight} from 'lucide-react';
import {PhoneField} from '@/components/app/PhoneField';
import {ErrorBlock} from '@/components/app/StateViews';
import {ApiError} from '@/shared/api';
import {dateLong, duration, money, time} from '@/shared/format';
import {addDays} from '@shared/periods';
import {normalizePhone} from '@shared/phone';
import {SlotPicker, WINDOW_DAYS} from '@/client/components/SlotPicker';
import {useOwnerStudio} from '../owner-context';
import {useOwnerAvailability, useOwnerMutation} from '../api';
import {SheetFrame} from './SheetFrame';

export function NewBookingSheet({open, onClose, defaultDate}: {open: boolean; onClose: () => void; defaultDate: string}) {
  const studio = useOwnerStudio();
  const toast = useToast();
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [startAt, setStartAt] = useState<string | null>(null);
  const [windowStart, setWindowStart] = useState(defaultDate);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [car, setCar] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [touched, setTouched] = useState(false);
  const services = studio.services.filter((s) => s.isActive && !s.isPaused);
  const service = services.find((s) => s.id === serviceId) ?? null;
  const availability = useOwnerAvailability(studio.tenantId, open ? serviceId : null, windowStart, addDays(windowStart, WINDOW_DAYS - 1));
  const create = useOwnerMutation<{startAt: string}>(studio.tenantId, ({startAt: s}) => ({
    path: `/t/${studio.tenantId}/bookings`,
    body: {serviceId, startAt: s, name, phone: normalizePhone(phone), car, idempotencyKey: key},
  }));

  const reset = () => {
    setServiceId(null);
    setStartAt(null);
    setName('');
    setPhone('');
    setCar('');
    setTouched(false);
    setKey(crypto.randomUUID());
    create.reset();
  };
  const close = () => {
    reset();
    onClose();
  };
  const phoneOk = Boolean(normalizePhone(phone));
  const submit = () => {
    setTouched(true);
    if (!startAt || !name.trim() || !phoneOk) return;
    create.mutate(
      {startAt},
      {
        onSuccess: () => {
          toast({body: `Записано: ${service?.name}, ${dateLong(startAt, studio.timezone)} ${time(startAt, studio.timezone)}`});
          close();
        },
      },
    );
  };

  return (
    <SheetFrame
      open={open}
      onClose={close}
      title="Новая запись"
      description={service ? `${service.name} · ${duration(service.durationMinutes)}` : 'Запись клиента по телефону'}
      footer={
        service ? (
          <Button label="Записать" variant="primary" size="lg" width="100%" isDisabled={!startAt} isLoading={create.isPending} onClick={submit} />
        ) : null
      }
    >
      {!service ? (
        <List hasDividers>
          {services.map((s) => (
            <ListItem key={s.id} label={s.name} description={`${duration(s.durationMinutes)} · ${money(s.price.amount, s.price.isFrom)}`} endContent={<ChevronRight size={18} aria-hidden />} onClick={() => setServiceId(s.id)} />
          ))}
        </List>
      ) : (
        <VStack gap={4}>
          <Button label="Другая услуга" size="sm" variant="ghost" onClick={() => { setServiceId(null); setStartAt(null); }} />
          <SlotPicker timezone={studio.timezone} horizonDays={120} windowStart={windowStart} onWindowChange={setWindowStart} query={availability} value={startAt} onChange={(s) => setStartAt(s.startAt)} />
          <Text type="supporting">В кабинете доступно и ближайшее время (без ограничения «за сколько часов»). Пересечения всё равно невозможны.</Text>
          <TextInput label="Имя клиента" value={name} onChange={setName} isRequired width="100%" status={touched && !name.trim() ? {type: 'error', message: 'Укажите имя'} : undefined} />
          <PhoneField value={phone} onChange={setPhone} error={touched && !phoneOk ? 'Телефон в формате +7 999 123-45-67' : undefined} />
          <TextInput label="Автомобиль" value={car} onChange={setCar} isOptional width="100%" />
          {create.isError ? (
            create.error instanceof ApiError && create.error.code === 'slot_unavailable' ? (
              <Banner status="warning" title="Время занято" description="Пока вы заполняли, это время заняли. Выберите другое." />
            ) : (
              <ErrorBlock error={create.error} title="Не удалось записать" />
            )
          ) : null}
        </VStack>
      )}
    </SheetFrame>
  );
}
