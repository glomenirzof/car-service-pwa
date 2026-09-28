import {useState} from 'react';
import {useParams} from 'react-router';
import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Heading} from '@astryxdesign/core/Heading';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {useToast} from '@astryxdesign/core/Toast';
import {Copy, Phone} from 'lucide-react';
import {ScreenHeader} from '@/components/app/ScreenHeader';
import {EmptyBlock, ErrorBlock, LoadingRows} from '@/components/app/StateViews';
import {ApiError, errorMessage} from '@/shared/api';
import {dateLong, duration, money, time, STATUS_LABEL} from '@/shared/format';
import {formatPhone} from '@shared/phone';
import {useBoot} from '@/app/boot-context';
import {useStudio} from '../studio-context';
import {useBooking, useCancel} from '../api';
import {forgetBooking, tokenFor, updateSavedBooking} from '../store';
import {RescheduleSheet} from '../booking/RescheduleSheet';
import {ReminderOptIn} from '../components/ReminderOptIn';
import {useNavigate, useSearchParams} from 'react-router';

export function BookingPage() {
  const {bookingId = ''} = useParams();
  const {slug} = useBoot();
  const studio = useStudio();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const showToast = useToast();
  const token = tokenFor(slug, bookingId);
  const query = useBooking(slug, token);
  const cancel = useCancel(slug, token ?? '');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const moving = params.get('move') === '1';

  if (!token) {
    return (
      <main className="app-content" id="main">
        <ScreenHeader title="Запись" back="/bookings" />
        <VStack paddingInline={4}>
          <EmptyBlock title="Запись не найдена на этом устройстве" description="Откройте ссылку на запись, которую вы сохранили или получили при записи." />
        </VStack>
      </main>
    );
  }

  const b = query.data?.booking;
  const tz = studio.timezone;
  const shareLink = `${window.location.origin}/s/${slug}/b#t=${token}`;

  return (
    <main className="app-content" id="main">
      <ScreenHeader title="Запись" back="/bookings" />
      <VStack gap={5} paddingInline={4}>
        {query.isPending ? <LoadingRows rows={4} /> : null}
        {query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : null}
        {b ? (
          <>
            <VStack gap={2}>
              <HStack gap={2} align="center" wrap="wrap">
                <Token label={STATUS_LABEL[b.status]!} color={b.status === 'cancelled' ? 'gray' : b.status === 'completed' ? 'green' : 'default'} />
                {b.isDemo ? <Token label="Демо" color="yellow" /> : null}
              </HStack>
              <Heading level={2}>{b.service.name}</Heading>
              <Text type="large" data-testid="booking-when">
                {dateLong(b.startAt, tz)}, {time(b.startAt, tz)}
              </Text>
            </VStack>

            <MetadataList>
              <MetadataListItem label="Длительность">{duration(b.service.durationMinutes)}</MetadataListItem>
              <MetadataListItem label="Стоимость">{money(b.price.amount, b.price.isFrom)}</MetadataListItem>
              <MetadataListItem label="Пост">{b.resource.name}</MetadataListItem>
              <MetadataListItem label="Контакты">
                {b.customerName}, {b.phoneMasked}
              </MetadataListItem>
              {b.car || b.carPlate ? <MetadataListItem label="Автомобиль">{[b.car, b.carPlate].filter(Boolean).join(', ')}</MetadataListItem> : null}
              <MetadataListItem label="Адрес">{b.tenant.address}</MetadataListItem>
            </MetadataList>

            {b.status === 'scheduled' && b.canChange ? (
              <HStack gap={2}>
                <Button label="Перенести" variant="primary" onClick={() => setParams({move: '1'})} />
                <Button label="Отменить" variant="destructive" onClick={() => setConfirmCancel(true)} />
              </HStack>
            ) : b.status === 'scheduled' ? (
              <Banner
                status="info"
                title="Изменить онлайн уже нельзя"
                description={`Перенос и отмена доступны до ${time(b.changeDeadline, tz)}, ${dateLong(b.changeDeadline, tz)}. Позвоните в студию.`}
                endContent={<Button label="Позвонить" size="sm" icon={<Phone size={14} />} href={`tel:${b.tenant.phone}`} />}
              />
            ) : null}

            <ReminderOptIn slug={slug} token={token} booking={b} subscriptions={query.data?.push.subscriptions ?? 0} isPreview={studio.status === 'preview'} />

            <VStack gap={2}>
              <Text weight="semibold">Ссылка на запись</Text>
              <Text type="supporting">Откроет эту запись на другом устройстве. Не пересылайте её посторонним: по ней можно отменить запись.</Text>
              <Button
                label="Скопировать ссылку"
                icon={<Copy size={16} />}
                variant="ghost"
                onClick={() =>
                  navigator.clipboard
                    .writeText(shareLink)
                    .then(() => showToast({body: 'Ссылка скопирована'}))
                    .catch(() => showToast({body: 'Не удалось скопировать', type: 'error'}))
                }
              />
            </VStack>

            <Text type="supporting">
              Студия: {b.tenant.name}, {formatPhone(b.tenant.phone)}
            </Text>
            {b.status === 'cancelled' || b.status === 'completed' ? (
              <Button
                label="Убрать с устройства"
                variant="ghost"
                onClick={() => {
                  forgetBooking(slug, b.id);
                  navigate('/bookings', {replace: true});
                }}
              />
            ) : null}

            <RescheduleSheet
              open={moving}
              onClose={() => navigate(-1)}
              booking={b}
              token={token}
              onDone={(nb) => {
                updateSavedBooking(slug, nb.id, {startAt: nb.startAt});
                showToast({body: `Запись перенесена на ${dateLong(nb.startAt, tz)}, ${time(nb.startAt, tz)}`});
                navigate(-1);
              }}
            />
            <AlertDialog
              isOpen={confirmCancel}
              onOpenChange={setConfirmCancel}
              title="Отменить запись?"
              description={`${b.service.name}, ${dateLong(b.startAt, tz)} ${time(b.startAt, tz)}. Время освободится для других клиентов.`}
              actionLabel="Отменить запись"
              cancelLabel="Не отменять"
              isActionLoading={cancel.isPending}
              onAction={() =>
                cancel.mutate('', {
                  onSuccess: () => {
                    setConfirmCancel(false);
                    showToast({body: 'Запись отменена'});
                  },
                  onError: (e) => showToast({body: e instanceof ApiError && e.code === 'too_late' ? 'Отменить онлайн уже нельзя — позвоните в студию' : errorMessage(e), type: 'error'}),
                })
              }
            />
          </>
        ) : null}
      </VStack>
    </main>
  );
}
