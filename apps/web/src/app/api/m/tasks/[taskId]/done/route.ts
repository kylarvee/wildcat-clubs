import { revalidatePath } from "next/cache";
import { mobile, mobileActor, preflight, readJson } from "../../../_lib/http";
import { setTaskDoneView } from "../../../_lib/tasks";
import type { MTaskDoneResponse } from "../../../_types";

/**
 * POST /api/m/tasks/[taskId]/done { done } → MTaskDoneResponse. The
 * checkbox on a personal or club to-do (lib/domain/tasks setTaskDone, the
 * web's call: tasks that close on their own can't be checked off, and the
 * leader who assigned a club task hears it's done).
 */
export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return mobile(async (): Promise<MTaskDoneResponse> => {
    const r = await setTaskDoneView(await mobileActor(req), decodeURIComponent(taskId), await readJson(req));
    // The open count sits in the web header on every page.
    revalidatePath("/", "layout");
    return r;
  });
}

export const OPTIONS = preflight;
