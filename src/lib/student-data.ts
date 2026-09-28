/* ------------------------------------------------------------------ */
/* Student data — types + one-time DB seed                             */
/*                                                                     */
/* At runtime the students live in SQLite (students table, served via  */
/* /api/students) — pages read them through the useStudents() hook so  */
/* edits persist. The array below is only imported by the server to    */
/* seed an empty database (src/server/db.ts) and to map the demo       */
/* accounting transactions (src/server/seed.ts).                       */
/* ------------------------------------------------------------------ */

export type StudentStatus = "aktiv" | "inaktiv";

export type TheoryStatus = "Aktiv" | "In Prüfung" | "Bereit" | "Pausiert";

export type Lesson = { label: string; done: string };

export type UploadedStudentDocument = {
  kind: "upload";
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  dataUrl: string;
};

export type StudentDocument = string | UploadedStudentDocument;

export type TheoryProfile = {
  lastLogin: string;
  preExams: string;
  exam: string;
  status: TheoryStatus;
  progress: number;
};

export type Student = {
  // Identity
  firstName: string;
  lastName: string;
  birthday: string;
  // Contact
  phone: string;
  email: string;
  address: string;
  // Enrollment
  classes: string;
  drivingSchool: string;
  registrationDate: string;
  contractNumber: string;
  customerNumber: string;
  status: StudentStatus;
  instructor: string;
  vehicle: string;
  // Derived by the server on read — never stored or edited:
  // balance/balanceCents from the ledger, last/next lesson from the
  // calendar, lessons (Sonderfahrten) from tagged practical lessons.
  balance: string;
  balanceCents?: number;
  /** Assigned Preisplan (price_plans.id) — null/undefined = default plan. */
  pricePlanId?: number | null;
  // Milestone
  /** ISO date (YYYY-MM-DD) the license was issued; undefined = not yet issued. */
  licenseDate?: string;
  // Practical training (lastLesson/nextLesson/lessons derived, see above)
  lastLesson: string;
  nextLesson: string;
  progress: number;
  lessons: Lesson[];
  documents: StudentDocument[];
  // Theory course (the /theorie view)
  theory: TheoryProfile;
};

export const students: Student[] = [
  {
    firstName: "Lena",
    lastName: "Braun",
    birthday: "11.08.1999",
    phone: "+49 151 23456780",
    email: "lena.braun@example.com",
    address: "Weidingweg 31, 64297 Darmstadt",
    classes: "B",
    drivingSchool: "Fahrschule Demo",
    registrationDate: "12.05.2026",
    contractNumber: "V-2026-1042",
    customerNumber: "10057",
    status: "aktiv",
    instructor: "Nadine Aksoy",
    vehicle: "VW Golf",
    balance: "320,00 EUR",
    lastLesson: "08.06.2026, 16:00",
    nextLesson: "10.06.2026, 15:30",
    progress: 78,
    lessons: [
      { label: "Nachtfahrt", done: "0/135min" },
      { label: "Autobahnfahrt", done: "0/180min" },
      { label: "Überlandfahrt", done: "0/225min" },
      { label: "Theorieunterricht", done: "6 Einheiten" },
    ],
    documents: ["Personalausweis", "Passbild", "Sehtest"],
    theory: {
      lastLogin: "Heute, 08:42",
      preExams: "3 bestanden",
      exam: "18.06.2026",
      status: "Aktiv",
      progress: 78,
    },
  },
  {
    firstName: "Tom",
    lastName: "Richter",
    birthday: "04.02.2001",
    phone: "+49 160 8876543",
    email: "tom.richter@example.com",
    address: "Rheinstraße 18, 64283 Darmstadt",
    classes: "A",
    drivingSchool: "Fahrschule Demo",
    registrationDate: "03.05.2026",
    contractNumber: "V-2026-1018",
    customerNumber: "10058",
    status: "aktiv",
    instructor: "Emre Yilmaz",
    vehicle: "Audi A3",
    balance: "-85,00 EUR",
    lastLesson: "07.06.2026, 11:00",
    nextLesson: "12.06.2026, 10:00",
    progress: 42,
    lessons: [
      { label: "Nachtfahrt", done: "45/135min" },
      { label: "Autobahnfahrt", done: "0/180min" },
      { label: "Überlandfahrt", done: "90/225min" },
      { label: "Theorieunterricht", done: "4 Einheiten" },
    ],
    documents: ["Personalausweis", "Anmeldung"],
    theory: {
      lastLogin: "Gestern, 19:10",
      preExams: "1 offen",
      exam: "Nicht geplant",
      status: "In Prüfung",
      progress: 46,
    },
  },
  {
    firstName: "Aylin",
    lastName: "Demir",
    birthday: "27.10.1998",
    phone: "+49 176 4455123",
    email: "aylin.demir@example.com",
    address: "Bleichstraße 9, 64283 Darmstadt",
    classes: "B197",
    drivingSchool: "Fahrschule Demo",
    registrationDate: "21.04.2026",
    contractNumber: "V-2026-0987",
    customerNumber: "10051",
    status: "aktiv",
    instructor: "Sven Kappel",
    vehicle: "Cupra Born",
    balance: "0,00 EUR",
    lastLesson: "06.06.2026, 14:00",
    nextLesson: "11.06.2026, 17:00",
    progress: 91,
    lessons: [
      { label: "Nachtfahrt", done: "135/135min" },
      { label: "Autobahnfahrt", done: "180/180min" },
      { label: "Überlandfahrt", done: "180/225min" },
      { label: "Theorieunterricht", done: "12 Einheiten" },
    ],
    documents: ["Personalausweis", "Passbild", "Sehtest", "Erste Hilfe"],
    theory: {
      lastLogin: "08.06.2026",
      preExams: "5 bestanden",
      exam: "12.06.2026",
      status: "Bereit",
      progress: 91,
    },
  },
  {
    firstName: "Jonas",
    lastName: "Meyer",
    birthday: "19.06.1997",
    phone: "+49 152 3099881",
    email: "jonas.meyer@example.com",
    address: "Pallaswiesenstraße 44, 64293 Darmstadt",
    classes: "BE",
    drivingSchool: "Fahrschule Demo",
    registrationDate: "09.04.2026",
    contractNumber: "V-2026-0941",
    customerNumber: "10043",
    status: "inaktiv",
    instructor: "Nicht zugeteilt",
    vehicle: "Nicht zugeteilt",
    balance: "145,00 EUR",
    lastLesson: "05.06.2026, 09:30",
    nextLesson: "Nicht geplant",
    progress: 24,
    lessons: [
      { label: "Nachtfahrt", done: "0/135min" },
      { label: "Autobahnfahrt", done: "0/180min" },
      { label: "Überlandfahrt", done: "45/225min" },
      { label: "Theorieunterricht", done: "2 Einheiten" },
    ],
    documents: ["Personalausweis"],
    theory: {
      lastLogin: "05.06.2026",
      preExams: "Keine",
      exam: "Nicht geplant",
      status: "Aktiv",
      progress: 32,
    },
  },
  {
    firstName: "Mara",
    lastName: "Köhler",
    birthday: "02.12.2000",
    phone: "+49 171 7788990",
    email: "mara.koehler@example.com",
    address: "Heidelberger Straße 71, 64285 Darmstadt",
    classes: "B",
    drivingSchool: "Fahrschule Demo",
    registrationDate: "18.03.2026",
    contractNumber: "V-2026-0886",
    customerNumber: "10037",
    status: "inaktiv",
    instructor: "Nadine Aksoy",
    vehicle: "VW Golf",
    balance: "-210,00 EUR",
    lastLesson: "01.06.2026, 13:00",
    nextLesson: "13.06.2026, 12:30",
    progress: 58,
    lessons: [
      { label: "Nachtfahrt", done: "90/135min" },
      { label: "Autobahnfahrt", done: "45/180min" },
      { label: "Überlandfahrt", done: "90/225min" },
      { label: "Theorieunterricht", done: "8 Einheiten" },
    ],
    documents: ["Personalausweis", "Passbild"],
    theory: {
      lastLogin: "01.06.2026",
      preExams: "2 bestanden",
      exam: "25.06.2026",
      status: "Pausiert",
      progress: 64,
    },
  },
];
