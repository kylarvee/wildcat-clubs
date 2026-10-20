import { redirect } from "next/navigation";

/**
 * The calendar is the Events page's Month view now. Old links and bookmarks
 * land there: /calendar on Mine, /calendar?all=1 on All of Weber State
 * (signed out, Mine falls back to All).
 */
export default async function CalendarRedirect({ searchParams }: { searchParams: Promise<{ all?: string | string[] }> }) {
  const { all } = await searchParams;
  redirect(`/events?scope=${all === "1" ? "all" : "mine"}&view=month`);
}
