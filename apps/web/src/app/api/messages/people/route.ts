import { getCurrentUser } from "@/lib/auth/session";
import { apiRoute } from "@/lib/domain/kit";
import { searchPeople } from "@/lib/domain/messaging";

/**
 * GET /api/messages/people?q=&scope=dm|leaders&conversationId= — people you may
 * message (dm) or add to a leader group (leaders), by name, handle or email.
 * Returns { people: [{ id, name, handle, avatarUrl, avatarColor, context, conversationId }] }.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const res = await apiRoute(async () => ({
    people: await searchPeople(await getCurrentUser(), { q: sp.get("q") ?? "", scope: sp.get("scope") ?? "dm", conversationId: sp.get("conversationId") }),
  }));
  res.headers.set("cache-control", "no-store");
  return res;
}
