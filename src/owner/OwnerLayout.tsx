import {Outlet} from 'react-router';
import {BarChart3, CalendarDays, Menu, MessageCircle} from 'lucide-react';
import {BottomNav, type NavItem} from '@/components/app/BottomNav';
import {useOwnerStudio} from './owner-context';

export function OwnerLayout() {
  const studio = useOwnerStudio();
  const items: NavItem[] = [
    {to: '/', label: 'Расписание', icon: CalendarDays, end: true},
    {to: '/stats', label: 'Статистика', icon: BarChart3},
    ...(studio.profile.ai?.enabled !== false ? [{to: '/assistant', label: 'Помощник', icon: MessageCircle}] : []),
    {to: '/more', label: 'Ещё', icon: Menu},
  ];
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        К содержимому
      </a>
      <Outlet />
      <BottomNav items={items} label="Кабинет" />
    </>
  );
}
