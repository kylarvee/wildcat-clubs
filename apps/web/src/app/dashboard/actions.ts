"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { dismissAppPrompt } from "@/lib/domain/profiles";

/** "Not now" on the dashboard's get-the-app card — permanent, same as after registering. */
export async function dismissAppPromptAction() {
  const r = await act((actor) => dismissAppPrompt(actor));
  if (r.ok) revalidatePath("/dashboard");
  return r;
}
