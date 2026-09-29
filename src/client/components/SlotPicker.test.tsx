import {screen, fireEvent} from '@testing-library/react';
import type {UseQueryResult} from '@tanstack/react-query';
import {SlotPicker} from './SlotPicker';
import {renderApp} from '@/test/render';
import {localDate, addDays} from '@shared/periods';
import type {Availability} from '@/shared/types';

const TZ = 'Europe/Moscow';
const today = localDate(new Date(), TZ);

function query(partial: Partial<UseQueryResult<Availability>>): UseQueryResult<Availability> {
  return {isPending: false, isError: false, isSuccess: true, data: undefined, error: null, refetch: vi.fn(), ...partial} as unknown as UseQueryResult<Availability>;
}

const availability: Availability = {
  timezone: TZ,
  serviceId: 's',
  durationMinutes: 60,
  completion: 'same_day',
  from: today,
  to: addDays(today, 13),
  days: Array.from({length: 14}, (_, i) => ({
    date: addDays(today, i),
    slots:
      i === 0
        ? []
        : [
            {startAt: `${addDays(today, i)}T06:00:00Z`, time: '09:00', freeResources: 2},
            {startAt: `${addDays(today, i)}T10:00:00Z`, time: '13:00', freeResources: 1},
            {startAt: `${addDays(today, i)}T15:00:00Z`, time: '18:00', freeResources: 1},
          ],
  })),
};

describe('SlotPicker', () => {
  it('disables days without slots, preselects the first available day and groups times', () => {
    renderApp(<SlotPicker timezone={TZ} horizonDays={30} windowStart={today} onWindowChange={() => {}} query={query({data: availability})} value={null} onChange={() => {}} />);
    const days = screen.getByTestId('slot-days').querySelectorAll('button');
    expect(days).toHaveLength(14);
    expect(days[0]).toBeDisabled();
    expect(days[1]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Утро')).toBeInTheDocument();
    expect(screen.getByText('День')).toBeInTheDocument();
    expect(screen.getByText('Вечер')).toBeInTheDocument();
  });

  it('emits the chosen reception moment', () => {
    const onChange = vi.fn();
    renderApp(<SlotPicker timezone={TZ} horizonDays={30} windowStart={today} onWindowChange={() => {}} query={query({data: availability})} value={null} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole('radio', {name: '13:00'})[0]!);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({time: '13:00', startAt: `${addDays(today, 1)}T10:00:00Z`}));
  });

  it('shows loading, error with retry, and an empty state', () => {
    const refetch = vi.fn();
    const {rerender} = renderApp(<SlotPicker timezone={TZ} horizonDays={30} windowStart={today} onWindowChange={() => {}} query={query({isPending: true, isSuccess: false})} value={null} onChange={() => {}} />);
    expect(document.querySelector('[data-state="loading"]')).toBeInTheDocument();
    rerender(<></>);
    renderApp(<SlotPicker timezone={TZ} horizonDays={30} windowStart={today} onWindowChange={() => {}} query={query({isError: true, isSuccess: false, error: new Error('x'), refetch})} value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', {name: 'Повторить'}));
    expect(refetch).toHaveBeenCalled();
    const empty = {...availability, days: availability.days.map((d) => ({...d, slots: []}))};
    renderApp(<SlotPicker timezone={TZ} horizonDays={30} windowStart={today} onWindowChange={() => {}} query={query({data: empty})} value={null} onChange={() => {}} />);
    expect(screen.getByText('В эти дни всё занято')).toBeInTheDocument();
  });
});
