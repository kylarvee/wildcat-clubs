import { DomainError, apiRoute, invalid } from "@/lib/domain/kit";
import { getCurrentUser } from "@/lib/auth/session";
import { browseFiles } from "@/lib/domain/files";
import type { AcceptKind, ListView, ScopeRef } from "@/lib/files/types";

const VIEWS: ListView[] = ["folder", "trash", "search", "shared"];
const ACCEPTS: AcceptKind[] = ["any", "image", "document", "video"];

/**
 * GET /api/files/list?scope=club|user|university|auto&clubId=&parentId=&q=&view=folder|trash|search|shared&accept=any|image|document|video&tree=1
 * The explorer and the file picker read through here. Only items the viewer
 * may see come back (lib/domain/files decides). scope=auto opens a folder
 * wherever it lives, for folders someone shared with you.
 */
export async function GET(req: Request) {
  return apiRoute(async () => {
    const actor = await getCurrentUser();
    const sp = new URL(req.url).searchParams;
    const clubId = sp.get("clubId") || null;
    const kind = sp.get("scope") ?? (clubId ? "club" : "user");
    let scope: ScopeRef | "auto";
    if (kind === "club") {
      if (!clubId) throw invalid("Missing club.");
      scope = { kind: "club", clubId };
    } else if (kind === "user") {
      if (!actor) throw new DomainError("UNAUTHENTICATED", "Sign in to see your files.");
      scope = { kind: "user", userId: actor.id };
    } else if (kind === "university") {
      scope = { kind: "university" };
    } else if (kind === "auto") {
      scope = "auto";
    } else {
      throw invalid("Unknown file area.");
    }
    const view = VIEWS.find((v) => v === sp.get("view"));
    const accept = ACCEPTS.find((a) => a === sp.get("accept")) ?? null;
    return browseFiles(actor, {
      scope,
      parentId: sp.get("parentId") || null,
      view,
      q: sp.get("q"),
      accept,
      tree: sp.get("tree") === "1",
      contextClubId: clubId,
    });
  });
}
