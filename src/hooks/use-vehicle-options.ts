import { useEffect, useState } from "react";

import { parseOrThrow } from "@/lib/api";
import { UNASSIGNED_VEHICLE } from "@/lib/vehicle-options";

/* Labels are unique per vehicle ("Modell", or "Modell · Kennzeichen" when
   two vehicles share a model); the server resolves them back to ids. */
async function fetchVehicleOptions(): Promise<string[]> {
  const data = await parseOrThrow<{ vehicleOptions: string[] }>(
    await fetch("/api/vehicle-options"),
  );
  return data.vehicleOptions;
}

export function useVehicleOptions() {
  const [vehicleOptions, setVehicleOptions] = useState<string[]>([]);

  useEffect(() => {
    let active = true;

    const loadOptions = async () => {
      try {
        const options = await fetchVehicleOptions();
        if (active) setVehicleOptions(options);
      } catch {
        // Keep the selector usable if the endpoint is temporarily unavailable.
        if (active) setVehicleOptions([UNASSIGNED_VEHICLE]);
      }
    };

    void loadOptions();

    return () => {
      active = false;
    };
  }, []);

  return { vehicleOptions };
}
