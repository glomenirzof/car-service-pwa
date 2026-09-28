import {bookingIcs, type IcsBooking} from '@shared/ics';

/** Creates the .ics file in the browser. Honest by design: we can only hand
 * the file to the OS; whether the user saves it in a calendar is up to them. */
export function downloadIcs(booking: IcsBooking): void {
  const blob = new Blob([bookingIcs(booking)], {type: 'text/calendar;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zapis-${booking.id.slice(0, 8)}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
