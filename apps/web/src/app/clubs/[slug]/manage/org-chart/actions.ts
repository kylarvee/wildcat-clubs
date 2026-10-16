"use server";

import { revalidatePath } from "next/cache";
import type { RoleEndReason } from "@prisma/client";
import { act } from "@/lib/domain/kit";
import * as roles from "@/lib/domain/roles";
import * as orgchart from "@/lib/domain/orgchart";

/** Org chart changes show up on the club page, history and every workspace tab. */
function refresh(slug: string) {
  revalidatePath(`/clubs/${slug}`, "layout");
}

export async function assignToSeat(slug: string, input: { clubId: string; userId: string; positionId: string; permissions?: string[]; replaceAssignmentIds?: string[] }) {
  const r = await act(async (actor) => {
    await roles.assignRole(actor, input);
  });
  refresh(slug);
  return r;
}

export async function updatePermissions(slug: string, assignmentId: string, permissions: string[]) {
  const r = await act((actor) => roles.setRolePermissions(actor, assignmentId, permissions));
  refresh(slug);
  return r;
}

export async function endRole(slug: string, assignmentId: string, reason: RoleEndReason, note?: string) {
  const r = await act(async (actor) => {
    await roles.endRoleAssignment(actor, assignmentId, reason, note);
  });
  refresh(slug);
  return r;
}

export async function handOff(slug: string, clubId: string, input: { successorId: string; becomeAlumni: boolean; outgoingAssignmentId?: string | null }) {
  const r = await act(async (actor) => {
    const res = await roles.handOffPresidency(actor, clubId, input);
    return { actorStillLeads: res.actorStillLeads };
  });
  refresh(slug);
  return r;
}

export async function createSeat(slug: string, input: { clubId: string; name: string; role: "OFFICER" | "AMBASSADOR"; responsibilities: string[]; defaultPermissions: string[]; maxHolders: number }) {
  const r = await act(async (actor) => {
    await orgchart.createSeat(actor, input);
  });
  refresh(slug);
  return r;
}

export async function updateSeat(slug: string, seatId: string, input: { name?: string; responsibilities?: string[]; defaultPermissions?: string[]; maxHolders?: number }) {
  const r = await act(async (actor) => {
    await orgchart.updateSeat(actor, seatId, input);
  });
  refresh(slug);
  return r;
}

export async function moveSeat(slug: string, seatId: string, direction: "up" | "down") {
  const r = await act((actor) => orgchart.moveSeat(actor, seatId, direction));
  refresh(slug);
  return r;
}

export async function archiveSeat(slug: string, seatId: string) {
  const r = await act(async (actor) => {
    await orgchart.archiveSeat(actor, seatId);
  });
  refresh(slug);
  return r;
}

export async function restoreSeat(slug: string, seatId: string) {
  const r = await act(async (actor) => {
    await orgchart.restoreSeat(actor, seatId);
  });
  refresh(slug);
  return r;
}

export async function startDefaults(slug: string, clubId: string) {
  const r = await act((actor) => orgchart.startDefaultSeats(actor, clubId));
  refresh(slug);
  return r;
}

export async function restoreDefaults(slug: string, clubId: string) {
  const r = await act((actor) => orgchart.restoreDefaultSeats(actor, clubId));
  refresh(slug);
  return r;
}
