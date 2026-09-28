/* ------------------------------------------------------------------ */
/* Money visibility per role. Fahrlehrer/innen see no balances, prices */
/* or billing actions — the server rejects the finance endpoints for   */
/* them anyway (FAHRLEHRER_ALLOWED in auth.ts), so the UI must not ask */
/* (a 403 in the console on every page view).                          */
/* ------------------------------------------------------------------ */

import { useAuthStatus } from "@/hooks/use-auth";
import { queryClient } from "@/lib/query-client";

/** `canSeeMoney` stays false until the role is known, so no finance
 *  request goes out for a Fahrlehrer/in while the status loads. */
export function useFinanceAccess() {
  const { data, isPending } = useAuthStatus();
  const role = data?.user?.role;
  return {
    role,
    canSeeMoney: !isPending && role !== undefined && role !== "fahrlehrer",
    isInstructor: role === "fahrlehrer",
  };
}

/** After a payment, charge or Storno: every place that shows a
 *  student's balance (detail header, Übersicht, lists) reloads. */
export async function invalidateStudentMoney(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["students"] }),
    queryClient.invalidateQueries({ queryKey: ["student-balances"] }),
    // Instalment plans and open items count the same payments.
    queryClient.invalidateQueries({ queryKey: ["payment-plans"] }),
    queryClient.invalidateQueries({ queryKey: ["invoices"] }),
  ]);
}
