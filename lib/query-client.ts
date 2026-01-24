import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,      // 5 minutes - matches server ISR
      gcTime: 30 * 60 * 1000,        // 30 minutes garbage collection
      refetchOnWindowFocus: false,   // Don't refetch on tab focus
      retry: 2,
    },
  },
});
