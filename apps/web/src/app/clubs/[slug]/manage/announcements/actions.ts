"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { act } from "@/lib/domain/kit";
import { createClubAnnouncement, deleteAnnouncement, setAnnouncementPinned, updateAnnouncement } from "@/lib/domain/announcements";
import type { AnnouncementDraft } from "@/components/announcements/AnnouncementComposer";

/** Refreshes the tool, the club page and dashboards after a change. The slug is looked up, never trusted from the client. */
async function refresh(clubId: string | null | undefined) {
  if (clubId) {
    const club = await db.club.findUnique({ where: { id: clubId }, select: { slug: true } });
    if (club) {
      revalidatePath(`/clubs/${club.slug}/manage/announcements`, "layout");
      revalidatePath(`/clubs/${club.slug}`);
    }
  }
  revalidatePath("/dashboard");
}

const clubOf = async (id: string) => (await db.announcement.findUnique({ where: { id }, select: { clubId: true } }))?.clubId ?? null;

export async function createClubAnnouncementAction(clubId: string, input: AnnouncementDraft) {
  const r = await act((actor) => createClubAnnouncement(actor, clubId, input));
  if (r.ok) await refresh(clubId);
  return r;
}

export async function updateClubAnnouncementAction(id: string, input: AnnouncementDraft) {
  const r = await act((actor) => updateAnnouncement(actor, id, input));
  if (r.ok) await refresh(await clubOf(id));
  return r;
}

export async function setClubAnnouncementPinnedAction(id: string, pinned: boolean) {
  const r = await act((actor) => setAnnouncementPinned(actor, id, pinned));
  if (r.ok) await refresh(await clubOf(id));
  return r;
}

export async function deleteClubAnnouncementAction(id: string) {
  const clubId = await clubOf(id);
  const r = await act((actor) => deleteAnnouncement(actor, id));
  if (r.ok) await refresh(clubId);
  return r;
}
