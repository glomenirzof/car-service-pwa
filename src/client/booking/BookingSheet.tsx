// Sequential booking bottom sheet: service → time → contacts → confirm → done.
import {useEffect, useMemo, useRef, useState} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {IconButton} from '@astryxdesign/core/IconButton';
import {List, ListItem} from '@astryxdesign/core/List';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {CheckCircle2, ChevronLeft, ChevronRight, X} from 'lucide-react';
import {Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle} from '@/components/ui/drawer';
import {PhoneField} from '@/components/app/PhoneField';
import {ErrorBlock} from '@/components/app/StateViews';
import {ApiError} from '@/shared/api';
import {dateLong, dayMonth, duration, money, time} from '@/shared/format';
import {formatPhone, normalizePhone} from '@shared/phone';
import {localDate} from '@shared/periods';
import type {ClientBooking, Service} from '@/shared/types';
import {useBoot} from '@/app/boot-context';
import {useStudio} from '../studio-context';
import {useAvailability, useBooking, useCreateBooking} from '../api';
import {clearIdempotencyKey, getContact, idempotencyKeyFor, saveBooking, setContact as rememberContact, tokenFor, type Contact} from '../store';
import {SlotPicker, WINDOW_DAYS} from '../components/SlotPicker';
import {ReminderOptIn} from '../components/ReminderOptIn';
import {useBookingSheet, type SheetStep} from './useBookingSheet';

const TITLES: Record<SheetStep, string> = {
  service: 'Выберите услугу',
  time: 'Выберите время',
  contact: 'Ваши контакты',
  confirm: 'Проверьте запись',
  done: 'Вы записаны',
};

function useDeviceTzDiffers(tz: string) {
  return useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone !== tz, [tz]);
}

export function BookingSheet() {
  const {slug} = useBoot();
  const studio = useStudio();
  const sheet = useBookingSheet();
  const titleRef = useRef<HTMLDivElement>(null);
  const service = studio.services.find((s) => s.id === sheet.serviceId) ?? null;
  const [contact, setContact] = useState<Contact>(() => getContact(slug) ?? {name: '', phone: '', car: '', carPlate: ''});
  const [comment, setComment] = useState('');
  const [remember, setRemember] = useState(true);
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState(false);
  const [created, setCreated] = useState<{booking: ClientBooking; token: string} | null>(null);
  const create = useCreateBooking(slug);

  // Focus the step title whenever the step changes (screen readers + keyboard).
  useEffect(() => {
    if (sheet.open) requestAnimationFrame(() => titleRef.current?.focus({preventScroll: true}));
  }, [sheet.open, sheet.step]);

  // A step that lacks its prerequisites falls back to the right one (deep links, reloads).
  useEffect(() => {
    if (!sheet.open) return;
    if (sheet.step !== 'service' && sheet.step !== 'done' && !service) sheet.replaceWith({step: 'service'});
    else if ((sheet.step === 'contact' || sheet.step === 'confirm') && !sheet.startAt) sheet.replaceWith({step: 'time'});
  }, [sheet, service]);

  const phoneNormalized = normalizePhone(contact.phone);
  const contactErrors = {
    name: contact.name.trim() ? undefined : 'Как к вам обращаться?',
    phone: phoneNormalized ? undefined : 'Телефон в формате +7 999 123-45-67',
  };
  const contactValid = !contactErrors.name && !contactErrors.phone;

  const submit = () => {
    if (!service || !sheet.startAt || !phoneNormalized) return;
    const payload = {
      serviceId: service.id,
      startAt: sheet.startAt,
      name: contact.name.trim(),
      phone: phoneNormalized,
      car: contact.car.trim(),
      carPlate: contact.carPlate.trim(),
      comment: comment.trim(),
    };
    const idempotencyKey = idempotencyKeyFor(slug, payload);
    create.mutate(
      {...payload, consent: true, idempotencyKey},
      {
        onSuccess: (res) => {
          saveBooking(slug, {token: res.token, bookingId: res.booking.id, startAt: res.booking.startAt, serviceName: res.booking.service.name});
          rememberContact(slug, remember ? {...contact, phone: phoneNormalized} : null);
          clearIdempotencyKey(slug);
          setCreated({booking: res.booking, token: res.token});
          create.reset();
          sheet.replaceWith({step: 'done', booking: res.booking.id});
        },
      },
    );
  };

  const doneToken = sheet.bookingId ? (created?.token ?? tokenFor(slug, sheet.bookingId)) : null;
  const doneQuery = useBooking(slug, sheet.step === 'done' && !created ? doneToken : null);
  const doneBooking = created?.booking ?? doneQuery.data?.booking ?? null;

  const stepIndex = ['service', 'time', 'contact', 'confirm'].indexOf(sheet.step);
  const canGoBack = sheet.step !== 'done' && sheet.step !== 'service' && sheet.depth > 1;

  const header = (
    <HStack gap={2} align="center">
      {canGoBack ? <IconButton icon={<ChevronLeft size={20} />} label="Назад" variant="ghost" onClick={sheet.back} /> : null}
      <StackItem size="fill">
        <div ref={titleRef} tabIndex={-1} className="outline-none">
          <DrawerTitle>{TITLES[sheet.step]}</DrawerTitle>
          {stepIndex >= 0 ? <DrawerDescription>Шаг {stepIndex + 1} из 4{service && sheet.step !== 'service' ? ` · ${service.name}` : ''}</DrawerDescription> : null}
        </div>
      </StackItem>
      <DrawerClose render={<IconButton icon={<X size={20} />} label="Закрыть" variant="ghost" />} />
    </HStack>
  );

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (sheet.step === 'service') {
    body = <ServiceList services={studio.services} onPick={(s) => sheet.goTo('time', {service: s.id, at: null})} />;
  } else if (sheet.step === 'time' && service) {
    body = <TimeStep service={service} value={sheet.startAt} onChange={(startAt) => sheet.replaceWith({at: startAt})} />;
    footer = <Button label={sheet.startAt ? `Далее · ${time(sheet.startAt, studio.timezone)}` : 'Выберите время'} variant="primary" width="100%" size="lg" isDisabled={!sheet.startAt} onClick={() => sheet.goTo('contact')} />;
  } else if (sheet.step === 'contact') {
    body = (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (contactValid) sheet.goTo('confirm');
        }}
        id="contact-form"
        noValidate
      >
        <VStack gap={4}>
          <TextInput label="Имя" value={contact.name} onChange={(name) => setContact({...contact, name})} autoComplete="name" isRequired status={touched && contactErrors.name ? {type: 'error', message: contactErrors.name} : undefined} width="100%" />
          <PhoneField value={contact.phone} onChange={(phone) => setContact({...contact, phone})} error={touched ? contactErrors.phone : undefined} />
          <TextInput label="Автомобиль" value={contact.car} onChange={(car) => setContact({...contact, car})} placeholder="Марка и модель" isOptional width="100%" />
          <TextInput label="Госномер" value={contact.carPlate} onChange={(carPlate) => setContact({...contact, carPlate})} placeholder="А123ВС77" isOptional width="100%" />
          <TextArea label="Комментарий" value={comment} onChange={setComment} rows={2} maxLength={500} isOptional placeholder="Например: сильные загрязнения салона" width="100%" />
          <CheckboxInput label="Запомнить мои данные на этом устройстве" value={remember} onChange={setRemember} />
        </VStack>
      </form>
    );
    footer = <Button label="Далее" type="submit" form="contact-form" variant="primary" width="100%" size="lg" />;
  } else if (sheet.step === 'confirm' && service && sheet.startAt) {
    const conflict = create.error instanceof ApiError && create.error.code === 'slot_unavailable';
    body = (
      <VStack gap={4}>
        <ConfirmSummary service={service} startAt={sheet.startAt} contact={{...contact, phone: phoneNormalized ?? contact.phone}} comment={comment} />
        {create.isError ? (
          conflict ? (
            <Banner
              status="warning"
              title="Это время только что заняли"
              description="Мы ничего не списали и не создали. Выберите другое время."
              endContent={<Button label="Выбрать время" size="sm" onClick={() => { create.reset(); sheet.goTo('time', {at: null}); }} />}
            />
          ) : (
            <ErrorBlock error={create.error} title="Запись не отправлена" />
          )
        ) : null}
        <CheckboxInput
          label="Согласен на обработку имени и телефона для этой записи"
          description={studio.profile.legal?.privacyNote}
          value={consent}
          onChange={setConsent}
          isRequired
        />
      </VStack>
    );
    footer = (
      <VStack gap={2}>
        <Button
          label={create.isError && !conflict ? 'Повторить' : 'Записаться'}
          variant="primary"
          size="lg"
          width="100%"
          isDisabled={!consent || conflict}
          isLoading={create.isPending}
          onClick={submit}
        />
        <Text type="supporting" justify="center">
          Оплата — в студии после работы. {errorHint(create.error)}
        </Text>
      </VStack>
    );
  } else if (sheet.step === 'done') {
    body = doneBooking && doneToken ? (
      <DoneStep booking={doneBooking} token={doneToken} subscriptions={doneQuery.data?.push.subscriptions ?? 0} />
    ) : doneQuery.isError ? (
      <ErrorBlock error={doneQuery.error} onRetry={() => void doneQuery.refetch()} />
    ) : (
      <Text color="secondary">Загружаем запись…</Text>
    );
    footer = sheet.bookingId ? (
      <VStack gap={2}>
        <Button label="Открыть запись" variant="primary" size="lg" width="100%" onClick={() => sheet.closeThen(`/bookings/${sheet.bookingId}`)} />
        <Button label="Готово" variant="ghost" width="100%" onClick={sheet.close} />
      </VStack>
    ) : null;
  }

  return (
    <Drawer open={sheet.open} onOpenChange={(open) => !open && sheet.close()}>
      <DrawerContent header={header} footer={footer} aria-label="Запись в студию">
        {body}
      </DrawerContent>
    </Drawer>
  );
}

function errorHint(error: unknown): string {
  if (!error) return '';
  if (error instanceof ApiError && error.status === 0) return 'Нет сети — повтор отправит ту же заявку, дубля не будет.';
  return '';
}

function ServiceList({services, onPick}: {services: Service[]; onPick: (s: Service) => void}) {
  const categories = [...new Set(services.map((s) => s.category))];
  if (!services.length) return <Text color="secondary">Сейчас нет услуг для онлайн-записи. Позвоните в студию.</Text>;
  return (
    <VStack gap={4}>
      {categories.map((c) => (
        <List key={c} header={<Text weight="semibold">{c}</Text>} hasDividers density="spacious">
          {services
            .filter((s) => s.category === c)
            .map((s) => (
              <ListItem
                key={s.id}
                label={s.name}
                description={`${duration(s.durationMinutes)} · ${money(s.price.amount, s.price.isFrom)}`}
                endContent={<ChevronRight size={18} aria-hidden />}
                onClick={() => onPick(s)}
              />
            ))}
        </List>
      ))}
    </VStack>
  );
}

function TimeStep({service, value, onChange}: {service: Service; value: string | null; onChange: (startAt: string) => void}) {
  const {slug} = useBoot();
  const studio = useStudio();
  const today = localDate(new Date(), studio.timezone);
  const [windowStart, setWindowStart] = useState(today);
  const to = new Date(`${windowStart}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + WINDOW_DAYS - 1);
  const query = useAvailability(slug, service.id, windowStart, to.toISOString().slice(0, 10));
  const tzDiffers = useDeviceTzDiffers(studio.timezone);
  return (
    <VStack gap={4}>
      <Text color="secondary">
        {duration(service.durationMinutes)} · {money(service.price.amount, service.price.isFrom)}
        {service.completion === 'multi_day' ? '. Автомобиль остаётся в студии на всё время работ.' : ''}
      </Text>
      <SlotPicker
        timezone={studio.timezone}
        horizonDays={studio.profile.booking.horizonDays}
        windowStart={windowStart}
        onWindowChange={setWindowStart}
        query={query}
        value={value}
        onChange={(slot) => onChange(slot.startAt)}
      />
      {tzDiffers ? <Text type="supporting">Время указано по часовому поясу студии ({studio.timezone}).</Text> : null}
    </VStack>
  );
}

function ConfirmSummary({service, startAt, contact, comment}: {service: Service; startAt: string; contact: Contact; comment: string}) {
  const studio = useStudio();
  const end = new Date(new Date(startAt).getTime() + service.durationMinutes * 60_000).toISOString();
  return (
    <MetadataList>
      <MetadataListItem label="Услуга">{service.name}</MetadataListItem>
      <MetadataListItem label="Когда">
        {dateLong(startAt, studio.timezone)}, {time(startAt, studio.timezone)}
      </MetadataListItem>
      <MetadataListItem label="Длительность">
        {duration(service.durationMinutes)}
        {service.completion === 'multi_day' ? ` (до ${dayMonth(end, studio.timezone)}, ~${time(end, studio.timezone)})` : ''}
      </MetadataListItem>
      <MetadataListItem label="Стоимость">{money(service.price.amount, service.price.isFrom)}</MetadataListItem>
      <MetadataListItem label="Контакты">
        {contact.name}, {formatPhone(contact.phone)}
      </MetadataListItem>
      {contact.car || contact.carPlate ? <MetadataListItem label="Автомобиль">{[contact.car, contact.carPlate].filter(Boolean).join(', ')}</MetadataListItem> : null}
      {comment ? <MetadataListItem label="Комментарий">{comment}</MetadataListItem> : null}
      <MetadataListItem label="Адрес">
        {studio.profile.contacts.city}, {studio.profile.contacts.address}
      </MetadataListItem>
    </MetadataList>
  );
}

function DoneStep({booking, token, subscriptions}: {booking: ClientBooking; token: string; subscriptions: number}) {
  const {slug} = useBoot();
  const studio = useStudio();
  return (
    <VStack gap={4} data-testid="booking-done">
      <HStack gap={3} align="center">
        <CheckCircle2 size={36} className="text-accent" aria-hidden />
        <VStack gap={0.5}>
          <Text weight="semibold" type="large">
            {booking.service.name}
          </Text>
          <Text color="secondary">
            {dateLong(booking.startAt, studio.timezone)}, {time(booking.startAt, studio.timezone)}
          </Text>
        </VStack>
      </HStack>
      <Text>
        Ссылка на запись сохранена в разделе «Мои записи» на этом устройстве. Перенести или отменить запись онлайн можно до{' '}
        {dayMonth(booking.changeDeadline, studio.timezone)}, {time(booking.changeDeadline, studio.timezone)}.
      </Text>
      <ReminderOptIn slug={slug} token={token} booking={booking} subscriptions={subscriptions} isPreview={studio.status === 'preview'} />
    </VStack>
  );
}
