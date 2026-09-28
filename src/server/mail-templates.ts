/* ------------------------------------------------------------------ */
/* German plain-text e-mail templates. Pure functions: callers pass     */
/* the data plus the school profile (getCompany) for the signature.     */
/* ------------------------------------------------------------------ */

import type { CompanyProfile } from "../lib/accounting-types";

export type MailSchool = Pick<CompanyProfile, "name" | "address" | "phone" | "email">;

export type RenderedMail = { subject: string; body: string };

const WEEKDAY_DATE = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-09-29" → "Dienstag, 29.09.2026" (falls back to the raw value). */
export function formatGermanDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : WEEKDAY_DATE.format(date);
}

/** Calendar event type → wording used in running text. */
export function lessonLabel(type: string): string {
  switch (type) {
    case "Praktisch":
      return "Fahrstunde";
    case "Theorie":
      return "Theorieunterricht";
    case "Vorstellung zur prakt. Prüfung":
      return "praktische Prüfung";
    case "Theorieprüfung":
      return "Theorieprüfung";
    default:
      return "Termin";
  }
}

const greeting = (name: string): string => {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first ? `Hallo ${first},` : "Hallo,";
};

const timeRange = (start: string, end?: string): string =>
  end ? `${start}–${end} Uhr` : `${start} Uhr`;

const assigned = (instructor?: string | null): string | null =>
  instructor && instructor !== "Nicht zugeteilt" ? instructor : null;

export function signature(school: MailSchool): string {
  const lines = ["Viele Grüße", `Dein Team der ${school.name}`, "", school.name];
  if (school.address) lines.push(school.address);
  if (school.phone) lines.push(`Tel. ${school.phone}`);
  if (school.email) lines.push(school.email);
  return lines.join("\n");
}

const compose = (parts: (string | null | false)[], school: MailSchool): string =>
  `${parts.filter((part) => part !== null && part !== false).join("\n")}\n\n${signature(school)}\n`;

export function requestConfirmedMail(
  data: {
    name: string;
    type: string;
    date: string;
    start: string;
    end?: string;
    instructor?: string | null;
    location?: string;
  },
  school: MailSchool,
): RenderedMail {
  const instructor = assigned(data.instructor);
  return {
    subject: `Terminbestätigung: ${lessonLabel(data.type)} am ${formatGermanDate(data.date)}`,
    body: compose(
      [
        greeting(data.name),
        "",
        "deine Terminanfrage wurde bestätigt:",
        "",
        `Termin:   ${lessonLabel(data.type)}`,
        `Datum:    ${formatGermanDate(data.date)}`,
        `Uhrzeit:  ${timeRange(data.start, data.end)}`,
        instructor ? `Fahrlehrer/in: ${instructor}` : null,
        data.location ? `Ort:      ${data.location}` : null,
        "",
        "Falls du den Termin nicht wahrnehmen kannst, sag bitte rechtzeitig Bescheid.",
      ],
      school,
    ),
  };
}

export function requestDeclinedMail(
  data: { name: string; type: string; date: string; time: string },
  school: MailSchool,
): RenderedMail {
  return {
    subject: `Deine Terminanfrage für den ${formatGermanDate(data.date)}`,
    body: compose(
      [
        greeting(data.name),
        "",
        `leider können wir deinen Wunschtermin (${lessonLabel(data.type)} am ${formatGermanDate(
          data.date,
        )} um ${data.time} Uhr) nicht einrichten.`,
        "",
        school.phone
          ? `Melde dich gern telefonisch unter ${school.phone} oder stelle eine neue Anfrage — wir finden bestimmt einen passenden Termin.`
          : "Stelle gern eine neue Anfrage — wir finden bestimmt einen passenden Termin.",
      ],
      school,
    ),
  };
}

export type LessonMailData = {
  firstName: string;
  type: string;
  date: string;
  start: string;
  end: string;
  instructor?: string | null;
  location?: string;
};

export function lessonReminderMail(
  data: LessonMailData,
  school: MailSchool,
): RenderedMail {
  const instructor = assigned(data.instructor);
  const label = lessonLabel(data.type);
  return {
    subject: `Erinnerung: ${label} morgen um ${data.start} Uhr`,
    body: compose(
      [
        greeting(data.firstName),
        "",
        `kurze Erinnerung an deinen Termin morgen:`,
        "",
        `Termin:   ${label}`,
        `Datum:    ${formatGermanDate(data.date)}`,
        `Uhrzeit:  ${timeRange(data.start, data.end)}`,
        instructor ? `Fahrlehrer/in: ${instructor}` : null,
        data.location ? `Ort:      ${data.location}` : null,
        "",
        data.type === "Theorieprüfung" || data.type === "Vorstellung zur prakt. Prüfung"
          ? "Bitte denk an deinen Personalausweis. Viel Erfolg!"
          : "Wir freuen uns auf dich!",
      ],
      school,
    ),
  };
}

export function lessonCancelledMail(
  data: LessonMailData,
  school: MailSchool,
): RenderedMail {
  const label = lessonLabel(data.type);
  return {
    subject: `Terminabsage: ${label} am ${formatGermanDate(data.date)}`,
    body: compose(
      [
        greeting(data.firstName),
        "",
        `leider müssen wir deinen Termin absagen:`,
        "",
        `Termin:   ${label}`,
        `Datum:    ${formatGermanDate(data.date)}`,
        `Uhrzeit:  ${timeRange(data.start, data.end)}`,
        "",
        "Wir melden uns mit einem Ersatztermin. Bei Fragen erreichst du uns jederzeit.",
      ],
      school,
    ),
  };
}

export function portalLinkMail(
  data: { firstName: string; url: string },
  school: MailSchool,
): RenderedMail {
  return {
    subject: `Dein Zugang zum Schülerportal der ${school.name}`,
    body: compose(
      [
        greeting(data.firstName),
        "",
        "über deinen persönlichen Link siehst du jederzeit deine nächsten Termine, deinen Kontostand und kannst uns direkt schreiben:",
        "",
        data.url,
        "",
        "Bitte gib den Link nicht weiter — er funktioniert ohne Passwort.",
      ],
      school,
    ),
  };
}

export function genericMail(
  data: { subject: string; body: string },
  school: MailSchool,
): RenderedMail {
  return {
    subject: data.subject.trim(),
    body: compose([data.body.trim()], school),
  };
}

/** Short German SMS reminder for tomorrow's Termin. Uses only GSM 03.38
 *  characters (no en dash / typographic quotes) so it fits one segment
 *  in the common case. */
export function lessonReminderSmsText(data: LessonMailData, school: MailSchool): string {
  const [, month, day] = data.date.split("-");
  const instructor = assigned(data.instructor);
  const parts = [
    `${greeting(data.firstName)} Erinnerung: ${lessonLabel(data.type)} morgen (${day}.${month}.) um ${data.start} Uhr`,
    instructor ? ` mit ${instructor}` : "",
    data.location ? `, ${data.location}` : "",
    ".",
    school.phone ? ` Absage bitte rechtzeitig: ${school.phone}.` : "",
    ` ${school.name}`,
  ];
  return parts.join("").replace(/[–—]/g, "-");
}
