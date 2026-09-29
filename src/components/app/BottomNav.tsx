import {NavLink} from 'react-router';
import type {LucideIcon} from 'lucide-react';
import {cn} from '@/lib/utils';

export type NavItem = {to: string; label: string; icon: LucideIcon; end?: boolean; badge?: number};

/** Fixed bottom tab bar (safe-area aware). Active tab gets aria-current="page". */
export function BottomNav({items, label}: {items: NavItem[]; label: string}) {
  return (
    <nav className="app-bottom-nav" aria-label={label}>
      <ul className="mx-auto grid max-w-xl" style={{gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`}}>
        {items.map(({to, label: text, icon: Icon, end, badge}) => (
          <li key={to}>
            <NavLink to={to} end={end} className={({isActive}) => cn('flex flex-col items-center justify-center gap-1 text-xs font-medium', isActive && 'is-active')}>
              <span className="relative">
                <Icon size={22} aria-hidden strokeWidth={1.8} />
                {badge ? (
                  <span className="absolute -top-1 -right-2 min-w-4 rounded-full bg-accent-bg px-1 text-[10px] leading-4 text-on-accent" aria-label={`${badge} активных`}>
                    {badge}
                  </span>
                ) : null}
              </span>
              <span>{text}</span>
              <span className="app-nav-dot h-1 w-1 rounded-full" aria-hidden />
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
