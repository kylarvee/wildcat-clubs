"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { updateNotificationSettings } from "@/lib/domain/profiles";

/** "Remind me before events" (User.eventReminders), read by the Reminders job (lib/jobs/reminders). */
export async function setEventRemindersAction(on: boolean) {
  const r = await act(async (actor) => {
    await updateNotificationSettings(actor, { eventReminders: on });
  });
  if (r.ok) revalidatePath("/settings/notifications");
  return r;
}
