import { QueryClient } from "@tanstack/react-query";

import { HttpError } from "@/lib/api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // One retry for flaky networks — never for "not signed in / not
      // allowed", which only delays the sign-in page.
      retry: (failureCount, error) =>
        failureCount < 1 &&
        !(error instanceof HttpError && (error.status === 401 || error.status === 403)),
    },
  },
});
