import {Outlet} from 'react-router';
import {CalendarCheck2, House, MessageCircle, Wrench} from 'lucide-react';
import {BottomNav, type NavItem} from '@/components/app/BottomNav';
import {UpdatePrompt} from '@/components/app/UpdatePrompt';
import {useBoot} from '@/app/boot-context';
import {useStudio} from './studio-context';
import {useSavedBookings} from './store';
import {BookingSheet} from './booking/BookingSheet';
import {useNow} from '@/shared/use-now';

export function ClientLayout() {
  const {slug, name} = useBoot();
  const studio = useStudio();
  const now = useNow();
  const upcoming = useSavedBookings(slug).filter((b) => new Date(b.startAt).getTime() > now).length;
  const items: NavItem[] = [
    {to: '/', label: 'Главная', icon: House, end: true},
    {to: '/services', label: 'Услуги', icon: Wrench},
    {to: '/bookings', label: 'Записи', icon: CalendarCheck2, badge: upcoming || undefined},
    ...(studio.profile.ai.enabled ? [{to: '/assistant', label: 'Помощник', icon: MessageCircle}] : []),
  ];
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        К содержимому
      </a>
      <Outlet />
      <UpdatePrompt />
      <BottomNav items={items} label={`Навигация ${name}`} />
      <BookingSheet />
    </>
  );
}
