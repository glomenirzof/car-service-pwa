// The booking sheet lives in the URL (?book=1&step=…&service=…&at=…) so the
// system Back gesture/button walks back through steps, a reload keeps the
// step, and closing the sheet rewinds exactly the entries it pushed.
import {useCallback} from 'react';
import {useLocation, useNavigate, useSearchParams} from 'react-router';

export type SheetStep = 'service' | 'time' | 'contact' | 'confirm' | 'done';
const STEPS: SheetStep[] = ['service', 'time', 'contact', 'confirm', 'done'];

export function useBookingSheet() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const open = params.get('book') === '1';
  const rawStep = params.get('step') as SheetStep | null;
  const step: SheetStep = rawStep && STEPS.includes(rawStep) ? rawStep : 'service';
  const serviceId = params.get('service');
  const startAt = params.get('at');
  const bookingId = params.get('booking');
  const depth = (location.state as {sheetDepth?: number} | null)?.sheetDepth ?? 0;

  const push = useCallback(
    (patch: Record<string, string | null>, replace = false) => {
      const next = new URLSearchParams(params);
      next.set('book', '1');
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      navigate({pathname: location.pathname, search: `?${next}`}, {replace, state: {sheetDepth: replace ? depth : depth + 1}});
    },
    [params, navigate, location.pathname, depth],
  );

  const start = useCallback(
    (opts: {serviceId?: string; startAt?: string} = {}) => {
      const next = new URLSearchParams();
      next.set('book', '1');
      next.set('step', opts.startAt ? 'contact' : opts.serviceId ? 'time' : 'service');
      if (opts.serviceId) next.set('service', opts.serviceId);
      if (opts.startAt) next.set('at', opts.startAt);
      navigate({pathname: location.pathname, search: `?${next}`}, {state: {sheetDepth: 1}});
    },
    [navigate, location.pathname],
  );

  const close = useCallback(() => {
    if (depth > 0) navigate(-depth);
    else navigate({pathname: location.pathname, search: ''}, {replace: true});
  }, [depth, navigate, location.pathname]);

  /** Close the sheet, then open another screen (without stale sheet entries behind it). */
  const closeThen = useCallback(
    (path: string) => {
      if (depth > 0) {
        const onPop = () => {
          window.removeEventListener('popstate', onPop);
          setTimeout(() => navigate(path), 0);
        };
        window.addEventListener('popstate', onPop);
        window.history.go(-depth);
      } else {
        navigate(path, {replace: true});
      }
    },
    [depth, navigate],
  );

  const back = useCallback(() => {
    if (depth > 1) navigate(-1);
    else close();
  }, [depth, navigate, close]);

  return {open, step, serviceId, startAt, bookingId, depth, start, goTo: (s: SheetStep, extra: Record<string, string | null> = {}) => push({...extra, step: s}), back, close, closeThen, replaceWith: (patch: Record<string, string | null>) => push(patch, true)};
}
