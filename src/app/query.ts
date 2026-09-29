import {QueryClient} from '@tanstack/react-query';
import {ApiError} from '@/shared/api';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (count, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429) return false;
          return count < 2;
        },
      },
      mutations: {retry: false},
    },
  });
}
