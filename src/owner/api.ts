import {keepPreviousData, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {ApiError, apiRequest} from '@/shared/api';
import type {Availability} from '@/shared/types';
import type {AssistantReply} from '@shared/contract';
import {useAuth} from './auth';
import type {Membership, OwnerBooking, OwnerTenant, Schedule, SearchResult, Stats} from './types';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export function useOwnerFetch() {
  const auth = useAuth();
  return async function ownerFetch<T>(path: string, opts: {method?: Method; body?: unknown; query?: Record<string, string | number | boolean | undefined | null>; signal?: AbortSignal} = {}): Promise<T> {
    const accessToken = await auth.accessToken();
    if (!accessToken) throw new ApiError(401, 'unauthenticated', 'Войдите снова');
    try {
      return await apiRequest<T>('owner-api', path, {...opts, accessToken});
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await auth.signOut();
      throw error;
    }
  };
}

export const ok = {
  context: () => ['owner', 'context'] as const,
  tenant: (t: string) => ['owner', t, 'tenant'] as const,
  schedule: (t: string, from: string, to: string) => ['owner', t, 'schedule', from, to] as const,
  booking: (t: string, id: string) => ['owner', t, 'booking', id] as const,
  stats: (t: string, from: string, to: string) => ['owner', t, 'stats', from, to] as const,
  search: (t: string, q: string) => ['owner', t, 'search', q] as const,
  availability: (t: string, s: string, from: string, to: string, exclude?: string) => ['owner', t, 'availability', s, from, to, exclude ?? ''] as const,
  push: (t: string) => ['owner', t, 'push'] as const,
};

export function useOwnerContext(enabled: boolean) {
  const f = useOwnerFetch();
  return useQuery({queryKey: ok.context(), enabled, queryFn: ({signal}) => f<{user: {id: string; email?: string}; tenants: Membership[]}>('/context', {signal}), staleTime: 5 * 60_000});
}

export function useOwnerTenant(tenantId: string) {
  const f = useOwnerFetch();
  return useQuery({queryKey: ok.tenant(tenantId), queryFn: ({signal}) => f<{tenant: OwnerTenant}>(`/t/${tenantId}/tenant`, {signal}).then((r) => r.tenant), staleTime: 60_000});
}

export function useSchedule(tenantId: string, from: string, to: string) {
  const f = useOwnerFetch();
  return useQuery<Schedule>({
    queryKey: ok.schedule(tenantId, from, to),
    queryFn: ({signal}) => f<{schedule: Schedule}>(`/t/${tenantId}/schedule`, {query: {from, to}, signal}).then((r) => r.schedule),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useOwnerBooking(tenantId: string, id: string) {
  const f = useOwnerFetch();
  return useQuery({queryKey: ok.booking(tenantId, id), queryFn: ({signal}) => f<{booking: OwnerBooking}>(`/t/${tenantId}/bookings/${id}`, {signal}).then((r) => r.booking)});
}

export function useStats(tenantId: string, from: string, to: string) {
  const f = useOwnerFetch();
  return useQuery<Stats>({queryKey: ok.stats(tenantId, from, to), queryFn: ({signal}) => f<{stats: Stats}>(`/t/${tenantId}/stats`, {query: {from, to}, signal}).then((r) => r.stats), placeholderData: keepPreviousData});
}

export function useSearch(tenantId: string, q: string) {
  const f = useOwnerFetch();
  return useQuery<SearchResult[]>({
    queryKey: ok.search(tenantId, q),
    enabled: q.trim().length >= 2,
    queryFn: ({signal}) => f<{results: SearchResult[]}>(`/t/${tenantId}/search`, {query: {q}, signal}).then((r) => r.results),
    placeholderData: keepPreviousData,
  });
}

export function useOwnerAvailability(tenantId: string, serviceId: string | null, from: string, to: string, exclude?: string) {
  const f = useOwnerFetch();
  return useQuery<Availability>({
    queryKey: ok.availability(tenantId, serviceId ?? '', from, to, exclude),
    enabled: Boolean(serviceId),
    queryFn: ({signal}) => f<{availability: Availability}>(`/t/${tenantId}/availability`, {query: {service: serviceId, from, to, exclude}, signal}).then((r) => r.availability),
    placeholderData: keepPreviousData,
  });
}

export function usePushStatus(tenantId: string) {
  const f = useOwnerFetch();
  return useQuery({queryKey: ok.push(tenantId), queryFn: ({signal}) => f<{devices: number; recent: {kind: string; status: string; dueAt: string; error: string | null}[]}>(`/t/${tenantId}/push`, {signal})});
}

/** Generic owner mutation that refreshes everything of this tenant afterwards. */
export function useOwnerMutation<V, R = unknown>(tenantId: string, request: (vars: V) => {path: string; method?: Method; body?: unknown}) {
  const f = useOwnerFetch();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => {
      const r = request(vars);
      return f<R>(r.path, {method: r.method ?? 'POST', body: r.body});
    },
    onSettled: () => qc.invalidateQueries({queryKey: ['owner', tenantId]}),
  });
}

export function useOwnerAssistant() {
  const auth = useAuth();
  return async (tenantId: string, messages: {role: 'user' | 'assistant'; content: string}[]) =>
    apiRequest<AssistantReply>('assistant', '/owner', {body: {tenantId, messages}, accessToken: await auth.accessToken()});
}
