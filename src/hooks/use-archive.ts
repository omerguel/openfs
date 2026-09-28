/* ------------------------------------------------------------------ */
/* Archiv — deleted records (Papierkorb) from /api/archive.            */
/* Restore re-creates the original record; purge removes it forever.   */
/* ------------------------------------------------------------------ */

import { parseOrThrow, useFetchList } from "@/lib/api";

export type ArchiveEntity =
  | "student"
  | "calendar_event"
  | "instructor"
  | "vehicle"
  | "price_plan";

export type ArchiveItem = {
  id: number;
  entity: ArchiveEntity;
  label: string;
  deletedAt: string;
  /** Who deleted it ("" for older entries or system deletes). */
  deletedBy: string;
  /** Short summary (Kundennummer, Termin-Datum, Kennzeichen …). */
  detail: string;
};

export async function fetchArchive(): Promise<ArchiveItem[]> {
  const data = await parseOrThrow<{ items: ArchiveItem[] }>(await fetch("/api/archive"));
  return data.items;
}

export async function restoreArchived(id: number): Promise<ArchiveItem> {
  return parseOrThrow<ArchiveItem>(
    await fetch(`/api/archive/${id}/restore`, { method: "POST" }),
  );
}

export async function purgeArchived(id: number): Promise<void> {
  await parseOrThrow<{ ok: true }>(
    await fetch(`/api/archive/${id}`, { method: "DELETE" }),
  );
}

export function useArchive() {
  const { items, loading, refresh } = useFetchList(
    ["archive"],
    fetchArchive,
    "Archiv konnte nicht geladen werden",
  );
  return { items, loading, refresh };
}

/** Contract data of archived students (Verträge → "Archiviert"). */
export type ArchivedContract = {
  archiveId: number;
  deletedAt: string;
  reason: string | null;
  studentId: number;
  firstName: string;
  lastName: string;
  contractNumber: string;
  customerNumber: string;
  classes: string;
  registrationDate: string;
  pricePlanId: number | null;
};

export async function fetchArchivedContracts(): Promise<ArchivedContract[]> {
  const data = await parseOrThrow<{ contracts: ArchivedContract[] }>(
    await fetch("/api/students/archived"),
  );
  return data.contracts;
}

export function useArchivedContracts() {
  const { items, loading, refresh } = useFetchList(
    ["archive", "contracts"],
    fetchArchivedContracts,
    "Archivierte Verträge konnten nicht geladen werden",
  );
  return { contracts: items, loading, refresh };
}
