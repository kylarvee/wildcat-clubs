"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import { getCurrentUser } from "@/lib/auth/session";
import * as profiles from "@/lib/domain/profiles";
import type { YearMonth } from "@/lib/profiles/linkedin";

/** Settings and the person's profile page show the same rows; refresh both. */
async function refresh(everywhere = false) {
  const me = await getCurrentUser();
  revalidatePath("/settings", "layout");
  if (me) revalidatePath(`/u/${me.handle}`);
  // Name and photo appear in the header on every page.
  if (everywhere) revalidatePath("/", "layout");
}

export async function updateProfileAction(input: profiles.ProfileInput) {
  const r = await act(async (actor) => {
    const u = await profiles.updateProfile(actor, input);
    return { handle: u.handle };
  });
  if (r.ok) await refresh(true);
  return r;
}

export type ExperienceForm = { title: string; organization: string; location: string; startDate: string; endDate: string; description: string };

export async function addExperienceAction(input: ExperienceForm) {
  const r = await act(async (actor) => {
    await profiles.addExperience(actor, input);
  });
  if (r.ok) await refresh();
  return r;
}

export async function updateExperienceAction(id: string, input: ExperienceForm) {
  const r = await act(async (actor) => {
    await profiles.updateExperience(actor, id, input);
  });
  if (r.ok) await refresh();
  return r;
}

export async function deleteExperienceAction(id: string) {
  const r = await act((actor) => profiles.deleteExperience(actor, id));
  if (r.ok) await refresh();
  return r;
}

export type ImportPosition = { company: string; title: string; description: string; location: string; startedOn: YearMonth; finishedOn: YearMonth | null };

export async function importLinkedInAction(positions: ImportPosition[]) {
  const r = await act((actor) => profiles.importLinkedInPositions(actor, { positions }));
  if (r.ok) await refresh();
  return r;
}

export type EducationForm = { school: string; degree: string; field: string; startYear: string; endYear: string; description: string };

export async function addEducationAction(input: EducationForm) {
  const r = await act(async (actor) => {
    await profiles.addEducation(actor, input);
  });
  if (r.ok) await refresh();
  return r;
}

export async function updateEducationAction(id: string, input: EducationForm) {
  const r = await act(async (actor) => {
    await profiles.updateEducation(actor, id, input);
  });
  if (r.ok) await refresh();
  return r;
}

export async function deleteEducationAction(id: string) {
  const r = await act((actor) => profiles.deleteEducation(actor, id));
  if (r.ok) await refresh();
  return r;
}

export type ProjectForm = { title: string; descriptionHtml: string; url: string; startDate: string; endDate: string; roleAssignmentId: string; fileIds: string[] };

export async function addProjectAction(input: ProjectForm) {
  const r = await act(async (actor) => {
    const res = await profiles.addProject(actor, input);
    return { skippedFiles: res.skippedFiles };
  });
  if (r.ok) await refresh(true);
  return r;
}

export async function updateProjectAction(id: string, input: ProjectForm) {
  const r = await act(async (actor) => {
    const res = await profiles.updateProject(actor, id, input);
    return { skippedFiles: res.skippedFiles };
  });
  if (r.ok) await refresh(true);
  return r;
}

export async function deleteProjectAction(id: string) {
  const r = await act((actor) => profiles.deleteProject(actor, id));
  // Role contributions also show on club history pages.
  if (r.ok) await refresh(true);
  return r;
}

export async function setEmailNotificationsAction(on: boolean) {
  const r = await act(async (actor) => {
    await profiles.updateNotificationSettings(actor, { emailNotifications: on });
  });
  if (r.ok) await refresh();
  return r;
}

export async function markGraduatedAction(graduatedAt: string) {
  const r = await act((actor) => profiles.markGraduated(actor, { graduatedAt }));
  // Roles, memberships and org charts changed across clubs.
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
