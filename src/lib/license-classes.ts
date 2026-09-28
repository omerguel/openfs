/* ------------------------------------------------------------------ */
/* Führerscheinklassen — the classes a Fahrschule trains for, shared   */
/* by the Schüler-Anmeldung, the student detail page and price plans.  */
/* A student's `classes` is a free-text list ("B", "B, A1"); these are */
/* the options offered, not a whitelist.                               */
/* ------------------------------------------------------------------ */

export const LICENSE_CLASS_GROUPS: { label: string; classes: string[] }[] = [
  { label: "Pkw", classes: ["B", "B197", "B96", "BE"] },
  { label: "Motorrad", classes: ["AM", "A1", "A2", "A", "Mofa"] },
  { label: "Lkw / Bus", classes: ["C1", "C1E", "C", "CE", "D1", "D"] },
  { label: "Landwirtschaft", classes: ["L", "T"] },
];

export const LICENSE_CLASSES: string[] = LICENSE_CLASS_GROUPS.flatMap(
  (group) => group.classes,
);

/** "B, A1" / "B,A1" / "B/A1" → ["B", "A1"] (trimmed, deduplicated). */
export function splitClassList(classes: string): string[] {
  return [
    ...new Set(
      classes
        .split(/[,/;+|]+/)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

/** Classes whose Sonderfahrten follow the class-B minimums
    (Anlage 4 FahrschAusbO): B and B197 (Schaltkompetenz). */
export function hasClassBSpecialDrives(classes: string): boolean {
  return splitClassList(classes).some((klass) => {
    const upper = klass.toUpperCase();
    return upper === "B" || upper === "B197";
  });
}

/** Begleitetes Fahren ab 17 (BF17) is possible for B, B197 and BE. */
export function allowsAccompaniedDriving(classes: string): boolean {
  return splitClassList(classes).some((klass) =>
    ["B", "B197", "BE"].includes(klass.toUpperCase()),
  );
}

/** Age in full years on `today` for a "TT.MM.JJJJ" birthday; null if unparsable. */
export function ageInYears(birthday: string, today = new Date()): number | null {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(birthday.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let age = today.getFullYear() - year;
  const beforeBirthday =
    today.getMonth() + 1 < month ||
    (today.getMonth() + 1 === month && today.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 120 ? age : null;
}
