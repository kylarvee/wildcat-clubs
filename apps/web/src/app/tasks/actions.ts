"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import * as tasks from "@/lib/domain/tasks";

/**
 * Task Manager actions, shared by /tasks and the dashboard widget. The open
 * count sits in the header on every page, so changes refresh the whole layout.
 */

function refresh() {
  revalidatePath("/", "layout");
}

export type PersonalTaskForm = { title: string; description: string; dueAt: string };

export async function addPersonalTaskAction(input: PersonalTaskForm) {
  const r = await act(async (actor) => {
    const t = await tasks.addPersonalTask(actor, input);
    return { id: t.id };
  });
  if (r.ok) refresh();
  return r;
}

export async function updatePersonalTaskAction(taskId: string, input: PersonalTaskForm) {
  const r = await act(async (actor) => {
    await tasks.updatePersonalTask(actor, taskId, input);
  });
  if (r.ok) refresh();
  return r;
}

export async function setTaskDoneAction(taskId: string, done: boolean) {
  const r = await act(async (actor) => {
    await tasks.setTaskDone(actor, taskId, done);
  });
  if (r.ok) refresh();
  return r;
}

export async function deletePersonalTaskAction(taskId: string) {
  const r = await act((actor) => tasks.deletePersonalTask(actor, taskId));
  if (r.ok) refresh();
  return r;
}

export type AssignTaskForm = { clubId: string; assignee: string | { capability: string }; title: string; description: string; dueAt: string };

export async function assignClubTaskAction(input: AssignTaskForm) {
  const r = await act(async (actor) => {
    const { task, assigneeLabel } = await tasks.assignClubTask(actor, input);
    return { id: task.id, assigneeLabel };
  });
  if (r.ok) refresh();
  return r;
}

/** People a leader can hand a task to in one club (loaded when the club is picked). */
export async function assignableMembersAction(clubId: string) {
  return act((actor) => tasks.assignableMembers(actor, clubId));
}

export async function cancelClubTaskAction(taskId: string) {
  const r = await act((actor) => tasks.cancelClubTask(actor, taskId));
  if (r.ok) refresh();
  return r;
}
