/* ------------------------------------------------------------------ */
/* Fahrzeuge — single client-side source of truth                         */
/*                                                                    */
/* /fahrzeuge and Fahrzeug selection in other pages read from this hook  */
/* so all vehicle edits persist and survive reloads.                   */
/* ------------------------------------------------------------------ */

import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { parseOrThrow } from "@/lib/api";

export type VehicleDetail = {
  label: string;
  value: string;
};

export type VehicleStatus = "aktiv" | "wartung";

export type Vehicle = {
  id: number;
  model: string;
  plate: string;
  klass: string;
  status: VehicleStatus;
  accent: string;
  details: VehicleDetail[];
  /** Instructors whose Stammfahrzeug this is — the "Fahrlehrer/in" detail
   *  is derived from it on the server (single source of truth). */
  instructorIds?: number[];
};

export type VehicleInput = Omit<Vehicle, "id" | "instructorIds"> & {
  /** Make this vehicle the Stammfahrzeug of that instructor (null = nobody). */
  instructorId?: number | null;
};

export async function fetchVehicles(): Promise<Vehicle[]> {
  const data = await parseOrThrow<{ vehicles: Vehicle[] }>(await fetch("/api/vehicles"));
  return data.vehicles;
}

export async function createVehicle(input: Partial<VehicleInput>): Promise<Vehicle> {
  return parseOrThrow<Vehicle>(
    await fetch("/api/vehicles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function updateVehicle(
  id: number,
  input: Partial<VehicleInput>,
): Promise<Vehicle> {
  return parseOrThrow<Vehicle>(
    await fetch(`/api/vehicles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteVehicle(id: number): Promise<void> {
  await parseOrThrow<{ ok: true }>(
    await fetch(`/api/vehicles/${id}`, { method: "DELETE" }),
  );
}

export const vehicleQueryKeys = {
  all: ["vehicles"] as const,
};

export const vehiclesQueryOptions = queryOptions({
  queryKey: vehicleQueryKeys.all,
  queryFn: fetchVehicles,
});

export function useVehicles() {
  const query = useQuery(vehiclesQueryOptions);
  return {
    vehicles: query.data ?? [],
    loading: query.isPending,
    error: query.error,
    refresh: query.refetch,
  };
}

/* A vehicle change can move an instructor's Stammfahrzeug — refresh both. */
function useInvalidateVehicles() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: vehicleQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["instructors"] }),
      queryClient.invalidateQueries({ queryKey: ["vehicle-options"] }),
    ]);
}

export function useCreateVehicle() {
  const invalidateVehicles = useInvalidateVehicles();
  return useMutation({
    mutationFn: createVehicle,
    onSuccess: invalidateVehicles,
  });
}

export function useUpdateVehicle() {
  const invalidateVehicles = useInvalidateVehicles();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: Partial<VehicleInput> }) =>
      updateVehicle(id, input),
    onSuccess: invalidateVehicles,
  });
}

export function useDeleteVehicle() {
  const invalidateVehicles = useInvalidateVehicles();
  return useMutation({
    mutationFn: deleteVehicle,
    onSuccess: invalidateVehicles,
  });
}
