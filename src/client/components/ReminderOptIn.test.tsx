import {screen} from '@testing-library/react';
import {ReminderOptIn} from './ReminderOptIn';
import {renderApp} from '@/test/render';
import type {ClientBooking} from '@/shared/types';

vi.mock('@/shared/env', async (orig) => {
  const mod = await orig<typeof import('@/shared/env')>();
  return {...mod, env: {...mod.env, vapidPublicKey: 'BExampleKey'}};
});

const booking = {
  id: 'b1', status: 'scheduled', startAt: '2030-01-02T07:00:00Z', endAt: '2030-01-02T08:00:00Z', service: {id: 's', name: 'Wash', durationMinutes: 60},
  resource: {name: 'Box'}, price: {amount: 1, isFrom: false}, customerName: 'X', phoneMasked: '+7•••', car: null, carPlate: null, comment: null,
  isDemo: false, rescheduleCount: 0, version: 1, changeDeadline: '2030-01-01T19:00:00Z', canChange: true,
  tenant: {slug: 'alpha', name: 'Alpha', timezone: 'Europe/Moscow', phone: '+70000000000', address: 'Street'},
} as ClientBooking;

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', {value: ua, configurable: true});
}

describe('ReminderOptIn (honest push states)', () => {
  it('iPhone in a normal Safari tab: explains Home Screen install, offers no push button', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1');
    renderApp(<ReminderOptIn slug="alpha" token="t" booking={booking} subscriptions={0} isPreview={false} />);
    expect(screen.getByText('Напоминания на iPhone')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Включить напоминания'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: /Добавить в календарь/})).toBeInTheDocument();
  });

  it('preview studio never promises notifications', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64) Chrome/140');
    renderApp(<ReminderOptIn slug="alpha" token="t" booking={booking} subscriptions={0} isPreview />);
    expect(screen.getByText('Демо-режим')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Включить напоминания'})).not.toBeInTheDocument();
  });

  it('shows the stored subscription instead of a button', () => {
    renderApp(<ReminderOptIn slug="alpha" token="t" booking={booking} subscriptions={1} isPreview={false} />);
    expect(screen.getByText('Напоминания включены')).toBeInTheDocument();
  });

  it('nothing to remind about for a cancelled booking', () => {
    const {container} = renderApp(<ReminderOptIn slug="alpha" token="t" booking={{...booking, status: 'cancelled'}} subscriptions={0} isPreview={false} />);
    expect(container.textContent).toBe('');
  });
});
