"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { setNotificationPreference } from "@/lib/domain/notifications";
import { updateNotificationSettings } from "@/lib/domain/profiles";

/** "Remind me before events" (User.eventReminders), read by the Reminders job (lib/jobs/reminders). */
export async function setEventRemindersAction(on: boolean) {
  const r = await act(async (actor) => {
    await updateNotificationSettings(actor, { eventReminders: on });
  });
  if (r.ok) revalidatePath("/settings/notifications");
  return r;
}

/** One Email or Push switch for a category, or the admins' daily digest (User.notificationPrefs, read by lib/domain/notify). */
export async function setNotificationPreferenceAction(input: { key: string; channel: "email" | "push"; on: boolean }) {
  const r = await act(async (actor) => {
    await setNotificationPreference(actor, input);
  });
  if (r.ok) revalidatePath("/settings/notifications");
  return r;
}
