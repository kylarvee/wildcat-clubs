import { randomBytes } from "node:crypto";
import { CLUB_REVIVAL, COFOUNDER_INVITE, cofounderInviteHref, isFounding, revivalHref } from "@/lib/founding/rules";
import type { ClubM, Ctx, Person } from "../ctx";
import { addDays, addHours, minDate } from "../lib/dates";
import { generatedStudents } from "./people";

/**
 * Founding stories (PERSONAS: Frank, Sam, Alex), recorded the way the app
 * writes them (lib/domain/cofounders, clubs):
 *  - Frank's Wildcat Beekeeping Society (DRAFT): its first founding friend
 *    joined by accepting a co-founder invitation and sits in the Vice
 *    President seat (steps/roles foundingRoles); Sam has an invitation
 *    waiting (a task, a bell and the email); it's listed as forming, with six
 *    followers.
 *  - Frank's Wildcat Puzzle Society (SUBMITTED): listed as forming, with four
 *    followers (Maya isn't one, so she can follow it and hear when Alex
 *    approves it).
 *  - Photographic Society (retired, WSUSA's): an invented student asked to
 *    bring it back, in WSUSA's queue.
 * Uses no randomness (picks go in a fixed order), so nothing else shifts.
 */

const token = () => randomBytes(32).toString("base64url");

/** Active invented students with time left at Weber State, in a fixed order. */
function students(ctx: Ctx, keep: (p: Person) => boolean) {
  return generatedStudents(ctx).filter((p) => p.status === "ACTIVE" && (p.gradDate ?? ctx.NOW) > addDays(ctx.NOW, 200) && keep(p));
}

function follow(ctx: Ctx, club: ClubM, people: Person[], daysAgo: (i: number) => number) {
  people.forEach((p, i) => ctx.rows.subscriptions.push({ userId: p.id, clubId: club.id, createdAt: addDays(ctx.NOW, -daysAgo(i)) }));
}

export function buildFoundingStories(ctx: Ctx) {
  const { NOW } = ctx;
  const frank = ctx.p("frank");
  const sam = ctx.p("sam");

  // The founding team follows its own club's calendar, as the app does when founders join (roles.grantRole, cofounders accept).
  for (const club of ctx.clubs.filter((c) => isFounding(c.status))) {
    for (const m of club.members) if (m.status === "ACTIVE" && m.joinedAt) ctx.rows.subscriptions.push({ userId: m.userId, clubId: club.id, createdAt: m.joinedAt });
  }

  // ─── Beekeeping: a co-founder in the VP seat, Sam invited, listed as forming ──
  const bee = ctx.club("beekeeping");
  bee.listedAsForming = true;
  ctx.activity({ at: addHours(bee.createdAt, 1), actorId: frank.id, action: "club.forming_set", entityType: "club", entityId: bee.id, clubId: bee.id, data: { on: true } });

  const friend = bee.members.find((m) => m.source === "FOUNDER" && m.userId !== bee.founderId);
  if (friend?.joinedAt) {
    const p = ctx.person(friend.userId);
    const sentAt = minDate(addHours(bee.createdAt, 2), friend.joinedAt);
    const invite = { id: ctx.id(), clubId: bee.id, name: p.name, email: p.email, token: token(), status: "ACCEPTED" as const, invitedById: frank.id, inviteeId: p.id, createdAt: sentAt, respondedAt: friend.joinedAt };
    ctx.rows.cofounderInvites.push(invite);
    ctx.refs.beeCofounderId = p.id;
    ctx.activity({ at: sentAt, actorId: frank.id, action: "cofounder.invited", entityType: "cofounderInvite", entityId: invite.id, clubId: bee.id, data: { name: p.name } });
    ctx.activity({ at: friend.joinedAt, actorId: p.id, action: "cofounder.accepted", entityType: "cofounderInvite", entityId: invite.id, clubId: bee.id });
    ctx.rows.tasks.push({
      id: ctx.id(), kind: "APPROVAL", title: `Frank Okafor invited you to help start ${bee.name}`, assigneeType: "USER", assigneeId: p.id, clubId: bee.id,
      href: cofounderInviteHref(invite.token), status: "DONE", sourceType: COFOUNDER_INVITE, sourceId: invite.id, createdById: frank.id, createdAt: sentAt, completedAt: friend.joinedAt, completedById: p.id,
    });
    ctx.rows.notifications.push({
      id: ctx.id(), userId: frank.id, kind: "cofounder.accepted", title: `${p.name} joined ${bee.name}'s founding team`, body: "Give them a seat on your org chart, like Vice President or Treasurer.",
      href: `/clubs/${bee.slug}/manage/org-chart`, createdAt: friend.joinedAt, readAt: addHours(friend.joinedAt, 2),
    });
  }

  const sentToSam = addDays(NOW, -1.1);
  const samInvite = { id: ctx.id(), clubId: bee.id, name: sam.name, email: sam.email, token: token(), status: "PENDING" as const, invitedById: frank.id, inviteeId: sam.id, createdAt: sentToSam, respondedAt: null };
  ctx.rows.cofounderInvites.push(samInvite);
  ctx.refs.samCofounderInviteId = samInvite.id;
  const href = cofounderInviteHref(samInvite.token);
  const title = `Frank Okafor invited you to help start ${bee.name}`;
  ctx.activity({ at: sentToSam, actorId: frank.id, action: "cofounder.invited", entityType: "cofounderInvite", entityId: samInvite.id, clubId: bee.id, data: { name: sam.name } });
  ctx.rows.tasks.push({
    id: ctx.id(), kind: "APPROVAL", title, description: "Accept to join the founding team. A founder can then give you a seat on the club's org chart before it's approved.",
    assigneeType: "USER", assigneeId: sam.id, clubId: bee.id, href, status: "OPEN", sourceType: COFOUNDER_INVITE, sourceId: samInvite.id, createdById: frank.id, createdAt: sentToSam,
  });
  ctx.rows.notifications.push({ id: ctx.id(), userId: sam.id, kind: "cofounder.invited", title, body: "Open the invitation to accept or decline.", href, createdAt: sentToSam, readAt: null });
  // The registry emails this kind, and Sam keeps the defaults.
  ctx.rows.outbox.push({ id: ctx.id(), channel: "EMAIL", to: sam.email, subject: title, body: "Open the invitation to accept or decline.", href, status: "MOCKED", error: null, kind: "cofounder.invited", createdAt: sentToSam, sentAt: sentToSam });

  const beeFollowers = students(ctx, (p) => p.collegeKey === "cos" && !bee.byUser.has(p.id)).slice(0, 6);
  follow(ctx, bee, beeFollowers, (i) => 0.4 + i * 1.1);

  // ─── Wildcat Puzzle Society: in review, listed as forming ──────────────────
  const puzzle = ctx.club("boardgames");
  puzzle.listedAsForming = true;
  ctx.activity({ at: addDays(puzzle.createdAt, 2.1), actorId: puzzle.founderId, action: "club.forming_set", entityType: "club", entityId: puzzle.id, clubId: puzzle.id, data: { on: true } });
  const taken = new Set(beeFollowers.map((p) => p.id));
  follow(ctx, puzzle, students(ctx, (p) => !taken.has(p.id) && !puzzle.byUser.has(p.id) && p.collegeKey !== "cos").slice(0, 4), (i) => 2.3 + i * 3.4);

  // ─── A retired club someone wants back: in WSUSA's queue ───────────────────
  const photo = ctx.club("photo");
  const asker = students(ctx, (p) => p.collegeKey === "arts" && !photo.byUser.has(p.id))[0];
  if (asker) {
    const askedAt = addDays(NOW, -2.2);
    const note = "A few of us in photography classes want to restart photo walks and a spring show. I'd be glad to lead it as President.";
    const revivalTitle = `${asker.name} asked to bring back ${photo.name}`;
    ctx.rows.tasks.push({
      id: ctx.id(), kind: "APPROVAL", title: revivalTitle, description: note, assigneeType: "ADMINS", clubId: photo.id, href: revivalHref(photo.id),
      status: "OPEN", sourceType: CLUB_REVIVAL, sourceId: photo.id, createdById: asker.id, createdAt: askedAt,
    });
    ctx.activity({ at: askedAt, actorId: asker.id, action: "club.revival_requested", entityType: "club", entityId: photo.id, clubId: photo.id, data: { note } });
    // notifyOffice: WSUSA's staff are the platform admins (their email waits for the daily digest).
    for (const admin of ctx.admins) {
      ctx.rows.notifications.push({ id: ctx.id(), userId: admin.id, kind: "club.revival_requested", title: revivalTitle, body: note, href: revivalHref(photo.id), createdAt: askedAt, readAt: null });
    }
    ctx.refs.revivalAsker = asker.name;
  }
}
