"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { complaintStatusByCode, submitComplaint, type SubmitComplaintInput } from "@/lib/domain/complaints";

export async function submitComplaintAction(input: SubmitComplaintInput) {
  const r = await act((actor) => submitComplaint(actor, input));
  if (r.ok) {
    revalidatePath("/report");
    revalidatePath("/admin/complaints");
  }
  return r;
}

/** POST, not a query string: case codes stay out of URLs and browser history. */
export async function checkComplaintStatusAction(code: string) {
  return act((actor) => complaintStatusByCode(actor, code));
}
