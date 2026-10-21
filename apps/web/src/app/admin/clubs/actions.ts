"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { act } from "@/lib/domain/kit";
import { syncAllRequirementHolders } from "@/lib/domain/requirements";
import { addDepartmentForClub, decideClub, reinstateClub, setClubGoogleAccountVerified, startAmbassadorProgram } from "@/lib/domain/clubs";
import { decideCustomDocument } from "@/lib/domain/constitution";
import { setClubOffice } from "@/lib/domain/offices";

function refresh() {
  revalidatePath("/admin/clubs", "layout");
  revalidatePath("/clubs/[slug]/manage", "layout");
  revalidatePath("/clubs/[slug]", "page");
  revalidatePath("/clubs");
}

export async function startAmbassadorProgramAction(collegeId: string) {
  const r = await act((actor) => startAmbassadorProgram(actor, collegeId));
  if (r.ok) refresh();
  return r;
}

export async function decideClubAction(input: { clubId: string; decision: "APPROVE" | "CHANGES" | "REJECT"; note?: string }) {
  const r = await act((actor) => decideClub(actor, input));
  if (r.ok) refresh();
  return r;
}

export async function addDepartmentAction(input: { clubId: string; name: string; collegeId: string | null }) {
  const r = await act(async (actor) => {
    const d = await addDepartmentForClub(actor, input.clubId, { name: input.name, collegeId: input.collegeId });
    return { name: d.name };
  });
  if (r.ok) refresh();
  return r;
}

export async function decideDocumentAction(input: { docId: string; approve: boolean; note?: string }) {
  const r = await act((actor) => decideCustomDocument(actor, input));
  if (r.ok) refresh();
  return r;
}

export async function reinstateClubAction(input: { clubId: string; note?: string }) {
  const r = await act((actor) => reinstateClub(actor, input));
  if (r.ok) refresh();
  return r;
}

export async function verifyGoogleAccountAction(input: { clubId: string; email: string; verified: boolean }) {
  const r = await act((actor) => setClubGoogleAccountVerified(actor, input));
  if (r.ok) refresh();
  return r;
}

/**
 * WSUSA moves a club to another office (lib/domain/offices). An office's
 * requirements reach only its own clubs, so the club's people get their
 * requirement tasks re-checked right after the response (the daily sweep
 * would catch it within a day).
 */
export async function setClubOfficeAction(input: { clubId: string; officeId: string }) {
  const r = await act((actor) => setClubOffice(actor, input));
  if (r.ok) {
    refresh();
    revalidatePath("/admin", "layout");
    revalidatePath("/tasks");
    if (r.data.moved)
      after(async () => {
        try {
          await syncAllRequirementHolders({ notify: "due" });
        } catch (e) {
          console.error("[offices] requirement re-check after moving a club failed", e);
        }
      });
  }
  return r;
}
