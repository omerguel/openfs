/* ------------------------------------------------------------------ */
/* School-local time. Termine are stored as wall-clock times of the    */
/* school ("14:00" = 14:00 in Germany), but the server may run in UTC  */
/* (containers, cloud hosts). Comparisons like "has this lesson ended" */
/* must therefore use the school's wall clock, not the process zone.   */
/* SCHOOL_TIMEZONE overrides the default Europe/Berlin.                */
/* ------------------------------------------------------------------ */

export function schoolTimeZone(): string {
  return process.env.SCHOOL_TIMEZONE || "Europe/Berlin";
}

/** A Date whose *local* getters (getHours, getDate, …) read the school's
 *  wall-clock time at the instant `now`. */
export function schoolNow(now = new Date()): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: schoolTimeZone(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
}

/** "YYYY-MM-DD" of the school's current day. */
export function schoolToday(now = new Date()): string {
  const local = schoolNow(now);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(
    local.getDate(),
  ).padStart(2, "0")}`;
}
