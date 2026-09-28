/* ------------------------------------------------------------------ */
/* Statistik — client hook for the /api/statistics aggregate payload.  */
/* Single fetch-on-mount (no list semantics), same parseOrThrow error  */
/* handling as the other hooks in src/hooks/.                          */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useState } from "react";

import { parseOrThrow } from "@/lib/api";

export type MonthCount = {
  /** ISO month "YYYY-MM". */
  month: string;
  count: number;
};

export type StudentStatistics = {
  total: number;
  aktiv: number;
  inaktiv: number;
  registrationsPerMonth: MonthCount[];
};

export type LessonTypeCount = {
  type: string;
  count: number;
};

export type LessonsPerMonth = {
  month: string;
  praktisch: number;
  theorie: number;
  pruefung: number;
  andere: number;
  total: number;
};

export type LessonStatistics = {
  total: number;
  byType: LessonTypeCount[];
  perMonth: LessonsPerMonth[];
};

export type InstructorUtilization = {
  instructor: string;
  events: number;
  minutes: number;
};

export type InstructorStatistics = {
  total: number;
  aktiv: number;
  utilization: InstructorUtilization[];
};

export type VehicleStatistics = {
  total: number;
  aktiv: number;
  wartung: number;
};

export type RevenuePerMonth = {
  month: string;
  cents: number;
};

export type RevenueStatistics = {
  totalCents: number;
  perMonth: RevenuePerMonth[];
};

export type ExamTypeStatistics = {
  type: string;
  total: number;
  bestanden: number;
  nicht_bestanden: number;
  offen: number;
  /** First-attempt pass rate 0–1; null if no first-attempt data. */
  firstAttemptPassRate: number | null;
};

export type ExamStatistics = {
  byType: ExamTypeStatistics[];
};

export type Statistics = {
  students: StudentStatistics;
  lessons: LessonStatistics;
  instructors: InstructorStatistics;
  vehicles: VehicleStatistics;
  revenue: RevenueStatistics;
  exams: ExamStatistics;
};

export async function fetchStatistics(): Promise<Statistics> {
  return parseOrThrow<Statistics>(await fetch("/api/statistics"));
}

/** `enabled: false` skips the request (roles without finance access). */
export function useStatistics(enabled = true) {
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    try {
      setStatistics(await fetchStatistics());
    } catch (error) {
      console.error("Statistik konnte nicht geladen werden:", error);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { statistics, loading, refresh };
}
