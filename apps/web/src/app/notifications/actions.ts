"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import * as notifications from "@/lib/domain/notifications";

/** The unread count sits in the header on every page, so changes refresh the layout. */
function refresh() {
  revalidatePath("/", "layout");
}

export async function markReadAction(notificationId: string) {
  const r = await act((actor) => notifications.markRead(actor, notificationId));
  if (r.ok) refresh();
  return r;
}

export async function markUnreadAction(notificationId: string) {
  const r = await act((actor) => notifications.markUnread(actor, notificationId));
  if (r.ok) refresh();
  return r;
}

export async function markAllReadAction() {
  const r = await act((actor) => notifications.markAllRead(actor));
  if (r.ok) refresh();
  return r;
}
