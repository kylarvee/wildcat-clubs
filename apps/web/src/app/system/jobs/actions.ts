"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { runJobsNow } from "@/lib/domain/system";

/** Runs the same jobs the cron does. Jobs touch tasks, elections and notifications everywhere. */
export async function runJobsNowAction() {
  const r = await act((actor) => runJobsNow(actor));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
