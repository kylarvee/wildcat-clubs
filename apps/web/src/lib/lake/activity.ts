import "server-only";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { isPublicByDefault } from "@/lib/lake/actions";

/**
 * The activity stream. Every domain write appends one row, so the data lake
 * records not just the current state but how it got there. Profiles and club
 * pages show rows with isPublic = true; admins and analytics read the rest.
 *
 * Every action has one entry in lib/lake/actions (its label, feed phrase and
 * whether it's public by default); actions.test.ts fails on any that doesn't.
 * Never put anonymous-complaint details or reporter ids here.
 */
export type ActivityInput = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  clubId?: string | null;
  data?: Prisma.InputJsonValue;
  /** Leave out to use the action's default from lib/lake/actions. */
  isPublic?: boolean;
};

export async function logActivity(input: ActivityInput, tx: Tx = db) {
  await tx.activityLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      clubId: input.clubId ?? null,
      data: input.data,
      isPublic: input.isPublic ?? isPublicByDefault(input.action),
    },
  });
}
