"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { addOfficeStaff, removeOfficeStaff, updateOffice, type OfficeInput } from "@/lib/domain/offices";

/** Offices show up across the admin console, club pages and founders' confirmations, so refresh broadly. */
function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/clubs/[slug]", "page");
  revalidatePath("/clubs/[slug]/manage", "layout");
}

export async function updateOfficeAction(input: OfficeInput) {
  const r = await act(async (actor) => {
    const o = await updateOffice(actor, input);
    return { name: o.name };
  });
  if (r.ok) refresh();
  return r;
}

export async function addOfficeStaffAction(input: { officeId: string; email: string }) {
  const r = await act((actor) => addOfficeStaff(actor, input));
  if (r.ok) refresh();
  return r;
}

export async function removeOfficeStaffAction(input: { officeId: string; userId: string }) {
  const r = await act((actor) => removeOfficeStaff(actor, input));
  if (r.ok) refresh();
  return r;
}
