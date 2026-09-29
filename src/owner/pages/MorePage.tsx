import {useRef, useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Heading} from '@astryxdesign/core/Heading';
import {IconButton} from '@astryxdesign/core/IconButton';
import {List, ListItem} from '@astryxdesign/core/List';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Token} from '@astryxdesign/core/Token';
import {useToast} from '@astryxdesign/core/Toast';
import {BellOff, BellRing, Copy, ImagePlus, LogOut, Trash2} from 'lucide-react';
import {ScreenHeader} from '@/components/app/ScreenHeader';
import {NativeField} from '@/components/app/NativeField';
import {MediaImage} from '@/components/app/MediaImage';
import {ErrorBlock, LoadingRows} from '@/components/app/StateViews';
import {errorMessage} from '@/shared/api';
import {env} from '@/shared/env';
import {pushSupport} from '@/shared/platform';
import {subscribeToPush} from '@/shared/pwa';
import {safeStorage} from '@/shared/storage';
import {dateShort, time} from '@/shared/format';
import {addDays, localDate} from '@shared/periods';
import {useNow} from '@/shared/use-now';
import {useBoot} from '@/app/boot-context';
import {ownerPushKey, useAuth} from '../auth';
import {useOwnerStudio} from '../owner-context';
import {useOwnerFetch, useOwnerMutation, usePushStatus, useSchedule} from '../api';
import {supabase} from '../supabase';

const JOB_LABEL: Record<string, string> = {
  owner_new_booking: 'Новая запись',
  owner_booking_rescheduled: 'Перенос клиентом',
  owner_booking_cancelled: 'Отмена клиентом',
};
const JOB_STATUS: Record<string, string> = {pending: 'в очереди', processing: 'отправляется', sent: 'доставлено в push-сервис', failed: 'ошибка', cancelled: 'отменено', suppressed: 'не отправлялось (демо)', skipped: 'нет подписанных устройств'};

export function MorePage() {
  const {slug} = useBoot();
  const auth = useAuth();
  const studio = useOwnerStudio();
  const toast = useToast();
  const queryClient = useQueryClient();
  const now = useNow();
  const today = localDate(new Date(now), studio.timezone);
  const push = usePushStatus(studio.tenantId);
  const blocks = useSchedule(studio.tenantId, today, addDays(today, 30));
  const f = useOwnerFetch();
  const paused = useOwnerMutation<{kind: 'service' | 'resource'; id: string; paused: boolean}>(studio.tenantId, (v) => ({path: `/t/${studio.tenantId}/paused`, body: v}));
  const unblock = useOwnerMutation<string>(studio.tenantId, (id) => ({path: `/t/${studio.tenantId}/blocks/${id}`, method: 'DELETE'}));
  const setException = useOwnerMutation<{date: string; intervals: [string, string][]; note: string}>(studio.tenantId, (v) => ({path: `/t/${studio.tenantId}/exceptions/${v.date}`, method: 'PUT', body: {intervals: v.intervals, note: v.note}}));
  const delException = useOwnerMutation<string>(studio.tenantId, (date) => ({path: `/t/${studio.tenantId}/exceptions/${date}`, method: 'DELETE'}));
  const delMedia = useOwnerMutation<string>(studio.tenantId, (id) => ({path: `/t/${studio.tenantId}/media/${id}`, method: 'DELETE'}));
  const [pushState, setPushState] = useState<'idle' | 'working'>('idle');
  // Endpoint this device subscribed with (cleared on logout).
  const [devicePush, setDevicePush] = useState(() => safeStorage.get<string | null>(ownerPushKey(slug), null));
  const [exc, setExc] = useState({date: addDays(today, 1), closed: true, opens: '10:00', closes: '16:00', note: ''});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const support = pushSupport(env.vapidPublicKey);
  const link = `${window.location.origin}/s/${slug}/`;

  const enablePush = async () => {
    setPushState('working');
    try {
      const subscription = await subscribeToPush(slug, env.vapidPublicKey);
      await f(`/t/${studio.tenantId}/push`, {method: 'POST', body: {subscription}});
      safeStorage.set(ownerPushKey(slug), subscription.endpoint);
      setDevicePush(subscription.endpoint);
      await push.refetch();
      toast({body: 'Уведомления включены на этом устройстве'});
    } catch (e) {
      toast({body: (e as Error).message === 'denied' ? 'Уведомления запрещены в настройках браузера' : errorMessage(e), type: 'error'});
    } finally {
      setPushState('idle');
    }
  };

  const disablePush = async () => {
    if (!devicePush) return;
    setPushState('working');
    try {
      await f(`/t/${studio.tenantId}/push/delete`, {method: 'POST', body: {endpoint: devicePush}});
      safeStorage.remove(ownerPushKey(slug));
      setDevicePush(null);
      await push.refetch();
      toast({body: 'Уведомления на этом устройстве отключены'});
    } catch (e) {
      toast({body: errorMessage(e), type: 'error'});
    } finally {
      setPushState('idle');
    }
  };

  const upload = async (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      toast({body: 'Нужен JPG, PNG или WebP до 10 МБ', type: 'error'});
      return;
    }
    setUploading(true);
    try {
      const bitmap = await createImageBitmap(file).catch(() => null);
      const signed = await f<{path: string; token: string; bucket: string}>(`/t/${studio.tenantId}/media/upload-url`, {method: 'POST', body: {contentType: file.type, size: file.size}});
      const {error} = await supabase(slug).storage.from(signed.bucket).uploadToSignedUrl(signed.path, signed.token, file, {contentType: file.type});
      if (error) throw error;
      await f(`/t/${studio.tenantId}/media`, {method: 'POST', body: {path: signed.path, alt: file.name.replace(/\.[^.]+$/, ''), width: bitmap?.width, height: bitmap?.height}});
      await queryClient.invalidateQueries({queryKey: ['owner', studio.tenantId]});
      toast({body: 'Фото добавлено в галерею'});
    } catch (e) {
      toast({body: errorMessage(e), type: 'error'});
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const ownerExceptions = studio.exceptions.filter((e) => e.date >= today);
  const ownerMedia = studio.media.filter((m) => m.source === 'owner');

  return (
    <main className="app-content" id="main">
      <ScreenHeader title="Ещё" />
      <VStack gap={6} paddingInline={4}>
        <VStack gap={2}>
          <HStack gap={2} align="center">
            <Heading level={2}>{studio.name}</Heading>
            <Token label={studio.status === 'live' ? 'Работает' : 'Демо-режим'} color={studio.status === 'live' ? 'green' : 'yellow'} />
          </HStack>
          {studio.status !== 'live' ? <Banner status="info" title="Студия в демо-режиме" description="Клиентские записи помечаются как демо, уведомления не отправляются. Запуск выполняет администратор (tenant:publish --live)." /> : null}
          <HStack gap={2}>
            <Button label="Скопировать ссылку для клиентов" icon={<Copy size={16} />} onClick={() => navigator.clipboard.writeText(link).then(() => toast({body: 'Ссылка скопирована'}))} />
          </HStack>
        </VStack>

        <VStack gap={2}>
          <Heading level={2}>Уведомления о записях</Heading>
          {push.isPending ? <LoadingRows rows={1} /> : push.isError ? <ErrorBlock error={push.error} onRetry={() => void push.refetch()} /> : (
            <Text color="secondary">
              {push.data.devices ? `Подключено устройств: ${push.data.devices}.` : 'На ваших устройствах уведомления не включены.'}
            </Text>
          )}
          {devicePush ? (
            <Button label="Отключить на этом устройстве" icon={<BellOff size={16} />} onClick={() => void disablePush()} isLoading={pushState === 'working'} />
          ) : support.ok ? (
            <Button label="Включить на этом устройстве" icon={<BellRing size={16} />} onClick={() => void enablePush()} isLoading={pushState === 'working'} />
          ) : support.reason === 'ios-not-installed' ? (
            <Banner status="info" title="iPhone: только из приложения" description="Добавьте кабинет на экран «Домой» (Поделиться → На экран Домой) и включите уведомления оттуда." />
          ) : (
            <Text type="supporting">{support.reason === 'not-configured' ? 'Push не настроен на сервере (VAPID).' : support.reason === 'denied' ? 'Уведомления запрещены в настройках браузера.' : 'Браузер не поддерживает push.'}</Text>
          )}
          {push.data?.recent.length ? (
            <List density="compact" header={<Text type="supporting">Последние</Text>}>
              {push.data.recent.slice(0, 5).map((j, i) => (
                <ListItem key={i} label={JOB_LABEL[j.kind] ?? j.kind} description={`${dateShort(j.dueAt, studio.timezone)} ${time(j.dueAt, studio.timezone)} · ${JOB_STATUS[j.status] ?? j.status}`} />
              ))}
            </List>
          ) : null}
        </VStack>

        <VStack gap={2}>
          <Heading level={2}>Услуги</Heading>
          <Text type="supporting">Пауза скрывает услугу из онлайн-записи; существующие записи сохраняются. Цены и состав меняются через конфигурацию студии.</Text>
          <List hasDividers density="compact">
            {studio.services.filter((s) => s.isActive).map((s) => (
              <ListItem key={s.id} label={s.name} endContent={<Switch label={`Принимать запись на «${s.name}»`} isLabelHidden value={!s.isPaused} onChange={(on) => paused.mutate({kind: 'service', id: s.id, paused: !on})} />} />
            ))}
          </List>
        </VStack>

        <VStack gap={2}>
          <Heading level={2}>Посты</Heading>
          <List hasDividers density="compact">
            {studio.resources.filter((r) => r.isActive).map((r) => (
              <ListItem key={r.id} label={r.name} description={r.capabilities.join(', ')} endContent={<Switch label={`Пост «${r.name}» доступен`} isLabelHidden value={!r.isPaused} onChange={(on) => paused.mutate({kind: 'resource', id: r.id, paused: !on})} />} />
            ))}
          </List>
          <Text weight="semibold">Блокировки на 30 дней</Text>
          {blocks.data?.blocks.length ? (
            <List hasDividers density="compact">
              {blocks.data.blocks.map((b) => (
                <ListItem
                  key={b.id}
                  label={`${studio.resources.find((r) => r.id === b.resourceId)?.name ?? ''}: ${dateShort(b.from, studio.timezone)} ${time(b.from, studio.timezone)} – ${dateShort(b.to, studio.timezone)} ${time(b.to, studio.timezone)}`}
                  description={b.note ?? undefined}
                  endContent={<IconButton icon={<Trash2 size={16} />} label="Снять блокировку" variant="ghost" onClick={() => unblock.mutate(b.id)} />}
                />
              ))}
            </List>
          ) : (
            <Text type="supporting">Блокировок нет. Заблокировать пост можно в расписании.</Text>
          )}
        </VStack>

        <VStack gap={3}>
          <Heading level={2}>Особые дни</Heading>
          {ownerExceptions.length ? (
            <List hasDividers density="compact">
              {ownerExceptions.map((e) => (
                <ListItem
                  key={e.id}
                  label={`${dateShort(`${e.date}T12:00:00Z`, 'UTC')}: ${e.opens ? `${e.opens}–${e.closes}` : 'выходной'}`}
                  description={[e.note, e.source === 'config' ? 'из настроек студии' : null].filter(Boolean).join(' · ') || undefined}
                  endContent={e.source === 'owner' ? <IconButton icon={<Trash2 size={16} />} label="Удалить" variant="ghost" onClick={() => delException.mutate(e.date)} /> : undefined}
                />
              ))}
            </List>
          ) : null}
          <NativeField label="Дата" type="date" value={exc.date} min={today} onChange={(date) => setExc({...exc, date})} />
          <Switch label="Выходной весь день" value={exc.closed} onChange={(closed) => setExc({...exc, closed})} />
          {!exc.closed ? (
            <HStack gap={2}>
              <NativeField label="С" type="time" value={exc.opens} onChange={(opens) => setExc({...exc, opens})} />
              <NativeField label="До" type="time" value={exc.closes} onChange={(closes) => setExc({...exc, closes})} />
            </HStack>
          ) : null}
          <TextInput label="Заметка" value={exc.note} onChange={(note) => setExc({...exc, note})} isOptional width="100%" />
          <Button
            label="Сохранить особый день"
            isLoading={setException.isPending}
            isDisabled={!exc.closed && exc.closes <= exc.opens}
            onClick={() =>
              setException.mutate(
                {date: exc.date, intervals: exc.closed ? [] : [[exc.opens, exc.closes]], note: exc.note},
                {onSuccess: () => toast({body: 'Сохранено. Записи на этот день не отменяются автоматически.'}), onError: (e) => toast({body: errorMessage(e), type: 'error'})},
              )
            }
          />
        </VStack>

        <VStack gap={3}>
          <Heading level={2}>Мои фото</Heading>
          <Text type="supporting">Фото появятся в галерее на странице студии и сохранятся при обновлении конфигурации.</Text>
          {ownerMedia.length ? (
            <ul className="grid grid-cols-3 gap-2">
              {ownerMedia.map((m) => (
                <li key={m.id} className="relative">
                  <MediaImage path={m.path} source="owner" alt={m.alt} sizes="33vw" className="aspect-square rounded-md" />
                  <span className="absolute top-1 right-1">
                    <IconButton icon={<Trash2 size={14} />} label="Удалить фото" size="sm" onClick={() => delMedia.mutate(m.id)} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="owner-photo" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          <Button label="Загрузить фото" icon={<ImagePlus size={16} />} isLoading={uploading} onClick={() => fileRef.current?.click()} />
        </VStack>

        <Button label="Выйти" icon={<LogOut size={16} />} variant="ghost" onClick={() => void auth.signOut()} />
      </VStack>
    </main>
  );
}
