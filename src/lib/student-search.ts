/* ------------------------------------------------------------------ */
/* Student list search (/fahrschueler). Pure so it can be unit-tested. */
/* Matches name, classes, e-mail, Vertrags- and Kundennummer as text;  */
/* phone numbers by their digits only, so "01527654321" finds          */
/* "0152 7654321" and "+49 152 7654321".                              */
/* ------------------------------------------------------------------ */

export type SearchableStudent = {
  firstName: string;
  lastName: string;
  classes: string;
  phone: string;
  email: string;
  contractNumber: string;
  customerNumber: string;
};

/** Digits of a phone number in national form ("+49 152 …" → "0152…"). */
export function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (value.trim().startsWith("+49")) return `0${digits.slice(2)}`;
  if (digits.startsWith("0049")) return `0${digits.slice(4)}`;
  return digits;
}

export function matchesStudentQuery(student: SearchableStudent, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase("de");
  if (!needle) return true;

  const haystack = [
    `${student.firstName} ${student.lastName}`,
    `${student.lastName} ${student.firstName}`,
    student.classes,
    student.phone,
    student.email,
    student.contractNumber,
    student.customerNumber,
  ]
    .join(" ")
    .toLocaleLowerCase("de");
  if (haystack.includes(needle)) return true;

  // Phone search ignores spaces, dashes, slashes and the +49 prefix.
  // Only for queries that consist of phone characters and carry enough
  // digits — otherwise "B" or "10" would match half the list.
  if (/^[\d\s+()/.-]+$/.test(needle)) {
    const digits = phoneDigits(needle);
    if (digits.length >= 4) {
      const phone = phoneDigits(student.phone);
      if (phone.includes(digits)) return true;
      // "1527654321" without the leading 0
      if (phone.replace(/^0/, "").includes(digits.replace(/^0/, ""))) return true;
    }
  }
  return false;
}
