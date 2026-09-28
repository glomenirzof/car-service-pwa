import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Carousel} from '@astryxdesign/core/Carousel';
import {Heading} from '@astryxdesign/core/Heading';
import {Link} from '@astryxdesign/core/Link';
import {List, ListItem} from '@astryxdesign/core/List';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {CalendarClock, MapPin, MessageCircle, Phone, Send} from 'lucide-react';
import {MediaImage} from '@/components/app/MediaImage';
import {formatPhone} from '@shared/phone';
import {isoWeekday, localDate, addDays} from '@shared/periods';
import {dateShort, time} from '@/shared/format';
import {useBoot} from '@/app/boot-context';
import {useStudio} from '../studio-context';
import {useBookingSheet} from '../booking/useBookingSheet';
import {ServiceCard} from '../components/ServiceCard';
import {useSavedBookings} from '../store';
import {useNow} from '@/shared/use-now';

const WEEKDAY_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function HomePage() {
  const boot = useBoot();
  const studio = useStudio();
  const sheet = useBookingSheet();
  const saved = useSavedBookings(boot.slug);
  const heroPath = studio.profile.brand.hero;
  const popular = studio.services.filter((s) => s.popular);
  const shown = popular.length ? popular : studio.services.slice(0, 5);
  const gallery = studio.media.filter((m) => m.kind === 'gallery');
  const now = useNow();
  const today = localDate(new Date(now), studio.timezone);
  const upcoming = saved.filter((b) => new Date(b.startAt).getTime() > now).sort((a, b) => a.startAt.localeCompare(b.startAt))[0];

  return (
    <main className="app-content" id="main">
      <section className="relative isolate min-h-[62svh] overflow-hidden" aria-label={studio.name}>
        <MediaImage path={heroPath} alt={studio.name} eager className="absolute inset-0 -z-10 h-full w-full" />
        <div className="app-hero-shade absolute inset-0 -z-10" aria-hidden />
        <VStack gap={3} paddingInline={4} paddingBlockEnd={6} className="app-safe-top absolute inset-x-0 bottom-0">
          <img src={`${boot.assetBase}/logo.svg`} alt="" className="h-9 w-auto self-start" />
          <Heading level={1} type="display-3">
            {studio.name}
          </Heading>
          <Text color="secondary">{studio.profile.tagline}</Text>
          <HStack gap={2} wrap="wrap">
            <Button label="Записаться" variant="primary" size="lg" onClick={() => sheet.start()} />
            {studio.profile.ai.enabled ? <Button label="Спросить" size="lg" icon={<MessageCircle size={18} />} href="/assistant" /> : null}
          </HStack>
        </VStack>
      </section>

      <VStack gap={6} paddingInline={4} paddingBlockStart={4}>
        {studio.status === 'preview' ? (
          <Banner status="info" title="Демо-режим" description="Студия готовится к запуску: записи тестовые, уведомления не отправляются." />
        ) : null}

        {upcoming ? (
          <List hasDividers>
            <ListItem
              label={`Ваша запись: ${upcoming.serviceName}`}
              description={`${dateShort(upcoming.startAt, studio.timezone)}, ${time(upcoming.startAt, studio.timezone)}`}
              startContent={<CalendarClock size={20} aria-hidden />}
              href={`/bookings/${upcoming.bookingId}`}
            />
          </List>
        ) : null}

        <VStack gap={3}>
          <HStack justify="between" align="center">
            <Heading level={2}>Популярное</Heading>
            <Link href="/services">Все услуги</Link>
          </HStack>
          <Carousel gap={3} hasSnap hasButtons={false} aria-label="Популярные услуги">
            {shown.map((s) => (
              <ServiceCard key={s.id} service={s} fallbackImage={heroPath} onPick={() => sheet.start({serviceId: s.id})} />
            ))}
          </Carousel>
        </VStack>

        {studio.profile.description ? (
          <VStack gap={2}>
            <Heading level={2}>О студии</Heading>
            <Text>{studio.profile.description}</Text>
          </VStack>
        ) : null}

        {gallery.length ? (
          <VStack gap={3}>
            <Heading level={2}>Работы</Heading>
            <Carousel gap={2} hasSnap hasButtons={false} aria-label="Фотографии студии">
              {gallery.map((m) => (
                <figure key={m.id} className="m-0 w-72 shrink-0">
                  <MediaImage path={m.path} source={m.source} alt={m.alt} sizes="288px" className="aspect-[4/3] rounded-lg" />
                </figure>
              ))}
            </Carousel>
          </VStack>
        ) : null}

        <VStack gap={3}>
          <Heading level={2}>Контакты</Heading>
          <List hasDividers>
            <ListItem label="Сегодня" description={hoursFor(studio, today)} startContent={<CalendarClock size={20} aria-hidden />} />
            <ListItem
              label={`${studio.profile.contacts.city}, ${studio.profile.contacts.address}`}
              description="Как добраться"
              startContent={<MapPin size={20} aria-hidden />}
              href={studio.profile.contacts.mapUrl ?? `https://yandex.ru/maps/?text=${encodeURIComponent(`${studio.profile.contacts.city}, ${studio.profile.contacts.address}`)}`}
              target="_blank"
            />
            <ListItem label={formatPhone(studio.profile.contacts.phone)} description="Позвонить" startContent={<Phone size={20} aria-hidden />} href={`tel:${studio.profile.contacts.phone}`} />
            {studio.profile.contacts.telegram ? (
              <ListItem label={`@${studio.profile.contacts.telegram}`} description="Telegram" startContent={<Send size={20} aria-hidden />} href={`https://t.me/${studio.profile.contacts.telegram}`} target="_blank" />
            ) : null}
          </List>
          <VStack gap={1}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <HStack key={d} justify="between">
                <Text color={isoWeekday(today) === d ? 'primary' : 'secondary'} weight={isoWeekday(today) === d ? 'semibold' : undefined}>
                  {WEEKDAY_SHORT[d]}
                </Text>
                <Text color="secondary" hasTabularNumbers>
                  {weekdayHours(studio, d)}
                </Text>
              </HStack>
            ))}
          </VStack>
          {studio.exceptions
            .filter((e) => e.date >= today && e.date <= addDays(today, 14))
            .map((e) => (
              <Text key={e.date} type="supporting">
                {dateShort(`${e.date}T12:00:00Z`, 'UTC')}: {e.closed ? 'выходной' : e.intervals.map(([a, b]) => `${a}–${b}`).join(', ')}
                {e.note ? ` (${e.note})` : ''}
              </Text>
            ))}
        </VStack>
      </VStack>
    </main>
  );
}

function weekdayHours(studio: ReturnType<typeof useStudio>, weekday: number): string {
  const intervals = studio.workingHours.filter((w) => w.weekday === weekday);
  return intervals.length ? intervals.map((w) => `${w.opens}–${w.closes}`).join(', ') : 'выходной';
}

function hoursFor(studio: ReturnType<typeof useStudio>, date: string): string {
  const exc = studio.exceptions.find((e) => e.date === date);
  if (exc) return exc.closed ? `Выходной${exc.note ? ` — ${exc.note}` : ''}` : exc.intervals.map(([a, b]) => `${a}–${b}`).join(', ');
  return weekdayHours(studio, isoWeekday(date));
}
