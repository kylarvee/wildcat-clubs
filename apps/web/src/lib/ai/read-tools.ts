import "server-only";
import { z } from "zod";
import type { PolicyPlacement } from "@prisma/client";
import { db } from "@/lib/db";
import { ALL_CAPABILITIES, CAPABILITIES, getClubAccess, isAdmin, ROLE_LABEL, ROLE_RANK } from "@/lib/authz";
import { requirementStatus } from "@/lib/authz/requirements";
import { listClubs, clubUpcomingEvents, type ClubListItem } from "@/lib/clubs/queries";
import { clubListHref, SORT_DEFAULT_DIR, type ClubListParams } from "@/components/clubs/list-params";
import { CLUB_TYPE_LABEL, JOIN_POLICY_LABEL } from "@/components/clubs/labels";
import { clubActivity, clubActivityMany, clubListMetrics, memberClubSummaries, reviewEligibility } from "@/lib/metrics";
import { feedOccurrences, viewerContext } from "@/lib/events/feed";
import { canManageEvent, canSeeEventCosts, canViewEvent, eventCostSummary } from "@/lib/domain/events";
import { foundingChecklist } from "@/lib/domain/clubs";
import { listTasks } from "@/lib/domain/tasks";
import { orgChartData } from "@/lib/roles/queries";
import { SUCCESSION_LABEL } from "@/lib/roles/labels";
import { loadPersonAttendance } from "@/lib/attendance/queries";
import { richToText } from "@/lib/rich/sanitize";
import { KIND_LABEL, VISIBILITY_LABEL, locationText } from "@/lib/events/labels";
import { describeSchedule } from "@/lib/events/summary";
import { currentOrLastTerm, getTerms } from "@/lib/terms";
import { fmtDate, fmtMoney, fmtRange } from "@/lib/time";
import { readTool, percent, quote, type ToolCtx } from "@/lib/ai/tool-kit";
import { resolveClub, resolveCollege, ToolError } from "@/lib/ai/resolve";

/**
 * Read tools: they run as soon as the model calls them and only return what
 * the signed-in person may see (lib/authz decides; lib/metrics supplies every
 * number). No tool here touches complaints, ballots or other people's
 * attendance.
 */

const clubRef = z.string().min(1).max(160).describe("The club's name (or part of it) or its URL slug, e.g. \"Chess Club\" or \"wildcat-robotics\"");

const CLUB_STATUS_TEXT: Record<string, string> = {
  DRAFT: "founding draft (not yet submitted)",
  SUBMITTED: "submitted — waiting for WSUSA review",
  CHANGES_REQUESTED: "WSUSA asked for changes",
  APPROVED: "approved",
  REJECTED: "not approved by WSUSA",
  RETIRED: "retired (archived)",
};

function clubStatusText(item: Pick<ClubListItem, "status" | "hasMetrics" | "metrics">) {
  if (item.status === "RETIRED") return "retired (archived)";
  if (!item.hasMetrics) return "no activity data yet";
  if (item.metrics.inPilot) return "active (pilot period)";
  return item.metrics.isActive ? "active" : "not active right now";
}

function ratingText(avg: number | null, count: number) {
  return avg == null || count === 0 ? "no reviews yet" : `${avg.toFixed(1)} of 5 from ${count} review${count === 1 ? "" : "s"}`;
}

function relationship(s: { member: boolean; pending: boolean; subscribed: boolean; leader: boolean } | undefined) {
  if (!s) return null;
  if (s.leader) return "you're a leader here";
  if (s.member) return "you're a member";
  if (s.pending) return "your join request is pending";
  if (s.subscribed) return "you follow its calendar";
  return null;
}

const STOP_WORDS = new Set(["club", "clubs", "about", "the", "and", "for", "with", "a", "an", "of", "in", "on", "at", "to", "society", "group"]);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ─── search_clubs ───────────────────────────────────────────────────────────

const searchClubs = readTool({
  name: "search_clubs",
  running: "Searching clubs",
  description:
    "Search Weber State's clubs (the public clubs list). Returns each club's name, link, type, college, focus, short description, whether joining is open or needs approval, activity status, members, rating, retention and the person's relationship to it. Use it for \"find clubs about X\", comparisons and browsing.",
  schema: z.object({
    query: z.string().max(100).optional().describe("Keywords matched against names, descriptions, majors, colleges and departments, e.g. \"AI\", \"chess\", \"nursing\". Leave out to browse."),
    type: z.enum(["SPONSORED", "AFFILIATE", "REGISTERED", "COLLEGE_AMBASSADORS"]).optional(),
    category: z.enum(["ACADEMIC", "CULTURAL", "FSL", "HONOR_SOCIETY", "SERVICE_ADVOCACY", "STUDENT_LIFE", "RELIGIOUS"]).optional().describe("WSUSA's club category: academic, cultural, fraternity & sorority life, honor society, service & advocacy, student life & special interest, or religious"),
    status: z.enum(["active", "pilot", "inactive"]).optional().describe("active = counts as active (includes pilot clubs); pilot = new clubs in their pilot period; inactive = not active right now"),
    college: z.string().max(120).optional().describe("Only clubs in this college (name or short name)"),
    sort: z.enum(["name", "rating", "members", "retention", "activity"]).optional().describe("Default: name"),
    limit: z.number().int().min(1).max(20).optional().describe("How many to return (default 8)"),
    archived: z.boolean().optional().describe("Search retired clubs instead of current ones"),
  }),
  async run({ actor }, input) {
    const college = input.college ? await resolveCollege(input.college) : null;
    const sort = input.sort ?? "name";
    const params: ClubListParams = {
      q: "",
      type: input.type ?? null,
      category: input.category ?? null,
      college: college?.slug ?? null,
      scope: null,
      status: input.status ?? null,
      mine: false,
      archived: Boolean(input.archived),
      sort,
      dir: SORT_DEFAULT_DIR[sort],
      view: "grid",
    };
    const q = (input.query ?? "").trim();
    let result = await listClubs({ ...params, q }, actor);
    let items = result.items;
    let matched = "every word";
    if (q && items.length === 0) {
      // The clubs list needs every word to match; fall back to any word, best matches first.
      const words = q.split(/\s+/).filter((w) => w.length >= 2 && !STOP_WORDS.has(w.toLowerCase()));
      if (words.length) {
        result = await listClubs(params, actor);
        const scored = result.items
          .map((c) => {
            const hay = [c.name, c.shortDescription, c.focus, c.college?.name, c.college?.shortName, c.departmentName, c.placement].filter(Boolean).join(" ");
            return { c, score: words.filter((w) => new RegExp(`\\b${esc(w)}`, "i").test(hay)).length };
          })
          .filter((x) => x.score > 0);
        scored.sort((a, b) => b.score - a.score);
        items = scored.map((x) => x.c);
        matched = "some of the words";
      }
    }
    if (q && !input.sort) {
      // Name matches read as the best answers.
      const inName = (c: ClubListItem) => (c.name.toLowerCase().includes(q.toLowerCase()) ? 0 : 1);
      items = [...items].sort((a, b) => inName(a) - inName(b));
    }
    const limit = input.limit ?? 8;
    const clubs = items.slice(0, limit).map((c) => ({
      name: c.name,
      link: `/clubs/${c.slug}`,
      type: CLUB_TYPE_LABEL[c.type],
      placement: c.placement,
      focus: c.focus,
      department: c.departmentName,
      about: c.shortDescription,
      joining: c.joinPolicy === "OPEN" ? "open — registering makes you a member right away" : "leaders approve new members",
      status: clubStatusText(c),
      active_members: c.metrics.activeMembers,
      registered_members: c.metrics.registeredMembers,
      rating: ratingText(c.metrics.avgRating, c.metrics.reviewCount),
      monthly_retention: percent(c.metrics.retentionRate),
      you: relationship(result.states.get(c.id)),
    }));
    return {
      data: {
        found: items.length,
        showing: clubs.length,
        ...(q ? { matched } : {}),
        clubs,
        see_all_link: clubListHref({ ...params, q: matched === "every word" ? q : "" }),
      },
      label: q ? `Searched clubs for ${quote(q, 40)}` : "Browsed the clubs list",
    };
  },
});

// ─── get_club ───────────────────────────────────────────────────────────────

const getClub = readTool({
  name: "get_club",
  running: "Looking up the club",
  description:
    "Everything about one club: profile, type, college, how joining works, succession method, stats (activity status with reasons, members, retention, rating), leaders and advisors, upcoming events this person can see, and the person's own relationship (member, role, calendar, review eligibility).",
  schema: z.object({ club: clubRef }),
  async run({ actor }, input) {
    const ref = await resolveClub(actor, input.club);
    const [club, access, sub, metrics, chart] = await Promise.all([
      db.club.findUniqueOrThrow({
        where: { id: ref.id },
        select: {
          name: true,
          slug: true,
          type: true,
          status: true,
          scope: true,
          shortDescription: true,
          descriptionHtml: true,
          joinPolicy: true,
          successionMethod: true,
          contactEmail: true,
          createdAt: true,
          approvedAt: true,
          retiredAt: true,
          retiredReason: true,
          focusOther: true,
          requestedDepartmentName: true,
          college: { select: { name: true } },
          department: { select: { name: true } },
          focusMajor: { select: { name: true } },
        },
      }),
      getClubAccess(actor, ref.id),
      db.calendarSubscription.findUnique({ where: { userId_clubId: { userId: actor.id, clubId: ref.id } } }),
      clubListMetrics([ref.id]).then((m) => m.get(ref.id) ?? null),
      orgChartData(ref.id),
    ]);
    const [activity, events, review] = await Promise.all([
      club.status === "APPROVED" ? clubActivity(ref.id) : Promise.resolve(null),
      clubUpcomingEvents(ref.id, actor, 6),
      club.status === "APPROVED" && actor.kind === "STUDENT" && actor.status === "ACTIVE" ? reviewEligibility(actor.id, ref.id) : Promise.resolve(null),
    ]);
    const leaders = chart.seats
      .filter((s) => s.holders.length)
      .map((s) => ({ seat: s.name, role: s.roleLabel, people: s.holders.map((h) => h.person.name + (h.internalTitle ? ` (${h.internalTitle})` : "")) }));
    return {
      data: {
        name: club.name,
        link: `/clubs/${club.slug}`,
        ...(access?.isLeader ? { workspace_link: `/clubs/${club.slug}/manage` } : {}),
        status: CLUB_STATUS_TEXT[club.status],
        type: CLUB_TYPE_LABEL[club.type],
        college: club.college?.name ?? null,
        placement: club.scope === "COLLEGE" ? (club.college?.name ?? "College") : { UNIVERSITY: "University-wide", INDEPENDENT: "Independent", SPORTS: "Sports", COLLEGE: "College" }[club.scope],
        department: club.department?.name ?? (club.requestedDepartmentName ? `${club.requestedDepartmentName} (requested; not on the list yet)` : null),
        focus: club.focusMajor?.name ?? club.focusOther ?? null,
        about: club.shortDescription,
        description: richToText(club.descriptionHtml, 1500) || null,
        joining: JOIN_POLICY_LABEL[club.joinPolicy],
        succession: SUCCESSION_LABEL[club.successionMethod],
        ...(access?.isLeader ? { club_email: club.contactEmail } : {}),
        started: fmtDate(club.createdAt, "MMM yyyy"),
        approved: club.approvedAt ? fmtDate(club.approvedAt, "MMM d, yyyy") : null,
        ...(club.retiredAt ? { retired: fmtDate(club.retiredAt, "MMM d, yyyy"), retired_reason: club.retiredReason } : {}),
        stats: metrics
          ? {
              active_members: metrics.activeMembers,
              registered_members: metrics.registeredMembers,
              rating: ratingText(metrics.avgRating, metrics.reviewCount),
              monthly_retention: percent(metrics.retentionRate),
              activity: activity
                ? {
                    status: activity.inPilot ? "active (pilot period)" : activity.active ? "active" : "not active right now",
                    pilot_ends: activity.pilotEndsAt ? fmtDate(activity.pilotEndsAt, "MMM d, yyyy") : null,
                    held_events_current_term: activity.heldEventsCurrentTerm,
                    held_events_previous_term: activity.heldEventsPreviousTerm,
                    current_term: activity.currentTermName ?? null,
                    previous_term: activity.previousTermName ?? null,
                    reasons: activity.reasons,
                  }
                : null,
            }
          : null,
        leaders,
        advisors: chart.advisors.map((p) => p.name),
        upcoming_events: events.map((e) => ({
          title: e.title,
          when: fmtRange(e.startsAt, e.endsAt, e.allDay),
          where: e.location,
          happening_now: e.happeningNow || undefined,
          hosted_by: e.host && e.host.id !== ref.id ? e.host.name : undefined,
          event_id: e.eventId,
          link: `/events/${e.eventId}?o=${e.occurrenceId}`,
        })),
        you: {
          relationship: access?.isMember ? (access.role === "MEMBER" ? "member" : ROLE_LABEL[access.role!]) : access?.isPendingMember ? "join request pending" : access?.viaPlatform ? "admin (not a member)" : "not a member",
          follows_calendar: Boolean(sub),
          ...(review ? { reviews: review.eligible ? "can review this club" : `attended ${review.attended} of the ${review.required} events needed to review` } : {}),
        },
      },
      label: `Looked up ${club.name}`,
    };
  },
});

// ─── my_clubs_and_roles ─────────────────────────────────────────────────────

const myClubsAndRoles = readTool({
  name: "my_clubs_and_roles",
  running: "Checking your clubs",
  description:
    "The person's clubs: memberships (and pending join requests), current roles with the club tools they can use, paused permissions, clubs they're founding, and calendars they follow without joining.",
  schema: z.object({}),
  async run({ actor }) {
    const [memberships, roles, subs] = await Promise.all([
      db.membership.findMany({
        where: { userId: actor.id, status: { in: ["ACTIVE", "PENDING"] } },
        select: { status: true, joinedAt: true, requestedAt: true, internalTitle: true, club: { select: { id: true, name: true, slug: true, status: true } } },
      }),
      db.roleAssignment.findMany({
        where: { userId: actor.id, endedAt: null },
        select: { role: true, startedAt: true, position: { select: { name: true } }, club: { select: { id: true, name: true, slug: true, status: true } } },
      }),
      db.calendarSubscription.findMany({ where: { userId: actor.id }, select: { club: { select: { id: true, name: true, slug: true } } } }),
    ]);
    const clubIds = [...new Set([...memberships.map((m) => m.club.id), ...roles.map((r) => r.club.id)])];
    const clubs = [];
    for (const id of clubIds) {
      const m = memberships.find((x) => x.club.id === id);
      const rs = roles.filter((r) => r.club.id === id);
      const club = m?.club ?? rs[0].club;
      const access = await getClubAccess(actor, id);
      const leader = rs.some((r) => ROLE_RANK[r.role] >= 1);
      clubs.push({
        club: club.name,
        link: leader ? `/clubs/${club.slug}/manage` : `/clubs/${club.slug}`,
        club_status: CLUB_STATUS_TEXT[club.status],
        membership: m ? (m.status === "ACTIVE" ? `member since ${m.joinedAt ? fmtDate(m.joinedAt, "MMM yyyy") : "recently"}` : "join request pending") : "no membership",
        internal_title: m?.internalTitle ?? undefined,
        roles: rs.map((r) => ({ seat: r.position?.name ?? ROLE_LABEL[r.role], role: ROLE_LABEL[r.role], since: fmtDate(r.startedAt, "MMM d, yyyy") })),
        ...(leader && access
          ? {
              club_tools: access.suspended ? [] : [...access.capabilities].map((c) => CAPABILITIES[c].label),
              permissions_paused: access.suspended || undefined,
              can_assign_roles: access.assignableRoles.map((r) => ROLE_LABEL[r]),
            }
          : {}),
      });
    }
    clubs.sort((a, b) => a.club.localeCompare(b.club));
    return {
      data: {
        platform_role: actor.platformRole === "SYSADMIN" ? "system administrator" : actor.platformRole === "ADMIN" ? "WSUSA administrator" : "regular user",
        clubs,
        follows_calendars_of: subs.filter((s) => !clubIds.includes(s.club.id)).map((s) => ({ club: s.club.name, link: `/clubs/${s.club.slug}` })),
      },
      label: "Checked your clubs and roles",
    };
  },
});

// ─── my_profile ─────────────────────────────────────────────────────────────

const myProfile = readTool({
  name: "my_profile",
  running: "Checking your profile",
  description:
    "The person's own profile: name, pronouns, headline, About text, majors, minors and class year (students) or title (faculty/staff), LinkedIn link, whether they have a photo, how many experience, education and project entries they have, and which basics are still empty. Use it before update_my_profile and when helping someone set up their account.",
  schema: z.object({}),
  async run({ actor }) {
    const u = await db.user.findUnique({
      where: { id: actor.id },
      select: {
        name: true,
        handle: true,
        kind: true,
        status: true,
        pronouns: true,
        headline: true,
        aboutHtml: true,
        jobTitle: true,
        classYear: true,
        linkedinUrl: true,
        avatarUrl: true,
        majors: { select: { isMinor: true, major: { select: { name: true } } }, orderBy: { major: { name: "asc" } } },
        _count: { select: { experiences: true, educations: true, projects: true } },
      },
    });
    if (!u) throw new ToolError("Their account wasn't found.");
    const student = u.kind === "STUDENT";
    const about = richToText(u.aboutHtml, 2000);
    const majors = u.majors.filter((m) => !m.isMinor).map((m) => m.major.name);
    const minors = u.majors.filter((m) => m.isMinor).map((m) => m.major.name);
    const empty = [
      !u.avatarUrl && "photo",
      !u.headline && "headline",
      !about && "about",
      ...(student ? [!majors.length && "majors", !u.classYear && "class year"] : [!u.jobTitle && "title"]),
      !u.linkedinUrl && "LinkedIn link",
      !u._count.experiences && "experience",
    ].filter((f): f is string => Boolean(f));
    return {
      data: {
        name: u.name,
        account: student ? "student" : "faculty/staff",
        ...(u.status === "ALUMNI" ? { note: "Alumni profile: retired and read-only." } : {}),
        profile_link: `/u/${u.handle}`,
        edit_link: "/settings",
        pronouns: u.pronouns,
        headline: u.headline,
        about: about || null,
        ...(student ? { majors, minors, class_year: u.classYear } : { title: u.jobTitle }),
        linkedin: u.linkedinUrl,
        has_photo: Boolean(u.avatarUrl),
        entries: { experience: u._count.experiences, education: u._count.educations, projects: u._count.projects },
        still_empty: empty,
      },
      label: "Checked your profile",
    };
  },
});

// ─── my_tasks ───────────────────────────────────────────────────────────────

const TASK_KIND: Record<string, string> = {
  PERSONAL: "personal to-do",
  CLUB: "club to-do",
  APPROVAL: "waiting on your decision",
  REQUIREMENT: "officer requirement",
  INVOICE: "invoice follow-up",
};

const myTasks = readTool({
  name: "my_tasks",
  running: "Checking your tasks",
  description: "The person's open tasks (their inbox): approvals waiting on them, officer requirements, invoices, club to-dos and personal to-dos, with due dates and links.",
  schema: z.object({ include_completed: z.boolean().optional().describe("Also list the 10 most recently completed tasks") }),
  async run({ actor, now }, input) {
    const [open, done] = await Promise.all([listTasks(actor, { status: "OPEN", take: 40 }), input.include_completed ? listTasks(actor, { status: "DONE", take: 10 }) : Promise.resolve([])]);
    const row = (t: (typeof open)[number]) => ({
      title: t.title,
      kind: TASK_KIND[t.kind] ?? t.kind.toLowerCase(),
      club: t.club?.name ?? null,
      due: t.dueAt ? fmtDate(t.dueAt, "EEE, MMM d, yyyy") : null,
      overdue: t.dueAt && t.dueAt < now && t.status === "OPEN" ? true : undefined,
      details: t.description ?? undefined,
      link: t.href ?? "/tasks",
    });
    return {
      data: { open_count: open.length, open: open.map(row), ...(input.include_completed ? { recently_completed: done.map(row) } : {}), tasks_page: "/tasks" },
      label: "Checked your tasks",
    };
  },
});

// ─── my_calendar ────────────────────────────────────────────────────────────

const myCalendar = readTool({
  name: "my_calendar",
  running: "Checking the calendar",
  description:
    "Upcoming events on the person's calendar (clubs they follow, plus university events if they keep those on) for the next N days, or one club's calendar when `club` is given. Includes events happening right now, cancellations, locations, event ids and links.",
  schema: z.object({
    days: z.number().int().min(1).max(60).optional().describe("How many days ahead (default 7)"),
    club: clubRef.optional().describe("Show this club's calendar instead of the person's own"),
  }),
  async run({ actor, now }, input) {
    const days = input.days ?? 7;
    const ctx = await viewerContext(actor);
    const club = input.club ? await resolveClub(actor, input.club) : null;
    const rows = await feedOccurrences(ctx, club ? { scope: "club", clubId: club.id } : { scope: "me" }, { start: now, end: new Date(now.getTime() + days * 86_400_000) }, { take: 60 });
    const events = rows.map((o) => ({
      title: o.event.title,
      host: o.event.club?.name ?? "Weber State (university event)",
      cohosts: o.event.cohosts.length ? o.event.cohosts.map((c) => c.club.name) : undefined,
      when: fmtRange(o.startsAt, o.endsAt, o.event.allDay),
      happening_now: o.startsAt <= now && now <= o.endsAt ? true : undefined,
      cancelled: o.status === "CANCELLED" || o.event.status === "CANCELLED" ? (o.note ? `cancelled — ${o.note}` : "cancelled") : undefined,
      where: locationText({ ...o.event, roomOverride: o.roomOverride }),
      visibility: VISIBILITY_LABEL[o.event.visibility],
      event_id: o.event.id,
      link: `/events/${o.event.id}?o=${o.id}`,
    }));
    return {
      data: {
        range: `${fmtDate(now, "EEE, MMM d")} – ${fmtDate(new Date(now.getTime() + days * 86_400_000), "EEE, MMM d")}`,
        ...(club
          ? { calendar_of: club.name }
          : { follows_club_calendars: ctx.subscribedClubIds.length, includes_university_events: ctx.subscribeUniversity, calendar_page: "/calendar" }),
        events,
        ...(events.length === 0 && !club && ctx.subscribedClubIds.length === 0 ? { hint: "They don't follow any club calendars yet — registering for a club or following its calendar adds its events." } : {}),
      },
      label: club ? `Checked ${club.name}'s calendar` : `Checked your calendar (next ${days} day${days === 1 ? "" : "s"})`,
    };
  },
});

// ─── my_attendance ──────────────────────────────────────────────────────────

const myAttendance = readTool({
  name: "my_attendance",
  running: "Checking your attendance",
  description:
    "The person's own attendance: per club, events attended, attendance rate since joining, last check-in, whether they count as active, and review eligibility; plus their most recent check-ins. Optionally for one club.",
  schema: z.object({ club: clubRef.optional().describe("Only this club") }),
  async run({ actor }, input) {
    const club = input.club ? await resolveClub(actor, input.club) : null;
    const [summaries, history] = await Promise.all([memberClubSummaries(actor.id), loadPersonAttendance(actor.id)]);
    const per = summaries
      .filter((s) => !club || s.club.id === club.id)
      .map((s) => ({
        club: s.club.name,
        link: `/clubs/${s.club.slug}`,
        membership: s.membershipStatus ? s.membershipStatus.toLowerCase() : "guest (not a member)",
        events_attended: s.summary.attended,
        held_since_joining: s.summary.heldSinceJoined,
        attendance_rate: s.membershipStatus ? percent(s.summary.rate) : null,
        last_check_in: s.summary.lastAttendedAt ? fmtDate(s.summary.lastAttendedAt, "MMM d, yyyy") : null,
        counts_as_active: s.summary.active,
        // Alumni and faculty/staff can't review, so don't tell them they're working toward one.
        reviews: !s.summary.canReview
          ? "not available for this account"
          : s.summary.reviewEligible
            ? "unlocked"
            : `${s.summary.attended} of ${s.summary.reviewThreshold} events needed`,
      }));
    const recent = history.rows
      .filter((r) => !club || r.clubs.some((c) => c.id === club.id))
      .slice(0, 8)
      .map((r) => ({ event: r.title, host: r.club?.name ?? "Weber State", when: fmtDate(r.startsAt, "EEE, MMM d, yyyy"), as: r.asMember === false ? "guest" : "member" }));
    return {
      data: { total_check_ins: history.rows.length, clubs: per, recent_check_ins: recent, attendance_page: "/me/attendance" },
      label: club ? `Checked your attendance at ${club.name}` : "Checked your attendance",
    };
  },
});

// ─── policies ───────────────────────────────────────────────────────────────

const PLACEMENT_WORD: Record<PolicyPlacement, string> = {
  GENERAL: "everywhere",
  CLUB_CREATION: "starting a club",
  MEMBERSHIP: "membership",
  OFFICER_ROLES: "officer roles",
  EVENTS: "events",
  FUNDING: "funding",
  FILES: "files",
  MESSAGING: "messaging",
  REVIEWS: "reviews",
  COMPLAINTS: "reporting concerns",
};

const listPolicies = readTool({
  name: "list_policies",
  running: "Listing policies",
  description: "WSUSA's published policies for clubs: title, one-line summary, where in the platform each applies, and link.",
  schema: z.object({}),
  async run() {
    const rows = await db.policy.findMany({ where: { status: "PUBLISHED" }, orderBy: { title: "asc" }, select: { slug: true, title: true, summary: true, placements: true } });
    return {
      data: { policies: rows.map((p) => ({ title: p.title, summary: p.summary, applies_to: p.placements.map((x) => PLACEMENT_WORD[x]), slug: p.slug, link: `/policies/${p.slug}` })) },
      label: "Listed WSUSA policies",
    };
  },
});

const getPolicy = readTool({
  name: "get_policy",
  running: "Reading the policy",
  description: "The full text of one published policy (by slug or title), to quote or explain it accurately.",
  schema: z.object({ policy: z.string().min(1).max(160).describe("The policy's slug or title, e.g. \"event-safety\" or \"Hazing Prohibition\"") }),
  async run(_ctx, input) {
    const q = input.policy.trim();
    const where = { status: "PUBLISHED" as const };
    const policy =
      (await db.policy.findFirst({ where: { ...where, slug: q.toLowerCase() } })) ??
      (await db.policy.findFirst({ where: { ...where, title: { equals: q, mode: "insensitive" } } })) ??
      (await db.policy.findFirst({ where: { ...where, OR: [{ title: { contains: q, mode: "insensitive" } }, { slug: { contains: q.toLowerCase().replace(/\s+/g, "-") } }] } }));
    if (!policy) throw new ToolError(`No published policy matches “${q}”. Use list_policies to see them all.`);
    const text = richToText(policy.bodyHtml, 8000);
    return {
      data: {
        title: policy.title,
        summary: policy.summary,
        version: policy.version,
        effective: policy.effectiveAt ? fmtDate(policy.effectiveAt, "MMM d, yyyy") : null,
        applies_to: policy.placements.map((x) => PLACEMENT_WORD[x]),
        text: text || null,
        ...(policy.documentFileId && !text ? { note: "This policy is a document; the person can read it at the link." } : {}),
        link: `/policies/${policy.slug}`,
      },
      label: `Read the ${policy.title} policy`,
    };
  },
});

// ─── explain_permissions ────────────────────────────────────────────────────

const PHASE_NOTE: Record<string, string> = {
  DRAFT: "While a club is being founded only Profile, Org chart, Constitution and Files are available.",
  SUBMITTED: "While WSUSA reviews the club only Profile, Org chart, Constitution and Files are available.",
  CHANGES_REQUESTED: "Until WSUSA approves the club only Profile, Org chart, Constitution and Files are available.",
  APPROVED: "",
  REJECTED: "This club wasn't approved, so it's read-only.",
  RETIRED: "This club is retired, so it's read-only.",
};

const explainPermissions = readTool({
  name: "explain_permissions",
  running: "Checking permissions",
  description:
    "What the person can and can't do in one club, straight from the permission system: their role, the club tools (capabilities) they have and don't have, which roles they can assign, whether they can invite advisors or retire the club, and any paused permissions with the overdue officer requirements.",
  schema: z.object({ club: clubRef }),
  async run({ actor }, input) {
    const club = await resolveClub(actor, input.club);
    const access = await getClubAccess(actor, club.id);
    if (!access) throw new ToolError("That club wasn't found.");
    const has = ALL_CAPABILITIES.filter((c) => access.capabilities.has(c));
    const lacks = ALL_CAPABILITIES.filter((c) => !access.capabilities.has(c));
    let requirements: { name: string; kind: string; done: boolean; due: string; overdue: boolean }[] | undefined;
    if (access.role && ROLE_RANK[access.role] >= 1 && access.role !== "ADVISOR" && access.clubStatus === "APPROVED") {
      const top = await db.roleAssignment.findFirst({ where: { clubId: club.id, userId: actor.id, endedAt: null, role: access.role }, orderBy: { startedAt: "asc" } });
      const approved = await db.club.findUnique({ where: { id: club.id }, select: { approvedAt: true } });
      if (top) {
        const status = await requirementStatus(actor.id, access.role, { assignmentStartedAt: top.startedAt, clubApprovedAt: approved?.approvedAt ?? null });
        requirements = status.items.map((i) => ({ name: i.requirement.name, kind: i.requirement.kind === "TEST" ? "test" : "training", done: i.met, due: fmtDate(i.dueAt, "MMM d, yyyy"), overdue: i.overdue }));
      }
    }
    return {
      data: {
        club: club.name,
        club_status: CLUB_STATUS_TEXT[club.status],
        your_role: access.viaPlatform ? (access.viaPlatform === "SYSADMIN" ? "system administrator (full access)" : "WSUSA administrator (full access)") : access.role ? ROLE_LABEL[access.role] : access.isPendingMember ? "join request pending" : "not a member",
        permissions_paused: access.suspended ? "Yes — an officer requirement is overdue, so club tools are paused until it's done. The title stays." : undefined,
        can_use: has.map((c) => ({ tool: CAPABILITIES[c].label, what: CAPABILITIES[c].description })),
        cannot_use: lacks.map((c) => CAPABILITIES[c].label),
        can_assign_roles: access.assignableRoles.map((r) => ROLE_LABEL[r]),
        can_invite_advisor: access.canInviteAdvisor,
        can_retire_club: access.canRetire,
        phase_note: PHASE_NOTE[access.clubStatus] || undefined,
        officer_requirements: requirements,
        workspace_link: access.isLeader ? `/clubs/${club.slug}/manage` : undefined,
      },
      label: `Checked your permissions in ${club.name}`,
    };
  },
});

// ─── event_details ──────────────────────────────────────────────────────────

const eventDetails = readTool({
  name: "event_details",
  running: "Looking up the event",
  description:
    "Details of one event the person can see: host and co-hosts, schedule, next meetings (with cancellations), location, who can see it, whether self check-in is allowed, description, and expected costs when they're a leader who may see them. Pass the event_id from another tool, or a title to search.",
  schema: z.object({
    event_id: z.string().max(64).optional().describe("The event_id from my_calendar or get_club"),
    title: z.string().max(140).optional().describe("Search by title when you don't have the id"),
  }),
  async run({ actor, now }, input) {
    let id = input.event_id?.trim();
    if (!id && input.title) {
      const { searchEmbeddableEvents } = await import("@/lib/rich/embed-data");
      const found = await searchEmbeddableEvents(actor, { q: input.title, limit: 5 });
      if (found.length === 0) throw new ToolError(`No event the person can see matches ${quote(input.title)}.`);
      if (found.length > 1 && !found.every((f) => f.title === found[0].title)) {
        throw new ToolError(`Several events match ${quote(input.title)}: ${found.map((f) => `${quote(f.title)} (${f.clubName ?? "university"}, event_id ${f.id})`).join("; ")}. Ask which one.`);
      }
      id = found[0].id;
    }
    if (!id) throw new ToolError("Give an event_id or a title.");
    const event = await db.event.findUnique({
      where: { id },
      include: {
        club: { select: { id: true, name: true, slug: true, status: true } },
        building: { select: { name: true } },
        // clubId + status: the shape canViewEvent's members-only rule reads.
        cohosts: { where: { status: "APPROVED" }, select: { clubId: true, status: true, club: { select: { name: true } } } },
        occurrences: { where: { endsAt: { gte: now } }, orderBy: { startsAt: "asc" }, take: 5 },
        _count: { select: { occurrences: true } },
      },
    });
    // Same answer for "missing" and "not allowed", so hidden events stay hidden.
    if (!event || !(await canViewEvent(actor, event))) throw new ToolError("That event doesn't exist or this person can't see it.");
    const [manage, costs] = await Promise.all([canManageEvent(actor, event), canSeeEventCosts(actor, event)]);
    const summary = costs ? await eventCostSummary(event.id) : null;
    return {
      data: {
        title: event.title,
        type: KIND_LABEL[event.kind],
        status: event.status === "DRAFT" ? "idea (not scheduled yet)" : event.status === "CANCELLED" ? "cancelled" : "scheduled",
        host: event.club?.name ?? "Weber State (university event)",
        cohosts: event.cohosts.map((c) => c.club.name),
        schedule: event.startsAt
          ? describeSchedule({ startsAt: event.startsAt, recurrence: event.recurrence, interval: event.recurrenceInterval, weekdays: event.recurrenceWeekdays, until: event.recurrenceUntil, count: event.recurrenceCount, allDay: event.allDay })
          : null,
        length_minutes: event.allDay ? undefined : event.durationMinutes,
        meetings_total: event._count.occurrences,
        next_meetings: event.occurrences.map((o) => ({
          when: fmtRange(o.startsAt, o.endsAt, event.allDay),
          cancelled: o.status === "CANCELLED" ? (o.note ? `cancelled — ${o.note}` : "cancelled") : undefined,
          happening_now: o.startsAt <= now && now <= o.endsAt ? true : undefined,
        })),
        where: locationText(event),
        online_link: event.virtualUrl ?? undefined,
        who_can_see_it: VISIBILITY_LABEL[event.visibility],
        check_in: event.locationType === "VIRTUAL" ? "members tap Check in while it's happening" : "at the event: scan the QR code or type the code on the screen; leaders can add people",
        description: richToText(event.descriptionHtml, 1500) || null,
        expected_costs: summary && summary.totalCents > 0 ? { total: fmtMoney(summary.totalCents), per_meeting: fmtMoney(summary.perOccurrenceCents), one_time: fmtMoney(summary.oneTimeCents) } : undefined,
        link: `/events/${event.id}`,
        edit_link: manage && event.club ? `/clubs/${event.club.slug}/manage/events/${event.id}` : undefined,
      },
      label: `Looked up ${quote(event.title, 50)}`,
    };
  },
});

// ─── founding_status ────────────────────────────────────────────────────────

const foundingStatus = readTool({
  name: "founding_status",
  running: "Checking the founding checklist",
  description:
    "For a club being founded: what WSUSA needs before it can be submitted (profile gaps, an accepted advisor, an adopted constitution and bylaws), pending advisor invitations, its review status, and links to finish each step. Only for the club's own leaders and admins.",
  schema: z.object({ club: clubRef }),
  async run({ actor }, input) {
    const club = await resolveClub(actor, input.club);
    const access = await getClubAccess(actor, club.id);
    if (!access?.isLeader) throw new ToolError(`Only ${club.name}'s leaders, advisors and WSUSA can see its founding checklist.`);
    const [check, invites, full] = await Promise.all([
      foundingChecklist(club.id),
      db.advisorInvite.findMany({ where: { clubId: club.id, status: "PENDING" }, select: { name: true, email: true, createdAt: true } }),
      db.club.findUniqueOrThrow({ where: { id: club.id }, select: { submittedAt: true, decisions: { where: { action: "CHANGES_REQUESTED" }, orderBy: { at: "desc" }, take: 1, select: { note: true } } } }),
    ]);
    const base = `/clubs/${club.slug}/manage`;
    const last = full.decisions[0];
    return {
      data: {
        club: club.name,
        status: CLUB_STATUS_TEXT[club.status],
        ...(club.status === "CHANGES_REQUESTED" && last?.note ? { wsusa_feedback: last.note } : {}),
        ...(full.submittedAt ? { submitted: fmtDate(full.submittedAt, "MMM d, yyyy") } : {}),
        ready_to_submit: check.ready,
        still_needed: check.missing,
        profile: { done: check.profile.done, missing: check.profile.gaps, link: `${base}/profile` },
        advisor: {
          done: check.advisor.done,
          advisors: check.advisor.advisors.map((a) => a.name),
          pending_invitations: invites.map((i) => ({ name: i.name, email: i.email, sent: fmtDate(i.createdAt, "MMM d") })),
          link: base,
        },
        constitution_and_bylaws: {
          done: check.documents.done,
          constitution: check.documents.constitution ? check.documents.constitution.status.toLowerCase().replace("_", " ") : "not adopted",
          bylaws: check.documents.bylaws ? check.documents.bylaws.status.toLowerCase().replace("_", " ") : "not adopted",
          link: `${base}/constitution`,
          builder: "/constitution",
        },
        submit_from: base,
      },
      label: `Checked ${club.name}'s founding checklist`,
    };
  },
});

// ─── club_health ────────────────────────────────────────────────────────────

const clubHealth = readTool({
  name: "club_health",
  running: "Checking club activity",
  description:
    "Which clubs are at risk: approved clubs that don't count as active (with the reasons from the metrics layer) and pilot clubs whose pilot period ends soon. Admins see every club; everyone else sees the clubs they lead or advise.",
  schema: z.object({ pilot_ending_within_days: z.number().int().min(1).max(365).optional().describe("Flag pilot periods ending within this many days (default 60)") }),
  async run({ actor, now }, input) {
    const window = (input.pilot_ending_within_days ?? 60) * 86_400_000;
    let clubIds: string[] | undefined;
    if (!isAdmin(actor)) {
      const roles = await db.roleAssignment.findMany({ where: { userId: actor.id, endedAt: null, role: { not: "MEMBER" } }, select: { clubId: true } });
      clubIds = [...new Set(roles.map((r) => r.clubId))];
      if (!clubIds.length) throw new ToolError("Club health is for club leaders, advisors and WSUSA admins. This person doesn't lead any clubs; get_club shows any one club's status.");
    }
    const [activity, clubs, terms] = await Promise.all([
      clubActivityMany(clubIds, now),
      db.club.findMany({ where: { status: "APPROVED", ...(clubIds ? { id: { in: clubIds } } : {}) }, select: { id: true, name: true, slug: true } }),
      getTerms(),
    ]);
    const byId = new Map(clubs.map((c) => [c.id, c]));
    const atRisk: unknown[] = [];
    const pilotEnding: unknown[] = [];
    let healthy = 0;
    for (const [id, a] of activity) {
      const c = byId.get(id);
      if (!c) continue;
      const row = { club: c.name, link: `/clubs/${c.slug}`, registered_members: a.registeredMembers, active_members: a.activeMembers, held_events_current_term: a.heldEventsCurrentTerm, held_events_previous_term: a.heldEventsPreviousTerm };
      if (!a.active) atRisk.push({ ...row, reasons: a.reasons });
      else if (a.inPilot && a.pilotEndsAt && a.pilotEndsAt.getTime() - now.getTime() <= window) pilotEnding.push({ ...row, pilot_ends: fmtDate(a.pilotEndsAt, "MMM d, yyyy"), reasons: a.reasons });
      else healthy++;
    }
    const term = currentOrLastTerm(terms, now);
    return {
      data: {
        scope: clubIds ? "clubs this person leads or advises" : "every approved club",
        term: term?.name ?? null,
        not_active: atRisk,
        pilot_ending_soon: pilotEnding,
        active_and_fine: healthy,
        ...(clubIds ? {} : { admin_pages: { clubs: "/admin/clubs", analytics: "/admin/analytics" } }),
      },
      label: "Checked which clubs are at risk",
    };
  },
});

// ─── org_chart ──────────────────────────────────────────────────────────────

const orgChart = readTool({
  name: "org_chart",
  running: "Reading the org chart",
  description: "A club's org chart: every seat (name, role, responsibilities, default permissions, holder limit) with who holds it now and open spots, plus advisors. Use before assign_role.",
  schema: z.object({ club: clubRef }),
  async run({ actor }, input) {
    const club = await resolveClub(actor, input.club);
    const chart = await orgChartData(club.id);
    const access = await getClubAccess(actor, club.id);
    return {
      data: {
        club: club.name,
        seats: chart.seats.map((s) => ({
          seat: s.name,
          role: s.roleLabel,
          holders: s.holders.map((h) => h.person.name),
          open_spots: s.virtual ? 0 : Math.max(0, s.maxHolders - s.holders.length),
          max_holders: s.maxHolders,
          responsibilities: s.responsibilities,
          default_permissions: s.role === "PRESIDENT" || s.role === "VP" ? ["every club tool"] : s.defaultPermissions.filter((p) => p in CAPABILITIES).map((p) => CAPABILITIES[p as keyof typeof CAPABILITIES].label),
        })),
        advisors: chart.advisors.map((p) => p.name),
        you_can_assign: access?.assignableRoles.map((r) => ROLE_LABEL[r]) ?? [],
        org_chart_page: access?.capabilities.has("orgchart") ? `/clubs/${club.slug}/manage/org-chart` : `/clubs/${club.slug}#org-chart`,
      },
      label: `Read ${club.name}'s org chart`,
    };
  },
});

// ─── find_club_member ───────────────────────────────────────────────────────

const findClubMember = readTool({
  name: "find_club_member",
  running: "Looking up members",
  description: "Find active members of a club by name (for assigning roles). Only for people who can see the club's member roster (the Members permission) or assign its roles.",
  schema: z.object({ club: clubRef, name: z.string().min(1).max(100).describe("Part of the person's name") }),
  async run({ actor }, input) {
    const club = await resolveClub(actor, input.club);
    const access = await getClubAccess(actor, club.id);
    // The same people the roster page shows members to, plus those who assign roles (assign_role needs a name).
    if (!access || !(access.capabilities.has("roster") || access.assignableRoles.length > 0)) {
      throw new ToolError(
        access?.suspended
          ? `Their permissions in ${club.name} are paused until they finish an overdue officer requirement (see their Tasks).`
          : `Looking up ${club.name}'s members needs the ${CAPABILITIES.roster.label} permission there, which they don't have. The President, a Vice President or the club's advisor can grant it in the org chart.`,
      );
    }
    const rows = await db.membership.findMany({
      where: { clubId: club.id, status: "ACTIVE", user: { name: { contains: input.name.trim(), mode: "insensitive" } } },
      select: { joinedAt: true, user: { select: { id: true, name: true, kind: true, status: true } } },
      orderBy: { user: { name: "asc" } },
      take: 10,
    });
    const roles = await db.roleAssignment.findMany({
      where: { clubId: club.id, endedAt: null, userId: { in: rows.map((r) => r.user.id) } },
      select: { userId: true, role: true, position: { select: { name: true } } },
    });
    return {
      data: {
        club: club.name,
        members: rows.map((r) => ({
          name: r.user.name,
          account: r.user.kind === "STUDENT" ? "student" : "faculty/staff",
          joined: r.joinedAt ? fmtDate(r.joinedAt, "MMM yyyy") : null,
          current_roles: roles.filter((x) => x.userId === r.user.id).map((x) => x.position?.name ?? ROLE_LABEL[x.role]),
        })),
      },
      label: `Looked up ${quote(input.name, 30)} in ${club.name}`,
    };
  },
});

// ─── directory_lookup ───────────────────────────────────────────────────────

const directoryLookup = readTool({
  name: "directory_lookup",
  running: "Checking the directory",
  description: "Weber State's directory as the platform knows it: colleges, departments, majors or campus buildings matching a word (or all colleges). Use to get exact names for start_club_draft and create_event.",
  schema: z.object({
    kind: z.enum(["college", "department", "major", "building"]),
    query: z.string().max(100).optional().describe("Part of the name (or a building code)"),
  }),
  async run(_ctx, input) {
    const q = input.query?.trim();
    const contains = q ? { contains: q, mode: "insensitive" as const } : undefined;
    let results: { name: string; detail?: string }[] = [];
    switch (input.kind) {
      case "college":
        results = (await db.college.findMany({ where: contains ? { OR: [{ name: contains }, { shortName: contains }] } : undefined, orderBy: { name: "asc" }, select: { name: true, shortName: true } })).map((c) => ({ name: c.name, detail: c.shortName }));
        break;
      case "department":
        results = (await db.department.findMany({ where: contains ? { name: contains } : undefined, orderBy: { name: "asc" }, take: 25, select: { name: true, college: { select: { name: true } } } })).map((d) => ({ name: d.name, detail: d.college?.name }));
        break;
      case "major":
        results = (await db.major.findMany({ where: contains ? { name: contains } : undefined, orderBy: { name: "asc" }, take: 25, select: { name: true } })).map((m) => ({ name: m.name }));
        break;
      case "building":
        results = (await db.building.findMany({ where: contains ? { OR: [{ name: contains }, { code: contains }] } : undefined, orderBy: { name: "asc" }, take: 25, select: { name: true, code: true } })).map((b) => ({ name: b.name, detail: b.code }));
        break;
    }
    return { data: { kind: input.kind, results, ...(results.length === 0 ? { note: "Nothing matches. Try a shorter word." } : {}) }, label: `Looked up ${input.kind}s${q ? ` matching ${quote(q, 30)}` : ""}` };
  },
});

export const READ_TOOLS = [
  searchClubs,
  getClub,
  myClubsAndRoles,
  myProfile,
  myTasks,
  myCalendar,
  myAttendance,
  listPolicies,
  getPolicy,
  explainPermissions,
  eventDetails,
  foundingStatus,
  clubHealth,
  orgChart,
  findClubMember,
  directoryLookup,
];

export type { ToolCtx };
