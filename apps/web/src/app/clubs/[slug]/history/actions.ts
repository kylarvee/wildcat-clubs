"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import * as roles from "@/lib/domain/roles";

export async function addContribution(
  slug: string,
  assignmentId: string,
  input: { title: string; descriptionHtml?: string | null; url?: string | null; fileIds?: string[] },
) {
  const r = await act(async (actor) => {
    const res = await roles.addRoleContribution(actor, assignmentId, input);
    return { skippedFiles: res.skippedFiles };
  });
  revalidatePath(`/clubs/${slug}`, "layout");
  return r;
}

export async function removeContribution(slug: string, projectId: string) {
  const r = await act((actor) => roles.removeRoleContribution(actor, projectId));
  revalidatePath(`/clubs/${slug}`, "layout");
  return r;
}
