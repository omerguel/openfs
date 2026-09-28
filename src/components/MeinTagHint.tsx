/* ------------------------------------------------------------------ */
/* Dashboard entry to "Mein Tag" for the Fahrlehrer role.              */
/* On a phone the first visit of the session goes straight to the day  */
/* view (instructors open the app in the car); afterwards Home stays   */
/* reachable and shows this link card instead.                         */
/* ------------------------------------------------------------------ */

import { useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Sun } from "lucide-react";

import { useAuthStatus } from "@/hooks/use-auth";

const REDIRECT_KEY = "openfs:mein-tag-redirected";

export function MeinTagHint() {
  const { data: auth } = useAuthStatus();
  const navigate = useNavigate();
  const isInstructor = auth?.user?.role === "fahrlehrer";

  useEffect(() => {
    if (!isInstructor) return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    try {
      if (sessionStorage.getItem(REDIRECT_KEY)) return;
      sessionStorage.setItem(REDIRECT_KEY, "1");
    } catch {
      return; // storage blocked — never loop
    }
    void navigate({ to: "/mein-tag", replace: true });
  }, [isInstructor, navigate]);

  if (!isInstructor) return null;
  return (
    <Link
      to="/mein-tag"
      className="flex items-center gap-3 rounded-lg border bg-background px-4 py-3 transition-colors duration-150 hover:bg-muted hover:duration-0 xl:col-span-12"
    >
      <Sun aria-hidden className="size-4 text-muted-foreground" />
      <span className="flex-1">
        <span className="block text-sm font-medium">Mein Tag</span>
        <span className="block text-xs text-muted-foreground">
          Ihre Fahrstunden heute und morgen mit Nachweis, Notiz und Absage
        </span>
      </span>
      <ArrowRight aria-hidden className="size-4 text-muted-foreground" />
    </Link>
  );
}
