import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/session";
import { getConfig } from "@/lib/config";
import { reviewEligibility } from "@/lib/metrics";
import { logActivity } from "@/lib/lake/activity";
import { assertCan, assertSignedIn, conflict, forbidden, invalid, notFound, parse } from "@/lib/domain/kit";
import { createTask, resolveTasks } from "@/lib/domain/tasks";
import { notify, notifyAdmins } from "@/lib/domain/notify";
import { reindexClubSoon } from "@/lib/search/fresh";

/**
 * Reviews — the one input tool is the review form on the club page.
 *
 * Rules (ARCHITECTURE §6 "Review bombing"):
 *  - Only signed-in, active students who attended `reviews.minAttendance` of
 *    the club's events may review (uniform; sysadmin-set).
 *  - One review per person per club; writing again updates it.
 *  - `reviews.bombingCount` ratings ≤ `reviews.bombingMaxRating` inside
 *    `reviews.bombingWindowHours` opens one admin task per club.
 *  - Anyone signed in may flag a review once; at `reviews.flagThreshold` flags
 *    an admin task opens. Admins act from the admin tool through the
 *    moderation functions below, which close those tasks.
 */


const ReviewInput = z.object({
  rating: z.coerce.number().int("Pick a whole number of stars.").min(1, "Pick a rating from 1 to 5 stars.").max(5, "Pick a rating from 1 to 5 stars."),
  body: z
    .string()
    .max(2000, "Keep your review under 2,000 characters.")
    .optional()
    .nullable()
    .transform((v) => v?.trim() || null),
});

export type ReviewInput = z.input<typeof ReviewInput>;

export async function writeReview(actor: Actor | null, clubId: string, input: unknown) {
  assertSignedIn(actor);
  if (actor.kind !== "STUDENT") throw forbidden("Reviews come from students who attend the club's events.");
  if (actor.status !== "ACTIVE") throw forbidden("Alumni accounts can't write new reviews.");
  const data = parse(ReviewInput, input);

  const club = await db.club.findUnique({ where: { id: clubId }, select: { id: true, name: true, slug: true, status: true } });
  if (!club) throw notFound("Club");
  if (club.status !== "APPROVED") throw invalid("Reviews are open only for active clubs.");

  const gate = await reviewEligibility(actor.id, clubId);
  if (!gate.eligible) {
    const left = Math.max(1, gate.required - gate.attended);
    throw forbidden(`Attend ${left} more ${left === 1 ? "event" : "events"} to review ${club.name}.`);
  }

  const existing = await db.review.findUnique({ where: { clubId_userId: { clubId, userId: actor.id } }, select: { id: true } });
  // Editing keeps any moderation in place: a hidden review stays hidden.
  const review = await db.review.upsert({
    where: { clubId_userId: { clubId, userId: actor.id } },
    create: { clubId, userId: actor.id, rating: data.rating, body: data.body },
    update: { rating: data.rating, body: data.body },
  });
  await logActivity({
    actorId: actor.id,
    action: existing ? "review.updated" : "review.created",
    entityType: "review",
    entityId: review.id,
    clubId,
    data: { rating: data.rating },
    isPublic: true,
  });
  // Review text is searchable (lib/search) unless it's hidden or reported.
  reindexClubSoon(clubId);

  const cfg = await getConfig();
  if (data.rating <= cfg["reviews.bombingMaxRating"]) await checkReviewBombing(club, actor.id);
  return { id: review.id, created: !existing };
}

/**
 * Possible review bombing: too many low ratings in a short window. Counts
 * reviews written or edited down inside the window (updatedAt covers both),
 * leaving out ones admins already hid.
 */
async function checkReviewBombing(club: { id: string; name: string }, actorId: string) {
  const cfg = await getConfig();
  const since = new Date(Date.now() - cfg["reviews.bombingWindowHours"] * 3_600_000);
  const low = await db.review.count({
    where: { clubId: club.id, hiddenAt: null, rating: { lte: cfg["reviews.bombingMaxRating"] }, updatedAt: { gte: since } },
  });
  if (low < cfg["reviews.bombingCount"]) return;
  const open = await db.task.count({ where: { sourceType: "reviewBombing", sourceId: club.id, status: "OPEN" } });
  if (open > 0) return;

  const href = `/admin/reviews?club=${club.id}`;
  const description = `${low} reviews of ${cfg["reviews.bombingMaxRating"]}★ or lower in the last ${cfg["reviews.bombingWindowHours"]} hours. Check whether they're genuine before deciding whether to hide any.`;
  await createTask({
    kind: "APPROVAL",
    title: `Possible review bombing: ${club.name}`,
    description,
    assignee: { type: "ADMINS" },
    clubId: club.id,
    href,
    source: { type: "reviewBombing", id: club.id },
  });
  await notifyAdmins({ kind: "review.bombing", title: `Possible review bombing: ${club.name}`, body: description, href, exceptUserId: actorId });
  await logActivity({ actorId: null, action: "review.bombing_flagged", entityType: "club", entityId: club.id, clubId: club.id, data: { lowRatings: low } });
}

/** Delete your own review. (Admins moderate by hiding, from the admin tool.) */
export async function deleteReview(actor: Actor | null, reviewId: string) {
  assertSignedIn(actor);
  const review = await db.review.findUnique({ where: { id: reviewId }, select: { id: true, userId: true, clubId: true } });
  if (!review) throw notFound("Review");
  if (review.userId !== actor.id) throw forbidden("You can only delete your own review.");
  await db.review.delete({ where: { id: review.id } });
  // Nothing left to moderate.
  await resolveTasks("reviewFlag", review.id, actor.id, db, "CANCELLED");
  await logActivity({ actorId: actor.id, action: "review.deleted", entityType: "review", entityId: review.id, clubId: review.clubId });
  reindexClubSoon(review.clubId);
}

const FlagInput = z.object({
  reason: z.string().trim().min(3, "Tell us briefly what's wrong with this review.").max(500, "Keep the reason under 500 characters."),
});

/** Report a review to WSUSA admins. One flag per person; enough flags opens an admin task. */
export async function flagReview(actor: Actor | null, reviewId: string, input: unknown) {
  assertSignedIn(actor);
  const { reason } = parse(FlagInput, input);
  const review = await db.review.findUnique({
    where: { id: reviewId },
    select: { id: true, userId: true, clubId: true, hiddenAt: true, club: { select: { name: true, status: true } } },
  });
  if (!review || (review.club.status !== "APPROVED" && review.club.status !== "RETIRED")) throw notFound("Review");
  if (review.userId === actor.id) throw invalid("You can't flag your own review — edit or delete it instead.");
  if (review.hiddenAt) throw conflict("Admins have already hidden this review.");

  const already = await db.reviewFlag.findUnique({ where: { reviewId_userId: { reviewId, userId: actor.id } }, select: { id: true } });
  if (already) throw conflict("You've already flagged this review. Admins will take a look.");
  await db.reviewFlag.create({ data: { reviewId, userId: actor.id, reason } });
  await logActivity({ actorId: actor.id, action: "review.flagged", entityType: "review", entityId: reviewId, clubId: review.clubId });
  // A reported review leaves search until admins keep it.
  reindexClubSoon(review.clubId);

  const flags = await db.reviewFlag.count({ where: { reviewId } });
  if (flags >= (await getConfig())["reviews.flagThreshold"]) {
    const open = await db.task.count({ where: { sourceType: "reviewFlag", sourceId: reviewId, status: "OPEN" } });
    if (open === 0) {
      const href = `/admin/reviews?club=${review.clubId}&review=${reviewId}`;
      await createTask({
        kind: "APPROVAL",
        title: `Review flagged on ${review.club.name}`,
        description: `${flags} people flagged this review. Decide whether to keep or hide it.`,
        assignee: { type: "ADMINS" },
        clubId: review.clubId,
        href,
        source: { type: "reviewFlag", id: reviewId },
        createdById: actor.id,
      });
      await notifyAdmins({ kind: "review.flagged", title: `A review on ${review.club.name} was flagged`, body: `${flags} people flagged it.`, href, exceptUserId: actor.id });
    }
  }
}

// ─── Moderation (admin tool) ─────────────────────────────────────────────────

const HideInput = z.object({
  reason: z.string().trim().min(3, "Give the reviewer a short reason.").max(300, "Keep the reason under 300 characters."),
});

/** Hide a review (admins). The author sees it was hidden and why; everyone else stops seeing it. */
export async function hideReview(actor: Actor | null, reviewId: string, input: unknown) {
  assertCan(actor, "admin.reviews");
  const { reason } = parse(HideInput, input);
  const review = await db.review.findUnique({ where: { id: reviewId }, select: { id: true, userId: true, clubId: true, hiddenAt: true, club: { select: { name: true, slug: true } } } });
  if (!review) throw notFound("Review");
  if (review.hiddenAt) throw conflict("This review is already hidden.");
  await db.review.update({ where: { id: reviewId }, data: { hiddenAt: new Date(), hiddenReason: reason } });
  await resolveTasks("reviewFlag", reviewId, actor.id);
  await logActivity({ actorId: actor.id, action: "review.hidden", entityType: "review", entityId: reviewId, clubId: review.clubId, data: { reason } });
  reindexClubSoon(review.clubId);
  await notify({
    userIds: [review.userId],
    kind: "review.hidden",
    title: `Your review of ${review.club.name} was hidden`,
    body: `WSUSA admins hid it: ${reason}`,
    href: `/clubs/${review.club.slug}#reviews`,
  });
}

/** Undo a hide (admins). */
export async function restoreReview(actor: Actor | null, reviewId: string) {
  assertCan(actor, "admin.reviews");
  const review = await db.review.findUnique({ where: { id: reviewId }, select: { id: true, clubId: true, hiddenAt: true } });
  if (!review) throw notFound("Review");
  if (!review.hiddenAt) throw conflict("This review isn't hidden.");
  await db.review.update({ where: { id: reviewId }, data: { hiddenAt: null, hiddenReason: null } });
  await logActivity({ actorId: actor.id, action: "review.restored", entityType: "review", entityId: reviewId, clubId: review.clubId });
  reindexClubSoon(review.clubId);
}

/** Admins looked at a reported review and it stays up: clears its reports and closes the task. */
export async function keepReportedReview(actor: Actor | null, reviewId: string) {
  assertCan(actor, "admin.reviews");
  const review = await db.review.findUnique({ where: { id: reviewId }, select: { id: true, clubId: true } });
  if (!review) throw notFound("Review");
  await db.reviewFlag.deleteMany({ where: { reviewId } });
  await resolveTasks("reviewFlag", reviewId, actor.id);
  await logActivity({ actorId: actor.id, action: "review.reports_cleared", entityType: "review", entityId: reviewId, clubId: review.clubId });
  reindexClubSoon(review.clubId);
}

/** Admins finished checking a club for review bombing (whether or not they hid anything). */
export async function closeReviewBombingCheck(actor: Actor | null, clubId: string) {
  assertCan(actor, "admin.reviews");
  await resolveTasks("reviewBombing", clubId, actor.id);
  await logActivity({ actorId: actor.id, action: "review.bombing_reviewed", entityType: "club", entityId: clubId, clubId });
}

