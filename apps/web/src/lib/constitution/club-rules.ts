import "server-only";
import { db } from "@/lib/db";
import { normalizeDraftData, type DraftData } from "@/lib/constitution/templates";
import { rulesFromAnswers, type ClubRules } from "@/lib/constitution/rules";

/**
 * What a club's documents in effect say, for the engines that follow them.
 * clubRules() is the one way to read the bylaw answers Wildcat Clubs
 * enforces (lib/constitution/rules lists them): elections freeze them when a
 * selection starts, the "Fill a seat" form suggests from them, and staffing
 * dates WSUSA's tasks with them.
 *
 * Answers come only from ClubDocument.builderAnswers, the answers kept with
 * each adopted document. A builder document adopted before answers were kept
 * sets no rules (its draft may have changed since), so the platform's
 * defaults apply until the club adopts again.
 */
export async function clubRules(clubId: string): Promise<ClubRules> {
  const docs = await db.clubDocument.findMany({
    where: { clubId, status: "ACTIVE", kind: { in: ["CONSTITUTION", "BYLAWS"] } },
    orderBy: { createdAt: "desc" },
    select: { kind: true, source: true, builderAnswers: true },
  });
  const answers = (kind: "CONSTITUTION" | "BYLAWS"): DraftData | null => {
    const d = docs.find((x) => x.kind === kind);
    return d && d.source === "BUILDER" && d.builderAnswers ? normalizeDraftData(d.builderAnswers) : null;
  };
  return rulesFromAnswers({ constitution: answers("CONSTITUTION"), bylaws: answers("BYLAWS") });
}

/**
 * The answers behind the builder documents in effect, for "Start from the
 * current version": kept with the document, or, for an adoption from before
 * answers were kept, the draft it was adopted from. Null when no builder
 * document is in effect.
 */
export async function currentBuilderAnswers(clubId: string): Promise<{ data: DraftData; source: "document" | "draft"; version: number } | null> {
  const docs = await db.clubDocument.findMany({
    where: { clubId, status: "ACTIVE", source: "BUILDER", kind: { in: ["CONSTITUTION", "BYLAWS"] } },
    orderBy: { createdAt: "desc" },
    select: { version: true, builderAnswers: true, draft: { select: { data: true } } },
  });
  for (const d of docs) if (d.builderAnswers) return { data: normalizeDraftData(d.builderAnswers), source: "document", version: d.version };
  for (const d of docs) if (d.draft) return { data: normalizeDraftData(d.draft.data), source: "draft", version: d.version };
  return null;
}
