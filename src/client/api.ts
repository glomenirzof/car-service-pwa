import {keepPreviousData, useMutation, useQueries, useQuery, useQueryClient} from '@tanstack/react-query';
import {apiRequest} from '@/shared/api';
import type {Availability, ClientBooking, CreateBookingResponse, PublicTenant} from '@/shared/types';
import type {AssistantReply, CreateBookingBody} from '@shared/contract';

export const qk = {
  tenant: (slug: string) => ['tenant', slug] as const,
  availability: (slug: string, serviceId: string, from: string, to: string) => ['availability', slug, serviceId, from, to] as const,
  booking: (slug: string, token: string) => ['booking', slug, token] as const,
  bookingAvailability: (slug: string, token: string, from: string, to: string) => ['booking-availability', slug, token, from, to] as const,
};

export function useTenant(slug: string) {
  return useQuery({
    queryKey: qk.tenant(slug),
    queryFn: ({signal}) => apiRequest<{tenant: PublicTenant}>('public-api', `/tenant/${slug}`, {signal}).then((r) => r.tenant),
    staleTime: 60_000,
  });
}

export function useAvailability(slug: string, serviceId: string | null, from: string, to: string) {
  return useQuery<Availability>({
    queryKey: qk.availability(slug, serviceId ?? '', from, to),
    enabled: Boolean(serviceId),
    queryFn: ({signal}) =>
      apiRequest<{availability: Availability}>('public-api', `/tenant/${slug}/availability`, {query: {service: serviceId, from, to}, signal}).then((r) => r.availability),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

export function useCreateBooking(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<CreateBookingBody, 'consent'> & {consent: true}) =>
      apiRequest<CreateBookingResponse>('public-api', `/tenant/${slug}/bookings`, {body}),
    onSettled: () => qc.invalidateQueries({queryKey: ['availability', slug]}),
  });
}

export function useBooking(slug: string, token: string | null) {
  return useQuery({
    queryKey: qk.booking(slug, token ?? ''),
    enabled: Boolean(token),
    queryFn: ({signal}) =>
      apiRequest<{booking: ClientBooking; push: {subscriptions: number}}>('public-api', `/tenant/${slug}/booking/get`, {body: {token}, signal}),
    staleTime: 10_000,
  });
}

export function useBookings(slug: string, tokens: string[]) {
  return useQueries({
    queries: tokens.map((token) => ({
      queryKey: qk.booking(slug, token),
      queryFn: ({signal}: {signal: AbortSignal}) =>
        apiRequest<{booking: ClientBooking; push: {subscriptions: number}}>('public-api', `/tenant/${slug}/booking/get`, {body: {token}, signal}),
      staleTime: 30_000,
    })),
  });
}

export function useBookingAvailability(slug: string, token: string | null, from: string, to: string, enabled: boolean) {
  return useQuery<Availability>({
    queryKey: qk.bookingAvailability(slug, token ?? '', from, to),
    enabled: enabled && Boolean(token),
    queryFn: ({signal}) =>
      apiRequest<{availability: Availability}>('public-api', `/tenant/${slug}/booking/availability`, {body: {token, from, to}, signal}).then((r) => r.availability),
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });
}

export function useReschedule(slug: string, token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {startAt: string; idempotencyKey: string}) =>
      apiRequest<{booking: ClientBooking; changed: boolean}>('public-api', `/tenant/${slug}/booking/reschedule`, {body: {token, ...body}}),
    onSettled: () => {
      void qc.invalidateQueries({queryKey: qk.booking(slug, token)});
      void qc.invalidateQueries({queryKey: ['booking-availability', slug, token]});
      void qc.invalidateQueries({queryKey: ['availability', slug]});
    },
  });
}

export function useCancel(slug: string, token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => apiRequest<{booking: ClientBooking}>('public-api', `/tenant/${slug}/booking/cancel`, {body: {token, reason}}),
    onSettled: () => {
      void qc.invalidateQueries({queryKey: qk.booking(slug, token)});
      void qc.invalidateQueries({queryKey: ['availability', slug]});
    },
  });
}

export function askAssistant(slug: string, messages: {role: 'user' | 'assistant'; content: string}[], tokens: string[]) {
  return apiRequest<AssistantReply>('assistant', '/client', {body: {slug, messages, tokens}});
}
