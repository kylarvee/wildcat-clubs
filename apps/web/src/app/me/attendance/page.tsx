import { permanentRedirect } from "next/navigation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * My attendance is part of My involvement now (/me/involvement), next to
 * leadership roles and service hours. Old links, bookmarks and notifications
 * land there with their filters (the browser keeps any #history anchor).
 */
export default async function MyAttendanceMoved({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const value of Array.isArray(v) ? v : v ? [v] : []) qs.append(k, value);
  permanentRedirect(`/me/involvement${qs.size ? `?${qs}` : ""}`);
}
