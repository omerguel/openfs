/* ------------------------------------------------------------------ */
/* Preispläne — single client-side source of truth.                    */
/*                                                                     */
/* The /preisangebot page and the Fahrschüler detail "Preise" tab      */
/* read the same DB-backed list from /api/price-plans via this hook.   */
/* Edits go through createPricePlan / updatePricePlan / deletePricePlan */
/* so they persist across reloads.                                     */
/* ------------------------------------------------------------------ */

import { useFinanceAccess } from "@/hooks/use-finance-access";
import type { PricePlanInput, PricePlanRecord } from "@/lib/price-plan";
import { parseOrThrow, useFetchList } from "@/lib/api";

export async function fetchPricePlans(): Promise<PricePlanRecord[]> {
  const data = await parseOrThrow<{ plans: PricePlanRecord[] }>(
    await fetch("/api/price-plans"),
  );
  return data.plans;
}

export async function createPricePlan(input: PricePlanInput): Promise<PricePlanRecord> {
  return parseOrThrow<PricePlanRecord>(
    await fetch("/api/price-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function updatePricePlan(
  id: number,
  input: Partial<PricePlanInput>,
): Promise<PricePlanRecord> {
  return parseOrThrow<PricePlanRecord>(
    await fetch(`/api/price-plans/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deletePricePlan(id: number): Promise<void> {
  await parseOrThrow<{ ok: true }>(
    await fetch(`/api/price-plans/${id}`, { method: "DELETE" }),
  );
}

/** Price plans are money: Fahrlehrer/innen get an empty list (the API
 *  answers 403 for them, so the hook does not even ask). */
export function usePricePlans() {
  const { canSeeMoney, role } = useFinanceAccess();
  const {
    items: plans,
    loading,
    refresh,
  } = useFetchList(
    ["price-plans"],
    fetchPricePlans,
    "Preispläne konnten nicht geladen werden",
    canSeeMoney,
  );

  // Until the role is known the list counts as loading, not empty.
  return { plans, loading: loading || role === undefined, refresh };
}
