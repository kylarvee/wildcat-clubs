"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { createUniversityAnnouncement, deleteAnnouncement, setAnnouncementPinned, updateAnnouncement } from "@/lib/domain/announcements";
import type { AnnouncementDraft } from "@/components/announcements/AnnouncementComposer";

/** University announcements show on the admin list, every dashboard and (when public) the landing page. */
function refresh() {
  revalidatePath("/admin/announcements", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/");
}

export async function createUniversityAnnouncementAction(input: AnnouncementDraft) {
  const r = await act((actor) => createUniversityAnnouncement(actor, input));
  if (r.ok) refresh();
  return r;
}

export async function updateUniversityAnnouncementAction(id: string, input: AnnouncementDraft) {
  const r = await act((actor) => updateAnnouncement(actor, id, input));
  if (r.ok) refresh();
  return r;
}

export async function setUniversityAnnouncementPinnedAction(id: string, pinned: boolean) {
  const r = await act((actor) => setAnnouncementPinned(actor, id, pinned));
  if (r.ok) refresh();
  return r;
}

export async function deleteUniversityAnnouncementAction(id: string) {
  const r = await act((actor) => deleteAnnouncement(actor, id));
  if (r.ok) refresh();
  return r;
}
