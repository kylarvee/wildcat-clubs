"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { addComplaintNote, openComplaint, setComplaintStatus } from "@/lib/domain/complaints";

/**
 * Report details travel only through these actions — never in the page
 * payload — so an anonymous report can't be read without acknowledging the
 * notice, and every opening is logged.
 */
export async function openComplaintAction(id: string, acknowledged: boolean) {
  const r = await act((actor) => openComplaint(actor, id, { acknowledged }));
  if (r.ok) revalidatePath("/admin/complaints");
  return r;
}

export async function addComplaintNoteAction(id: string, body: string) {
  const r = await act((actor) => addComplaintNote(actor, id, { body }));
  if (r.ok) revalidatePath("/admin/complaints");
  return r;
}

export async function setComplaintStatusAction(id: string, status: string, note?: string | null) {
  const r = await act((actor) => setComplaintStatus(actor, id, { status, note }));
  if (r.ok) {
    revalidatePath("/admin/complaints");
    revalidatePath("/report");
  }
  return r;
}
