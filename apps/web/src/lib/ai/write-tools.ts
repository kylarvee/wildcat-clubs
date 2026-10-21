import "server-only";
import { z } from "zod";
import type { EventKind, Recurrence, Visibility } from "@prisma/client";
import { db } from "@/lib/db";
import { can, CAPABILITIES, getClubAccess, ROLE_LABEL, type Capability } from "@/lib/authz";
import { joinClub, subscribeCalendar, unsubscribeCalendar } from "@/lib/domain/memberships";
import { addPersonalTask } from "@/lib/domain/tasks";
import { updateProfile } from "@/lib/domain/profiles";
import { createEvent, type CreateEventInput } from "@/lib/domain/events";
import { createClub } from "@/lib/domain/clubs";
import { inviteAdvisor } from "@/lib/domain/advisors";
import { assignRole } from "@/lib/domain/roles";
import { audienceReach, createClubAnnouncement } from "@/lib/domain/announcements";
import { ANNOUNCEMENT_TITLE_MAX, audienceOptions } from "@/components/announcements/labels";
import { activeRequirements } from "@/lib/roles/queries";
import { CLUB_SCOPE_LABEL, CLUB_TYPE_HINT, CLUB_TYPE_LABEL } from "@/lib/labels/clubs";
import { KIND_LABEL, VISIBILITY_HINT, VISIBILITY_LABEL, roomLabel } from "@/lib/events/labels";
import { describeRecurrence } from "@/lib/events/summary";
import { expandOccurrences } from "@/lib/events/recurrence";
import { isHttpUrl } from "@/lib/events/links";
import { googleCalendarReady } from "@/lib/integrations/google-calendar";
import { getTerms } from "@/lib/terms";
import { campusDate, fmtDate, fmtRange } from "@/lib/time";
import { parseCampusLocal } from "@/lib/roles/datetime";
import { INSTITUTION, isStaffEmail } from "@/lib/institution";
import { quote, textToHtml, writeTool, type ToolCtx } from "@/lib/ai/tool-kit";
import { findDepartment, findMajor, resolveBuilding, resolveClub, resolveCollege, resolveMember, resolveSeat, ToolError } from "@/lib/ai/resolve";

/**
 * Write tools. `prepare` resolves names, checks what it can through lib/authz
 * and describes exactly what will happen; nothing changes until the person
 * presses Confirm, when `execute` calls the same domain function the app's own
 * buttons call (memberships.joinClub, events.createEvent, roles.assignRole…),
 * as the signed-in person — so lib/authz has the final say.
 */

const clubRef = z.string().min(1).max(160).describe("The club's name (or part of it) or its URL slug");
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{1,2}:\d{2}$/;

const LEADER_HELP = "The President, a Vice President or the club's advisor can grant it in the org chart.";

/** "Backed by…" → "backed by…", for a hint used mid-sentence. */
const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

async function requireClubCap(ctx: ToolCtx, clubId: string, clubName: string, cap: Capability) {
  const access = await getClubAccess(ctx.actor, clubId);
  if (access?.capabilities.has(cap)) return access;
  if (access?.suspended) throw new ToolError(`Their permissions in ${clubName} are paused until they finish an overdue WSUSA requirement (see their Tasks).`);
  throw new ToolError(`This needs the ${CAPABILITIES[cap].label} permission in ${clubName}, which they don't have. ${LEADER_HELP}`);
}

/** The end of a campus calendar day, for "until" dates. */
function endOfCampusDay(date: string): Date | null {
  if (!DATE.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  return campusDate(y, m, d, 23, 59);
}

// ─── join_club ──────────────────────────────────────────────────────────────

const joinClubTool = writeTool({
  name: "join_club",
  running: "Preparing to join",
  description:
    "Register the person for a club (the same as the Register button). Open clubs (\"Open: anyone can join\") make them a member right away and follow the club's calendar for them; Approval clubs (\"Approval: leaders approve each request\") send a join request to the club's leaders. Needs confirmation.",
  schema: z.object({ club: clubRef }),
  async prepare(ctx, input) {
    const { actor } = ctx;
    const club = await resolveClub(actor, input.club, { approvedOnly: true });
    if (actor.status !== "ACTIVE") throw new ToolError("Alumni accounts can't join new clubs.");
    const existing = await db.membership.findUnique({ where: { userId_clubId: { userId: actor.id, clubId: club.id } }, select: { status: true } });
    if (existing?.status === "ACTIVE") throw new ToolError(`They're already a member of ${club.name}.`);
    if (existing?.status === "PENDING") throw new ToolError(`Their request to join ${club.name} is already pending with its leaders.`);
    const gated = club.joinPolicy === "APPROVAL" || existing?.status === "REMOVED" || existing?.status === "DECLINED";
    return {
      card: {
        title: `Join ${club.name}`,
        details: gated
          ? [`${club.name}'s leaders approve each request, so this sends them a join request.`, "You'll get a notification when they decide.", "You'll follow its calendar once you're in."]
          : [`You'll become a member of ${club.name} right away.`, "You'll follow its calendar, so its events show on yours.", "You can leave any time from the club page."],
        confirmLabel: gated ? "Send request" : "Join club",
      },
      async execute() {
        const r = await joinClub(actor, club.id, "REGISTER");
        const outcome = {
          ACTIVE: `You're now a member of ${club.name}.`,
          PENDING: `Sent your join request to ${club.name}'s leaders.`,
          ALREADY_MEMBER: `You were already a member of ${club.name}.`,
          ALREADY_PENDING: `Your request to join ${club.name} was already pending.`,
        }[r.status];
        return {
          data: { result: r.status === "ACTIVE" ? "joined" : r.status === "PENDING" ? "join request sent" : r.status.toLowerCase().replace("_", " "), club: club.name, link: `/clubs/${club.slug}` },
          outcome,
          href: `/clubs/${club.slug}`,
          revalidate: ["/clubs", `/clubs/${club.slug}`, "/dashboard", "/events"],
        };
      },
    };
  },
});

// ─── subscribe / unsubscribe ────────────────────────────────────────────────

const subscribeTool = writeTool({
  name: "subscribe_calendar",
  running: "Preparing to follow the calendar",
  description: "Follow a club's calendar without joining the club: its events appear on the person's calendar and private calendar feed. Needs confirmation.",
  schema: z.object({ club: clubRef }),
  async prepare({ actor }, input) {
    const club = await resolveClub(actor, input.club, { approvedOnly: true });
    const sub = await db.calendarSubscription.findUnique({ where: { userId_clubId: { userId: actor.id, clubId: club.id } } });
    if (sub) throw new ToolError(`They already follow ${club.name}'s calendar.`);
    return {
      card: {
        title: `Follow ${club.name}'s calendar`,
        details: [`${club.name}'s events will show on your calendar and in your calendar feed.`, "This doesn't make you a member — register on the club page for that."],
        confirmLabel: "Follow calendar",
      },
      async execute() {
        await subscribeCalendar(actor, club.id);
        return { data: { result: "following", club: club.name }, outcome: `You now follow ${club.name}'s calendar.`, href: "/events?scope=mine", revalidate: ["/events", `/clubs/${club.slug}`, "/dashboard"] };
      },
    };
  },
});

const unsubscribeTool = writeTool({
  name: "unsubscribe_calendar",
  running: "Preparing to unfollow the calendar",
  description: "Stop following a club's calendar. Membership is unchanged. Needs confirmation.",
  schema: z.object({ club: clubRef }),
  async prepare({ actor }, input) {
    const club = await resolveClub(actor, input.club);
    const [sub, membership] = await Promise.all([
      db.calendarSubscription.findUnique({ where: { userId_clubId: { userId: actor.id, clubId: club.id } } }),
      db.membership.findUnique({ where: { userId_clubId: { userId: actor.id, clubId: club.id } }, select: { status: true } }),
    ]);
    if (!sub) throw new ToolError(`They don't follow ${club.name}'s calendar.`);
    return {
      card: {
        title: `Unfollow ${club.name}'s calendar`,
        details: [
          `${club.name}'s events leave your calendar and calendar feed.`,
          membership?.status === "ACTIVE" ? `You stay a member of ${club.name}.` : "You can follow it again any time from the club page.",
        ],
        confirmLabel: "Unfollow",
      },
      async execute() {
        await unsubscribeCalendar(actor, club.id);
        return { data: { result: "unfollowed", club: club.name }, outcome: `You no longer follow ${club.name}'s calendar.`, href: "/events?scope=mine", revalidate: ["/events", `/clubs/${club.slug}`, "/dashboard"] };
      },
    };
  },
});

// ─── add_personal_task ──────────────────────────────────────────────────────

const addTaskTool = writeTool({
  name: "add_personal_task",
  running: "Preparing a to-do",
  description: "Add a personal to-do to the person's Tasks (only they see it), optionally with a due date. Needs confirmation.",
  schema: z.object({
    title: z.string().min(1).max(200),
    notes: z.string().max(2000).optional(),
    due_date: z.string().regex(DATE).optional().describe("YYYY-MM-DD (campus time)"),
    due_time: z.string().regex(TIME).optional().describe("24-hour HH:MM; leave out for end of day"),
  }),
  async prepare({ actor, now }, input) {
    let dueAt: Date | null = null;
    if (input.due_date) {
      dueAt = parseCampusLocal(`${input.due_date}T${input.due_time ?? "23:59"}`);
      if (!dueAt) throw new ToolError("That due date or time isn't valid. Use YYYY-MM-DD and HH:MM.");
      if (dueAt < now) throw new ToolError("That due date has already passed. Ask for a later date.");
    }
    const title = input.title.trim();
    const notes = input.notes?.trim() || undefined;
    return {
      card: {
        title: `Add a to-do: ${quote(title, 80)}`,
        details: [
          dueAt ? `Due ${fmtDate(dueAt, "EEE, MMM d, yyyy")}${input.due_time ? ` at ${fmtDate(dueAt, "h:mm a")}` : ""}.` : "No due date.",
          ...(notes ? [`Notes: ${notes.length > 160 ? `${notes.slice(0, 159)}…` : notes}`] : []),
          "It goes in your Tasks, where only you can see it.",
        ],
        confirmLabel: "Add to-do",
      },
      async execute() {
        const task = await addPersonalTask(actor, { title, description: notes, dueAt });
        return { data: { result: "added", task_id: task.id, title }, outcome: `Added ${quote(title, 60)} to your tasks.`, href: "/tasks", revalidate: ["/tasks", "/dashboard"] };
      },
    };
  },
});

// ─── update_my_profile ──────────────────────────────────────────────────────

const updateProfileTool = writeTool({
  name: "update_my_profile",
  running: "Preparing your profile changes",
  description:
    "Change the basics of the person's own profile (the same as Settings → Profile): headline, About, pronouns, LinkedIn link, and majors, minors and class year (students) or title (faculty/staff). Pass only the fields they want changed; everything else stays as it is. Check my_profile first. The card shows each change. Needs confirmation.",
  schema: z.object({
    headline: z.string().max(120).optional().describe("One line shown under their name; \"\" clears it"),
    about: z.string().max(5000).optional().describe("Plain text that replaces their whole About section; a blank line starts a new paragraph; \"\" clears it"),
    pronouns: z.string().max(30).optional().describe("e.g. \"she/her\"; \"\" clears it"),
    linkedin_url: z.string().max(300).optional().describe("Their LinkedIn profile link, e.g. https://www.linkedin.com/in/their-name; \"\" clears it"),
    majors: z
      .array(z.object({ name: z.string().min(1).max(120).describe("Major name from Weber State's list (directory_lookup kind major)"), minor: z.boolean().optional().describe("true for a minor") }))
      .max(8)
      .optional()
      .describe("Students only: the complete list of majors and minors after the change, including the ones they keep; [] clears it"),
    class_year: z.number().int().min(1950).max(2100).nullable().optional().describe("Students only: expected graduation year; null clears it"),
    job_title: z.string().max(120).optional().describe("Faculty/staff only: their title, e.g. \"Associate Professor of Computer Science\"; \"\" clears it"),
  }),
  async prepare({ actor }, input) {
    if (actor.status === "ALUMNI") throw new ToolError("Their profile was retired when they graduated, so it can't be changed.");
    const student = actor.kind === "STUDENT";
    if (!student && (input.majors || input.class_year !== undefined)) throw new ToolError("Majors, minors and class year are for student accounts. Faculty and staff can set a title instead.");
    if (student && input.job_title !== undefined) throw new ToolError("Titles are for faculty and staff accounts. Students list majors, minors and a class year instead.");
    const u = await db.user.findUnique({
      where: { id: actor.id },
      select: {
        name: true,
        handle: true,
        pronouns: true,
        headline: true,
        aboutHtml: true,
        jobTitle: true,
        classYear: true,
        linkedinUrl: true,
        avatarUrl: true,
        majors: { select: { majorId: true, isMinor: true, major: { select: { name: true } } } },
      },
    });
    if (!u) throw new ToolError("Their account wasn't found.");

    // updateProfile saves every field, so start from what's there and change only what was asked.
    const text = (given: string | undefined, current: string | null) => (given === undefined ? current : given.trim() || null);
    const next = {
      pronouns: text(input.pronouns, u.pronouns),
      headline: text(input.headline, u.headline),
      aboutHtml: input.about === undefined ? u.aboutHtml : textToHtml(input.about),
      linkedinUrl: text(input.linkedin_url, u.linkedinUrl),
      jobTitle: text(input.job_title, u.jobTitle),
      classYear: input.class_year === undefined ? u.classYear : input.class_year,
    };
    let majors = u.majors.map((m) => ({ majorId: m.majorId, isMinor: m.isMinor, name: m.major.name }));
    if (input.majors) {
      majors = [];
      for (const m of input.majors) {
        const found = await findMajor(m.name);
        if (!found) throw new ToolError(`“${m.name.trim()}” doesn't match one major on Weber State's list. Look up the exact name with directory_lookup (kind major).`);
        if (majors.some((x) => x.majorId === found.id)) throw new ToolError(`${found.name} is listed twice. List each major or minor once.`);
        majors.push({ majorId: found.id, isMinor: Boolean(m.minor), name: found.name });
      }
    }

    const changes: string[] = [];
    const changed: string[] = [];
    const line = (field: string, label: string, before: string | null, after: string | null) => {
      if ((before ?? "") === (after ?? "")) return;
      changed.push(field);
      changes.push(!after ? `${label}: cleared (was ${quote(before!, 60)}).` : before ? `${label}: ${quote(before, 60)} → ${quote(after, 80)}.` : `${label}: ${quote(after, 80)}.`);
    };
    line("headline", "Headline", u.headline, next.headline);
    line("pronouns", "Pronouns", u.pronouns, next.pronouns);
    if (student) {
      const list = (ms: { name: string; isMinor: boolean }[]) =>
        [...ms]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((m) => `${m.name} (${m.isMinor ? "minor" : "major"})`)
          .join(", ");
      line("majors", "Majors and minors", list(u.majors.map((m) => ({ name: m.major.name, isMinor: m.isMinor }))) || null, list(majors) || null);
      line("class_year", "Class of", u.classYear?.toString() ?? null, next.classYear?.toString() ?? null);
    } else line("job_title", "Title", u.jobTitle, next.jobTitle);
    line("linkedin_url", "LinkedIn", u.linkedinUrl, next.linkedinUrl);
    const about = input.about?.trim() ?? "";
    if (input.about !== undefined && (next.aboutHtml ?? "") !== (u.aboutHtml ?? "")) {
      changed.push("about");
      changes.push(about ? `About: ${u.aboutHtml ? "your whole About section is replaced with" : "set to"} the text below.` : "About: cleared.");
    }
    if (!changes.length) throw new ToolError("Their profile already says that, so there's nothing to change.");

    return {
      card: {
        title: "Update your profile",
        details: [...changes, "Signed-in Weber State accounts can see your profile. You can change it any time in Settings."],
        ...(about && changed.includes("about") ? { preview: { label: "About", text: about } } : {}),
        confirmLabel: "Save profile",
      },
      async execute() {
        const r = await updateProfile(actor, { name: u.name, avatarUrl: u.avatarUrl, ...next, majors: student ? majors.map(({ majorId, isMinor }) => ({ majorId, isMinor })) : [] });
        const href = `/u/${r.handle}`;
        return { data: { result: "profile updated", changed, profile: href }, outcome: "Saved your profile.", href, revalidate: [href, "/settings"] };
      },
    };
  },
});

// ─── create_event ───────────────────────────────────────────────────────────

const WEEKDAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const FREQUENCY: Record<string, Recurrence> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
  semesterly: "SEMESTERLY",
  academic_yearly: "ACADEMIC_YEARLY",
};

const createEventTool = writeTool({
  name: "create_event",
  running: "Preparing the event",
  description:
    "Put a new event on a club's calendar through the Events Builder — one-time or repeating. Needs the Events permission in an approved club. Times are campus time. For a club's regular meeting, repeat until the last day of the current term unless they say otherwise. Needs confirmation; the card shows every meeting date range, the place and who can see it.",
  schema: z.object({
    club: clubRef,
    title: z.string().min(1).max(140),
    date: z.string().regex(DATE).describe("Date of the first meeting, YYYY-MM-DD"),
    start_time: z.string().regex(TIME).optional().describe("24-hour HH:MM start; leave out for an all-day event"),
    duration_minutes: z.number().int().min(5).max(1440).optional().describe("Default 60"),
    kind: z.enum(["MEETING", "PRACTICE", "SOCIAL", "WORKSHOP", "SERVICE", "COMPETITION", "FUNDRAISER", "TRAINING", "OTHER"]).optional().describe("Default MEETING"),
    description: z.string().max(4000).optional().describe("Plain text; a blank line starts a new paragraph"),
    repeat: z
      .object({
        frequency: z.enum(["daily", "weekly", "monthly", "yearly", "semesterly", "academic_yearly"]),
        every: z.number().int().min(1).max(52).optional().describe("Every N days/weeks/months (default 1)"),
        weekdays: z.array(z.enum(WEEKDAY)).max(7).optional().describe("Weekly only: which days (default: the first meeting's day)"),
        until: z.string().regex(DATE).optional().describe("Last possible date, YYYY-MM-DD"),
        count: z.number().int().min(1).max(400).optional().describe("Or stop after this many meetings"),
      })
      .optional()
      .describe("Leave out for a one-time event"),
    location: z
      .object({
        type: z.enum(["campus", "address", "online", "tbd"]),
        building: z.string().max(120).optional().describe("Campus building name or code (type campus)"),
        room: z.string().max(60).optional(),
        address: z.string().max(300).optional().describe("Street address (type address)"),
        link: z.string().max(1000).optional().describe("Join link starting with https:// (type online)"),
        google_meet: z.boolean().optional().describe("Ask Google Calendar for a Meet link (type online; only works while the club's Google Calendar sync is on)"),
      })
      .optional()
      .describe("Default: to be decided"),
    visibility: z.enum(["public", "university", "members"]).optional().describe("public = anyone (default); university = signed-in Weber State accounts; members = members of the host and co-host clubs"),
  }),
  async prepare(ctx, input) {
    const { actor, now } = ctx;
    const club = await resolveClub(actor, input.club, { approvedOnly: true });
    await requireClubCap(ctx, club.id, club.name, "events");

    const allDay = !input.start_time;
    const startsAt = parseCampusLocal(`${input.date}T${input.start_time ?? "00:00"}`);
    if (!startsAt) throw new ToolError("That date or start time isn't valid. Use YYYY-MM-DD and 24-hour HH:MM.");
    const durationMinutes = allDay ? 24 * 60 : (input.duration_minutes ?? 60);
    if (new Date(startsAt.getTime() + durationMinutes * 60_000) < now) throw new ToolError("That date has already passed. Ask for an upcoming date.");

    const recurrence: Recurrence = input.repeat ? FREQUENCY[input.repeat.frequency] : "NONE";
    const interval = input.repeat?.every ?? 1;
    const weekdays = recurrence === "WEEKLY" ? [...new Set((input.repeat?.weekdays ?? []).map((d) => WEEKDAY.indexOf(d)))].sort() : [];
    let until: Date | null = null;
    if (input.repeat?.until) {
      until = endOfCampusDay(input.repeat.until);
      if (!until) throw new ToolError("The repeat end date isn't valid. Use YYYY-MM-DD.");
      if (until < startsAt) throw new ToolError("The repeat end date needs to be on or after the first meeting.");
    }
    const count = recurrence !== "NONE" && !until ? (input.repeat?.count ?? null) : null;

    // Location, resolved the way the Events Builder stores it.
    const loc = input.location ?? { type: "tbd" as const };
    let where = "Location to be decided";
    let meetNote: string | null = null;
    const location: Pick<CreateEventInput, "locationType" | "buildingId" | "room" | "address" | "virtualUrl" | "createMeetLink"> = { locationType: "TBD", createMeetLink: false };
    if (loc.type === "campus") {
      if (!loc.building) throw new ToolError("Which campus building? (Or use an address or online.)");
      const b = await resolveBuilding(loc.building);
      Object.assign(location, { locationType: "CAMPUS", buildingId: b.id, room: loc.room?.trim() || null });
      where = loc.room?.trim() ? `${b.name}, ${roomLabel(loc.room.trim())}` : b.name;
    } else if (loc.type === "address") {
      if (!loc.address?.trim()) throw new ToolError("What's the address?");
      Object.assign(location, { locationType: "ADDRESS", address: loc.address.trim() });
      where = loc.address.trim();
    } else if (loc.type === "online") {
      const link = loc.link?.trim();
      if (link && !isHttpUrl(link)) throw new ToolError("The online link needs to be a full link starting with https://.");
      if (!link && !loc.google_meet) throw new ToolError("Online events need the join link, or ask for a Google Meet link.");
      Object.assign(location, { locationType: "VIRTUAL", virtualUrl: link || null, createMeetLink: Boolean(loc.google_meet && !link) });
      if (link) where = `Online (${link})`;
      else {
        // A Meet link is only made while this save mirrors to Google; the request isn't kept for later.
        const ready = await googleCalendarReady(club.id);
        where = ready.live ? "Online — a Google Meet link is created when the event is saved" : "Online, with no join link yet";
        if (!ready.live) meetNote = `A Google Meet link can't be made yet. ${ready.reason ?? "Google Calendar sync is off."} Add a join link in the Events Builder before the event.`;
      }
    }

    const visibility: Visibility = input.visibility === "university" ? "UNIVERSITY" : input.visibility === "members" ? "MEMBERS" : "PUBLIC";
    const kind: EventKind = input.kind ?? "MEETING";
    const title = input.title.trim();

    const meetings = expandOccurrences({ startsAt, durationMinutes, allDay, recurrence, interval, weekdays, until, count }, await getTerms());
    if (meetings.length === 0) throw new ToolError("That repeat rule doesn't land on any dates. Check the start date and the days.");
    const first = meetings[0];
    const last = meetings[meetings.length - 1];

    const when =
      recurrence === "NONE"
        ? `When: ${fmtRange(first.startsAt, first.endsAt, allDay)}.`
        : `When: ${describeRecurrence({ startsAt, recurrence, interval, weekdays, until, count, allDay })}, ${allDay ? "all day" : `${fmtDate(first.startsAt, "h:mm a")}–${fmtDate(first.endsAt, "h:mm a")}`} — ${meetings.length} meeting${meetings.length === 1 ? "" : "s"}, ${fmtDate(first.startsAt, "EEE, MMM d")} to ${fmtDate(last.startsAt, "EEE, MMM d, yyyy")}.`;

    const event: CreateEventInput = {
      clubId: club.id,
      title,
      kind,
      descriptionHtml: textToHtml(input.description),
      visibility,
      startsAt,
      durationMinutes,
      allDay,
      recurrence,
      recurrenceInterval: interval,
      recurrenceWeekdays: weekdays,
      recurrenceUntil: until,
      recurrenceCount: count,
      ...location,
    };

    return {
      card: {
        title: `Add ${quote(title, 70)} to ${club.name}'s calendar`,
        details: [
          when,
          `Where: ${where}.`,
          ...(meetNote ? [meetNote] : []),
          `Who can see it: ${VISIBILITY_LABEL[visibility]} — ${VISIBILITY_HINT[visibility]}`,
          `Type: ${KIND_LABEL[kind]}.`,
          ...(input.description?.trim() ? ["Includes the description you gave."] : []),
          "You can change anything later in the Events Builder.",
        ],
        confirmLabel: "Add event",
      },
      async execute() {
        const r = await createEvent(actor, event);
        const google = r.google.status === "failed" ? ` Google Calendar didn't update${r.google.message ? `: ${r.google.message}` : ""}.` : "";
        // Google makes the Meet link only during a sync that succeeds (sync off or failed → no link).
        const noJoinLink = location.createMeetLink && r.google.status !== "synced";
        return {
          data: {
            result: "event created",
            event_id: r.id,
            meetings: meetings.length,
            link: `/events/${r.id}`,
            google_calendar: r.google.status,
            ...(noJoinLink ? { join_link: "none yet — they need to add one in the Events Builder before the event" } : {}),
          },
          outcome: `Added ${quote(title, 60)} to ${club.name}'s calendar.${google}`,
          href: `/events/${r.id}`,
          revalidate: [`/clubs/${club.slug}`, `/clubs/${club.slug}/manage/events`, "/events", "/dashboard"],
        };
      },
    };
  },
});

// ─── start_club_draft ───────────────────────────────────────────────────────

const SCOPE = { college: "COLLEGE", university: "UNIVERSITY", independent: "INDEPENDENT", sports: "SPORTS" } as const;


const startClubTool = writeTool({
  name: "start_club_draft",
  running: "Preparing the club draft",
  description:
    "Start founding a new club: creates a private draft with the default org chart (the same as Start a club). A student founder becomes President; faculty/staff become its advisor. Collect the name, type, short description and placement first. Needs confirmation.",
  schema: z.object({
    name: z.string().min(3).max(100),
    type: z
      .enum(["sponsored", "affiliate", "registered"])
      .describe(`sponsored = ${lcFirst(CLUB_TYPE_HINT.SPONSORED)}; affiliate = ${lcFirst(CLUB_TYPE_HINT.AFFILIATE)}; registered = ${lcFirst(CLUB_TYPE_HINT.REGISTERED)}`),
    short_description: z.string().min(10).max(200).describe("One or two sentences (10–200 characters) for club cards"),
    placement: z.enum(["college", "university", "independent", "sports"]).describe("college = belongs to one college; otherwise university-wide, independent or sports"),
    college: z.string().max(120).optional().describe("Required when placement is college"),
    department: z.string().max(120).optional().describe("Sponsoring department: required for sponsored, optional for affiliate. If it isn't on the list it's sent to WSUSA admins to add."),
    focus: z.string().max(120).optional().describe("Focus major or discipline"),
  }),
  async prepare({ actor }, input) {
    if (!can(actor, "club.create")) throw new ToolError("Only active Weber State accounts can start a club.");
    const name = input.name.trim();
    const clash = await db.club.findFirst({ where: { name: { equals: name, mode: "insensitive" }, status: { in: ["SUBMITTED", "CHANGES_REQUESTED", "APPROVED"] } }, select: { name: true } });
    if (clash) throw new ToolError(`There's already a club named “${clash.name}”. Suggest joining it, or pick a different name.`);
    const college = input.placement === "college" ? (input.college ? await resolveCollege(input.college) : null) : null;
    if (input.placement === "college" && !college) throw new ToolError("Which college does the club belong to?");

    let departmentId: string | null = null;
    let requestedDepartmentName: string | null = null;
    let deptLine: string | null = null;
    if (input.type !== "registered" && input.department?.trim()) {
      const dept = await findDepartment(input.department);
      if (dept) {
        departmentId = dept.id;
        deptLine = `Sponsoring department: ${dept.name}.`;
      } else {
        requestedDepartmentName = input.department.trim();
        deptLine = `Department: “${requestedDepartmentName}” isn't on the list yet, so WSUSA admins get a request to add it.`;
      }
    }
    if (input.type === "sponsored" && !departmentId && !requestedDepartmentName) throw new ToolError("Sponsored clubs need a sponsoring department. Ask which one.");

    const major = input.focus?.trim() ? await findMajor(input.focus) : null;
    const focusOther = !major && input.focus?.trim() ? input.focus.trim() : null;
    const type = input.type.toUpperCase() as "SPONSORED" | "AFFILIATE" | "REGISTERED";
    const placement = college ? college.name : CLUB_SCOPE_LABEL[SCOPE[input.placement]];

    return {
      card: {
        title: `Start a club draft: ${quote(name, 70)}`,
        details: [
          `Type: ${CLUB_TYPE_LABEL[type]} — ${lcFirst(CLUB_TYPE_HINT[type])}.`,
          ...(deptLine ? [deptLine] : []),
          `Placement: ${placement}.${major || focusOther ? ` Focus: ${major?.name ?? focusOther}.` : ""}`,
          `Short description: ${quote(input.short_description, 140)}`,
          actor.kind === "STUDENT" ? "You'll be its President." : "You'll be its advisor (faculty and staff can't hold student roles).",
          `It stays a private draft until you submit it to ${INSTITUTION.studentGovernment}. Next: finish the profile, invite an advisor, and adopt a constitution and bylaws.`,
        ],
        confirmLabel: "Create draft",
      },
      async execute() {
        const r = await createClub(actor, {
          type,
          departmentId,
          requestedDepartmentName,
          name,
          shortDescription: input.short_description.trim(),
          scope: SCOPE[input.placement],
          collegeId: college?.id ?? null,
          focusMajorId: major?.id ?? null,
          focusOther,
        });
        const href = `/clubs/${r.slug}/manage?created=1`;
        return {
          data: { result: "draft created", club: name, workspace: `/clubs/${r.slug}/manage`, next_steps: ["finish the profile", "invite an advisor", "adopt a constitution and bylaws", "submit to WSUSA"] },
          outcome: `Created the draft for ${name}.`,
          href,
          revalidate: ["/dashboard", "/clubs"],
        };
      },
    };
  },
});

// ─── invite_advisor ─────────────────────────────────────────────────────────

const inviteAdvisorTool = writeTool({
  name: "invite_advisor",
  running: "Preparing the advisor invitation",
  description: `Invite a Weber State faculty or staff member (an @${INSTITUTION.staffEmailDomain} email) to advise a club. Allowed for the club's President, Vice President, advisors and WSUSA. Needs confirmation.`,
  schema: z.object({ club: clubRef, name: z.string().min(2).max(100).describe("Their full name"), email: z.string().min(3).max(200).describe(`Their @${INSTITUTION.staffEmailDomain} email`) }),
  async prepare({ actor }, input) {
    const club = await resolveClub(actor, input.club);
    const access = await getClubAccess(actor, club.id);
    if (!access?.canInviteAdvisor) throw new ToolError(`Only ${club.name}'s President, a Vice President, an advisor or WSUSA can invite advisors.`);
    const email = input.email.trim().toLowerCase();
    if (!isStaffEmail(email)) throw new ToolError(`Advisors must be faculty or staff with an @${INSTITUTION.staffEmailDomain} email (not @${INSTITUTION.studentEmailDomain}). Ask for their work email.`);
    const name = input.name.trim();
    const [account, pending] = await Promise.all([
      db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, kind: true } }),
      db.advisorInvite.findFirst({ where: { clubId: club.id, status: "PENDING", email: { equals: email, mode: "insensitive" } }, select: { id: true } }),
    ]);
    if (account?.kind === "STUDENT") throw new ToolError("That's a student account. Advisors must be faculty or staff.");
    if (pending) throw new ToolError(`${name} already has a pending invitation. It can be re-sent from the club workspace (/clubs/${club.slug}/manage).`);
    if (account && (await db.roleAssignment.count({ where: { clubId: club.id, userId: account.id, role: "ADVISOR", endedAt: null } }))) {
      throw new ToolError(`${name} is already an advisor for ${club.name}.`);
    }
    return {
      card: {
        title: `Invite ${name} to advise ${club.name}`,
        details: [
          `Sends an invitation to ${email}.`,
          account ? "They already use Wildcat Clubs, so it also appears in their Tasks." : "They'll sign in with their Weber State Google account to accept — the email explains how.",
          "They become the advisor when they accept, and you'll be notified.",
        ],
        confirmLabel: "Send invite",
      },
      async execute() {
        await inviteAdvisor(actor, club.id, { name, email });
        return {
          data: { result: "invitation sent", to: email, club: club.name },
          outcome: `Invited ${name} to advise ${club.name}.`,
          href: `/clubs/${club.slug}/manage`,
          revalidate: [`/clubs/${club.slug}/manage`],
        };
      },
    };
  },
});

// ─── assign_role ────────────────────────────────────────────────────────────

const CAP_KEYS = Object.keys(CAPABILITIES) as [Capability, ...Capability[]];

const assignRoleTool = writeTool({
  name: "assign_role",
  running: "Preparing the role change",
  description:
    "Put an active student member into a seat on a club's org chart (the same as the Org chart tool). People can assign only roles ranked below their own; the President may also name a President. If the seat is full, say who they replace. Officers get the seat's default permissions unless you pass others. Needs confirmation.",
  schema: z.object({
    club: clubRef,
    seat: z.string().min(1).max(100).describe("Seat name from the org chart, e.g. \"Treasurer\" or \"Vice President\""),
    person: z.string().min(1).max(100).describe("The member's name"),
    permissions: z.array(z.enum(CAP_KEYS)).max(11).optional().describe("Officer/ambassador seats only: permissions to grant instead of the seat's defaults"),
    replace: z.string().max(100).optional().describe("Name of the current holder they replace, when the seat is full"),
  }),
  async prepare({ actor }, input) {
    const club = await resolveClub(actor, input.club);
    const access = await getClubAccess(actor, club.id);
    if (!access) throw new ToolError("That club wasn't found.");
    const seat = await resolveSeat(club.id, input.seat);
    if (!access.assignableRoles.includes(seat.role)) {
      throw new ToolError(
        access.assignableRoles.length
          ? `In ${club.name} they can assign ${access.assignableRoles.map((r) => ROLE_LABEL[r]).join(", ")} roles, but not ${ROLE_LABEL[seat.role]}. People assign only roles ranked below their own; the President may also name a President.`
          : `They can't assign roles in ${club.name}${access.suspended ? " while their permissions are paused" : ""}. The President, a Vice President, an advisor or WSUSA can.`,
      );
    }
    const person = await resolveMember(club.id, input.person);
    if (person.kind !== "STUDENT") throw new ToolError("Club roles are for students. Faculty and staff join a club as advisors.");
    if (person.status !== "ACTIVE") throw new ToolError(`${person.name}'s account isn't active, so they can't take a role.`);
    const holders = await db.roleAssignment.findMany({ where: { positionId: seat.id, endedAt: null }, select: { id: true, userId: true, user: { select: { name: true } } } });
    if (holders.some((h) => h.userId === person.id)) throw new ToolError(`${person.name} already holds ${seat.name}.`);
    let replacing: typeof holders = [];
    if (input.replace?.trim()) {
      const q = input.replace.trim().toLowerCase();
      replacing = holders.filter((h) => h.user.name.toLowerCase().includes(q));
      if (replacing.length !== 1) throw new ToolError(`${seat.name} is held by ${holders.map((h) => h.user.name).join(", ") || "nobody"}. Say exactly which one ${person.name} replaces.`);
    }
    if (holders.length - replacing.length >= seat.maxHolders) {
      throw new ToolError(`${seat.name} is full (${holders.map((h) => h.user.name).join(", ")}; limit ${seat.maxHolders}). Ask who ${person.name} should replace, or choose another seat.`);
    }
    const leadership = seat.role === "PRESIDENT" || seat.role === "VP";
    const permissions = leadership ? undefined : (input.permissions ?? (seat.defaultPermissions.filter((p) => p in CAPABILITIES) as Capability[]));
    const requirements = (await activeRequirements(club.id)).filter((r) => r.appliesTo.includes(seat.role));

    const toolsLine = leadership
      ? seat.role === "PRESIDENT"
        ? "They get every permission, including naming a successor and retiring the club."
        : "They get every permission except assigning President or VP and retiring the club."
      : permissions && permissions.length
        ? `Permissions they get: ${permissions.map((p) => CAPABILITIES[p].label).join(", ")}.`
        : "No permissions yet — you can grant some later in the org chart.";
    return {
      card: {
        title: `Make ${person.name} ${seat.name} of ${club.name}`,
        details: [
          `Role: ${ROLE_LABEL[seat.role]}${seat.name !== ROLE_LABEL[seat.role] ? ` (the ${seat.name} seat)` : ""}.`,
          toolsLine,
          ...(replacing.length ? [`${replacing.map((h) => h.user.name).join(", ")} leaves the seat; the role history records it as a hand-off.`] : []),
          ...(requirements.length ? [`WSUSA requirements for this role: ${requirements.map((r) => `${r.name}${r.graceDays ? ` (within ${r.graceDays} days)` : " (before their permissions work)"}`).join("; ")}.`] : []),
          "They'll be notified, and the role shows on their profile and in the club's role history.",
        ],
        confirmLabel: "Assign role",
      },
      async execute() {
        await assignRole(actor, { clubId: club.id, userId: person.id, positionId: seat.id, permissions, replaceAssignmentIds: replacing.map((h) => h.id) });
        const href = `/clubs/${club.slug}/manage/org-chart`;
        return {
          data: { result: "role assigned", person: person.name, seat: seat.name, club: club.name },
          outcome: `${person.name} is now ${seat.name} of ${club.name}.`,
          href,
          revalidate: [href, `/clubs/${club.slug}`],
        };
      },
    };
  },
});

// ─── post_announcement ──────────────────────────────────────────────────────

const AUDIENCE = { members: "MEMBERS", public: "PUBLIC", leaders: "LEADERS" } as const;

const postAnnouncementTool = writeTool({
  name: "post_announcement",
  running: "Preparing the announcement",
  description:
    "Post an announcement to a club through the Announcements tool. Needs the Announcements permission in an approved club. Write the title and text the person asked for (or drafted with you); the card shows the exact text and how many people are notified, and nothing is posted until they confirm.",
  schema: z.object({
    club: clubRef,
    title: z.string().min(1).max(ANNOUNCEMENT_TITLE_MAX),
    body: z.string().min(1).max(5000).describe("Plain text; a blank line starts a new paragraph"),
    audience: z
      .enum(["members", "public", "leaders"])
      .optional()
      .describe("members = the club's members, officers and advisors (default); public = anyone, and it shows on the public club page (members are notified); leaders = officers, ambassadors, the president, VPs and advisors"),
    pinned: z.boolean().optional().describe("Pin it to the top of the club's announcements"),
  }),
  async prepare(ctx, input) {
    const { actor } = ctx;
    const club = await resolveClub(actor, input.club, { approvedOnly: true });
    await requireClubCap(ctx, club.id, club.name, "announcements");
    const audience = AUDIENCE[input.audience ?? "members"];
    const option = audienceOptions("club", club.name).find((o) => o.value === audience)!;
    const reach = await audienceReach(actor, club.id);
    // The author is never notified about their own post.
    const notified = Math.max(0, reach[audience] - 1);
    const title = input.title.trim();
    const body = input.body.trim();
    return {
      card: {
        title: `Post ${quote(title, 70)} to ${club.name}`,
        details: [
          `Audience: ${option.label} — ${option.description}`,
          notified ? `About ${notified} ${notified === 1 ? "person is" : "people are"} notified (in the app, plus push or email if they've turned those on).` : "Nobody else is notified yet.",
          ...(input.pinned ? ["Pinned to the top of the club's announcements."] : []),
          "You can edit or delete it later in the Announcements tool.",
        ],
        preview: { label: title, text: body },
        confirmLabel: "Post announcement",
      },
      fingerprint: JSON.stringify({ club: club.id, title, body, audience, pinned: Boolean(input.pinned) }),
      async execute() {
        const r = await createClubAnnouncement(actor, club.id, { title, bodyHtml: textToHtml(body) ?? "", audience, pinned: Boolean(input.pinned) });
        const href = `/clubs/${club.slug}#announcements`;
        return {
          data: { result: "announcement posted", announcement_id: r.id, notified: r.notified, link: href },
          outcome: `Posted ${quote(title, 60)} to ${club.name}.`,
          href,
          revalidate: [`/clubs/${club.slug}`, `/clubs/${club.slug}/manage/announcements`, "/dashboard"],
        };
      },
    };
  },
});

export const WRITE_TOOLS = [
  joinClubTool,
  subscribeTool,
  unsubscribeTool,
  addTaskTool,
  updateProfileTool,
  createEventTool,
  postAnnouncementTool,
  startClubTool,
  inviteAdvisorTool,
  assignRoleTool,
];
