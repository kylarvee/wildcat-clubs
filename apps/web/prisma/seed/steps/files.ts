import type { Prisma, SuccessionMethod } from "@prisma/client";
import type { Assignment, ClubM, Ctx } from "../ctx";
import { makeFlyerSvg, makePdf, type PdfBlock } from "../lib/assets";
import { MINUTES_ITEMS } from "../data/text";
import { addDays, DAY, human, minDate, monthDay, ymd } from "../lib/dates";
import { createRng, type Rng } from "../lib/rng";
import { addFile, addFolder, addPdf } from "./filehelp";
import { mayGraduation } from "./reference";
import { PSYCH_BYLAWS } from "./community";
import { defaultDraftData, type DraftData } from "@/lib/constitution/templates";
import { docToHtml, plain, renderDoc, type RenderedDoc } from "@/lib/constitution/render";
import { settingsChangeNotice } from "@/lib/constitution/rules";

/**
 * Club Files (a folder tree per club with minutes, flyers, featured resources,
 * constitution PDFs and leaders-only notes), constitution documents and
 * drafts, university training files, and profile projects and experience.
 */

const RESOURCE: Record<string, [string, PdfBlock[]]> = {
  robotics: ["Makerspace Safety Checklist", [{ heading: "Before you start", bullets: ["Safety glasses on whenever any tool is running", "Hair tied back, no loose sleeves or jewelry", "Know where the fire extinguisher and first aid kit are (north door)"] }, { heading: "Batteries", bullets: ["Charge LiPos only in the fire-safe bags", "Puffy battery? Stop, bin it, tell an officer"] }, { heading: "Power tools", bullets: ["CNC and lathe need sign-off training", "Never run the CNC alone"] }]],
  premed: ["MCAT Study Plan", [{ heading: "Twelve-week plan", bullets: ["Weeks 1-4: content review (bio/biochem, chem/phys)", "Weeks 5-8: passages and practice sections", "Weeks 9-12: full-length practice tests every Saturday"] }, { heading: "Club resources", text: "The club lends MCAT prep book sets — ask an officer. Study nights are on the calendar." }]],
  theatre: ["Audition Guide", [{ heading: "Preparing", bullets: ["Pick a one-minute contemporary monologue", "Bring a headshot if you have one (not required)", "Check the callboard for callbacks"] }, { heading: "Crew", text: "Not an actor? Every production needs stage managers, designers and run crew. Sign up on the crew sheet." }]],
  climbing: ["Trip Safety & Waiver Guide", [{ heading: "Before every trip", bullets: ["Campus Rec waiver on file", "The ten essentials in every pack, including water and a headlamp", "Trip leader has the route, the emergency plan and a first aid kit"] }]],
  ski: ["Road Trip Guide", [{ heading: "Before every away-game trip", bullets: ["Waiver on file", "Carpool drivers approved through Campus Rec", "Check UDOT road conditions before you leave"] }]],
};

const GENERIC_RESOURCE: [string, PdfBlock[]] = [
  "New Member Guide",
  [
    { heading: "Welcome!", text: "Thanks for joining. This guide covers how the club works and how to get involved." },
    { heading: "Getting involved", bullets: ["Check in with the QR code at every event — it's how we track attendance and how you unlock reviews", "Subscribe to the club calendar", "Say hi in the club chat"] },
    { heading: "Leadership", text: "Officers are chosen each spring. Our bylaws (under Resources) explain how. Talk to any officer if you're interested." },
  ],
];

/** `method`: the primary method the documents named (an earlier version may differ from today's). */
function constitutionBlocks(club: ClubM, method: SuccessionMethod = club.def.succession ?? "ADVISOR_PRESIDENT"): { constitution: PdfBlock[]; bylaws: PdfBlock[] } {
  const d = club.def;
  const typeLabel = { SPONSORED: "Sponsored", AFFILIATE: "Affiliate", REGISTERED: "Registered", COLLEGE_AMBASSADORS: "College Ambassadors" }[club.type];
  const seats = [...club.seats.values()].filter((s) => s.role !== "AMBASSADOR" || club.type === "COLLEGE_AMBASSADORS").map((s) => s.name);
  const primary = {
    ADVISOR_PRESIDENT: "The club's primary method is Advisor & President: when a seat needs filling, the President or the advisor proposes one candidate and the other confirms.",
    NEXT_IN_LINE: "The club's primary method is Next in line: when a seat opens, the people in the seats just below it are asked whether they will move up, and the first in line who says yes takes the seat.",
    SELF_SELECT: "The club's primary method is Self-select: the current leaders choose by secret ballot in Wildcat Clubs, never voting for themselves, and the choice counts only if it is unanimous.",
    MEMBER_VOTE: "The club's primary method is Member vote: active members elect leaders each spring by secret ballot in Wildcat Clubs.",
  }[method];
  const succession = `${primary} The President and the advisor may use one of the other methods Wildcat Clubs offers (Advisor & President, Next in line, Self-select or Member vote) for a particular seat, at their discretion. The people on the Org Chart below a seat are its first candidates, and results are applied through the Org Chart.`;
  return {
    constitution: [
      { heading: "Article I - Name", text: `The name of this organization is ${d.name}, a ${typeLabel} club at Weber State University.` },
      { heading: "Article II - Purpose", text: d.about },
      { heading: "Article III - Membership", text: "Membership is open to all currently enrolled Weber State students. The club does not discriminate on the basis of race, color, ethnic or national origin, religion, sex, sexual orientation, gender identity, age, disability or veteran status." },
      { heading: "Article IV - Officers", text: `The club's leadership positions are: ${seats.join(", ")}. Officers must be enrolled students and complete WSUSA officer requirements each academic year.` },
      { heading: "Article V - Advisor", text: "The club has at least one Weber State faculty or staff advisor, who has full access to club tools and helps the club follow university policy." },
      { heading: "Article VI - Amendments", text: "This constitution may be amended by a two-thirds vote of active members present at a meeting announced at least one week in advance, subject to WSUSA approval." },
    ],
    bylaws: [
      { heading: "Section 1 - Meetings", text: `The club meets ${d.meeting.interval === 2 ? "every other week" : "weekly"} during fall and spring semesters. Quorum is one third of active members.` },
      { heading: "Section 2 - Succession and elections", text: succession },
      { heading: "Section 3 - Duties", text: "Officer responsibilities are listed on each seat in the club's Org Chart and may be updated by the President or Vice President." },
      { heading: "Section 4 - Removal", text: "An officer may be removed by a two-thirds vote of the other officers after a conversation with the advisor." },
      { heading: "Section 5 - Finances", text: "The Treasurer keeps the club budget in Wildcat Clubs and submits funding requests before purchases, following WSUSA's Funding & Purchasing policy." },
    ],
  };
}

const toHtml = (blocks: PdfBlock[]) =>
  blocks.map((b) => `${b.heading ? `<h3>${b.heading.replace(" - ", " — ")}</h3>` : ""}${b.text ? `<p>${b.text}</p>` : ""}${b.bullets ? `<ul>${b.bullets.map((x) => `<li>${x}</li>`).join("")}</ul>` : ""}`).join("");

/** The constitution builder's own default draft, so seeded drafts open exactly as new ones do. */
function builderDraftData(succession: SuccessionMethod): Prisma.InputJsonValue {
  return defaultDraftData({ successionMethod: succession }) as unknown as Prisma.InputJsonValue;
}

/**
 * The builder answers an adopted document keeps (ClubDocument.builderAnswers):
 * the builder's defaults with the club's join policy and primary method, as
 * adopting them set. Any leader with the Constitution permission can start a
 * draft from them, and the engines read the bylaw rules from them.
 */
function answersFor(club: ClubM, succession: SuccessionMethod = club.def.succession ?? "ADVISOR_PRESIDENT"): DraftData {
  return defaultDraftData({ successionMethod: succession, joinPolicy: club.def.joinPolicy ?? "OPEN" });
}
const answersJson = (d: DraftData) => d as unknown as Prisma.InputJsonValue;

/** A club that adopted new documents with the builder recently: its earlier ones, which named `from` as the primary method, were superseded then. */
type Readopt = { at: Date; by: string; from: SuccessionMethod; answers: DraftData };

/** A rendered builder document as seed PDF blocks (one page: whatever doesn't fit is left off, as for every seed PDF). */
function pdfBlocks(doc: RenderedDoc): PdfBlock[] {
  return [
    { text: plain(doc.preamble) },
    ...doc.articles.flatMap((a) => a.blocks.map((b, i): PdfBlock => ({ ...(i === 0 ? { heading: `Article ${a.roman} - ${a.title}` } : {}), ...(b.type === "p" ? { text: plain(b.text) } : { bullets: b.items.map(plain) }) }))),
  ];
}

/**
 * The new versions a re-adoption put in effect, rendered by the builder
 * itself from the answers they keep, and what adopting them did: the
 * activity rows, the Constitution-permission holders' notice, and, since the
 * primary method changed, the change notice for members and WSUSA
 * (lib/domain/constitution announceSettingsChange).
 */
function readoptedDocuments(ctx: Ctx, club: ClubM, folderId: string, scope: { clubId: string; dir: string }, r: Readopt) {
  const facts = { name: club.name, type: club.type, departmentName: club.def.department ?? null, collegeName: club.collegeKey ? (ctx.colleges.get(club.collegeKey)?.name ?? null) : null };
  const versions = { constitution: 0, bylaws: 0 };
  for (const [kind, docKind, label] of [["constitution", "CONSTITUTION", "Constitution"], ["bylaws", "BYLAWS", "Bylaws"]] as const) {
    const version = Math.max(0, ...ctx.rows.documents.filter((d) => d.clubId === club.id && d.kind === docKind).map((d) => d.version ?? 0)) + 1;
    const rendered = renderDoc(kind, r.answers, facts);
    const file = addPdf(ctx, scope, `${club.slug}-${kind}-v${version}.pdf`, { title: rendered.title, subtitle: `Version ${version} · adopted ${monthDay(r.at)}, ${r.at.getUTCFullYear()}`, blocks: pdfBlocks(rendered), footer: `${club.name} · adopted through the Wildcat Clubs Constitution Builder` }, { parentId: folderId, createdById: r.by, createdAt: r.at });
    ctx.rows.documents.push({ id: ctx.id(), clubId: club.id, kind: docKind, title: label, version, source: "BUILDER", status: "ACTIVE", draftId: null, contentHtml: docToHtml(rendered), builderAnswers: answersJson(r.answers), fileId: file, createdById: r.by, createdAt: r.at, decidedAt: r.at });
    versions[kind] = version;
  }

  const by = ctx.person(r.by);
  const to = r.answers.fields.successionMethod as SuccessionMethod;
  const joinPolicy = club.def.joinPolicy ?? "OPEN";
  ctx.activity({ at: r.at, actorId: r.by, action: "constitution.adopted", entityType: "club", entityId: club.id, clubId: club.id, data: { draftId: null, constitutionVersion: versions.constitution, bylawsVersion: versions.bylaws, joinPolicy, successionMethod: to, previous: { joinPolicy, successionMethod: r.from } }, isPublic: true });
  ctx.activity({ at: r.at, actorId: r.by, action: "constitution.settings_changed", entityType: "club", entityId: club.id, clubId: club.id, data: { via: "adopted", joinPolicy: null, successionMethod: { from: r.from, to } } });
  const manage = `/clubs/${club.slug}/manage/constitution`;
  for (const userId of ctx.capabilityHoldersAt(club, "constitution", r.at).filter((id) => id !== r.by)) {
    ctx.rows.notifications.push({ id: ctx.id(), userId, kind: "constitution.adopted", title: `${club.name} adopted a new constitution and bylaws`, body: `${by.name} adopted version ${versions.constitution} of the constitution and version ${versions.bylaws} of the bylaws.`, href: manage, createdAt: r.at, readAt: addDays(r.at, 0.4) });
  }
  // Every member then hears what changed, and so does WSUSA. Maya hasn't opened hers yet.
  const notice = settingsChangeNotice(club.name, { joinPolicy: null, successionMethod: { from: r.from, to } }, { kind: "adopted", by: by.name });
  const maya = ctx.p("maya").id;
  const members = club.members.filter((m) => m.userId !== r.by && ctx.memberAt(club, m.userId, r.at)).map((m) => m.userId);
  for (const userId of members) {
    ctx.rows.notifications.push({ id: ctx.id(), userId, kind: "constitution.settings_changed", title: notice.title, body: notice.body, href: `/clubs/${club.slug}`, createdAt: r.at, readAt: userId === maya ? null : addDays(r.at, 0.6) });
  }
  for (const admin of ctx.admins) {
    ctx.rows.notifications.push({ id: ctx.id(), userId: admin.id, kind: "constitution.settings_changed", title: notice.title, body: notice.body, href: `/admin/clubs/${club.id}`, createdAt: r.at, readAt: addDays(r.at, 1) });
  }
}

/**
 * Psi Chi (psych) adopted new bylaws about four weeks before the seed: it
 * switched from Advisor & President to member votes, with an attendance
 * requirement and a quorum. The President vote running now (lib/domain/
 * elections, seeded in community.ts) froze those rules.
 */
function psychReadopt(ctx: Ctx, club: ClubM): Readopt {
  const at = addDays(ctx.NOW, -PSYCH_BYLAWS.adoptedDaysAgo);
  const answers = answersFor(club, "MEMBER_VOTE");
  answers.modules.bylaws = [...answers.modules.bylaws, "voteAttendance"];
  answers.fields.voteMinEvents = String(PSYCH_BYLAWS.minEvents);
  answers.fields.quorumPercent = String(PSYCH_BYLAWS.quorumPercent);
  return { at, by: ctx.leaderAt(club, at), from: "ADVISOR_PRESIDENT", answers };
}

function clubDocuments(ctx: Ctx, club: ClubM, folderId: string, scope: { clubId: string; dir: string }, opts: { draftId?: string | null; v2?: boolean; readopt?: Readopt }) {
  const { rng } = ctx;
  const earlier = opts.readopt?.from;
  const blocks = constitutionBlocks(club, earlier);
  const answers = answersJson(answersFor(club, earlier));
  // Re-adopted since: what was in effect until then is superseded.
  const kept = opts.readopt ? { status: "SUPERSEDED" as const, decidedAt: opts.readopt.at } : { status: "ACTIVE" as const, decidedAt: null };
  const firstAt = addDays(club.createdAt, rng.float(1, 4));
  const author = club.founderId;
  const footer = `${club.name} · adopted through the Wildcat Clubs Constitution Builder`;
  const docs: [string, "CONSTITUTION" | "BYLAWS", PdfBlock[]][] = [
    ["Constitution", "CONSTITUTION", blocks.constitution],
    ["Bylaws", "BYLAWS", blocks.bylaws],
  ];
  for (const [label, kind, b] of docs) {
    if (opts.v2 && kind === "CONSTITUTION") {
      const oldFile = addPdf(ctx, scope, `${label} (${firstAt.getUTCFullYear()}).pdf`, { title: `${club.name} ${label}`, subtitle: `Version 1 · adopted ${monthDay(firstAt)}, ${firstAt.getUTCFullYear()}`, blocks: b.slice(0, -1), footer }, { parentId: folderId, createdById: author, createdAt: firstAt });
      ctx.rows.documents.push({ id: ctx.id(), clubId: club.id, kind, title: `${club.name} ${label}`, version: 1, source: "BUILDER", status: "SUPERSEDED", draftId: opts.draftId ?? null, contentHtml: toHtml(b.slice(0, -1)), builderAnswers: answers, fileId: oldFile, createdById: author, createdAt: firstAt, decidedAt: null });
      const at = minDate(addDays(club.approvedAt ?? club.createdAt, rng.float(300, 500)), addDays(ctx.NOW, -20));
      const by = ctx.leaderAt(club, at);
      const file = addPdf(ctx, scope, `${label}.pdf`, { title: `${club.name} ${label}`, subtitle: `Version 2 · adopted ${monthDay(at)}, ${at.getUTCFullYear()}`, blocks: b, footer }, { parentId: folderId, createdById: by, createdAt: at });
      ctx.rows.documents.push({ id: ctx.id(), clubId: club.id, kind, title: `${club.name} ${label}`, version: 2, source: "BUILDER", status: kept.status, draftId: null, contentHtml: toHtml(b), builderAnswers: answers, fileId: file, createdById: by, createdAt: at, decidedAt: kept.decidedAt });
      continue;
    }
    const file = addPdf(ctx, scope, `${label}.pdf`, { title: `${club.name} ${label}`, subtitle: `Adopted ${monthDay(firstAt)}, ${firstAt.getUTCFullYear()}`, blocks: b, footer }, { parentId: folderId, createdById: author, createdAt: firstAt });
    ctx.rows.documents.push({ id: ctx.id(), clubId: club.id, kind, title: `${club.name} ${label}`, version: 1, source: "BUILDER", status: kept.status, draftId: opts.draftId ?? null, contentHtml: toHtml(b), builderAnswers: answers, fileId: file, createdById: author, createdAt: firstAt, decidedAt: kept.decidedAt });
  }
  if (opts.readopt) readoptedDocuments(ctx, club, folderId, scope, opts.readopt);
}

function minutesMd(ctx: Ctx, club: ClubM, at: Date, present: number) {
  const { rng } = ctx;
  const officers = club.assignments.filter((a) => a.startedAt <= at && (!a.endedAt || a.endedAt > at) && a.role !== "ADVISOR" && a.role !== "AMBASSADOR").map((a) => `${ctx.person(a.userId).name} (${a.seatName})`);
  const items = rng.sample(MINUTES_ITEMS, 4);
  return `# ${club.name} — Meeting Minutes

**Date:** ${human(at)}
**Location:** ${ctx.buildings.get(club.def.meeting.building)?.name ?? "Shepherd Union"}, ${club.def.meeting.room}
**Checked in:** ${present} people
**Officers present:** ${officers.slice(0, 5).join(", ") || "—"}

## Notes
${items.map((x) => `- ${x}`).join("\n")}

## Action items
- [ ] ${rng.pick(["Post the next event on the calendar", "Send the flyer to the college ambassador", "Update the budget with this week's receipts", "Book the room for next month"])}
- [ ] ${rng.pick(["Follow up with new members", "Draft the announcement for next week", "Check the co-host request in tasks", "Upload photos to Flyers & Photos"])}
`;
}

function clubFiles(ctx: Ctx, club: ClubM, drafts: Map<string, string>) {
  const { rng, NOW } = ctx;
  const scope = { clubId: club.id, dir: club.slug };
  const base = addDays(club.approvedAt ?? club.createdAt, 1.5);
  const by = ctx.leaderAt(club, base);
  const f = (name: string, visibility?: "PUBLIC" | "LEADERS") => addFolder(ctx, scope, name, { createdById: by, createdAt: base, visibility });
  if (club.def.life === "dormant") {
    // A dormant club still has the constitution and bylaws it was approved with, and little else.
    clubDocuments(ctx, club, f("Constitution & Bylaws", "PUBLIC"), scope, { draftId: null });
    return;
  }
  const minutes = f("Meeting Minutes");
  const flyers = f("Flyers & Photos", "PUBLIC");
  const resources = f("Resources", "PUBLIC");
  const constitution = f("Constitution & Bylaws", "PUBLIC");
  const notes = f("Officer Notes", "LEADERS");

  // Minutes from recent meetings with check-ins.
  const meetings = club.events.filter((e) => e.isSeries).flatMap((e) => e.occurrences).filter((o) => o.status === "SCHEDULED" && o.startsAt < NOW && o.attendees.size > 0).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  for (const o of meetings.slice(0, club.def.life === "inactive" ? 2 : club.def.story ? rng.int(3, 5) : rng.int(1, 3))) {
    const secretary = ctx.holderAt(club, "Secretary", o.startsAt) ?? ctx.leaderAt(club, o.startsAt);
    addFile(ctx, scope, `Minutes ${ymd(o.startsAt)}.md`, minutesMd(ctx, club, o.startsAt, o.attendees.size), "text/markdown", {
      parentId: minutes, createdById: secretary, createdAt: minDate(addDays(o.endsAt, rng.float(0.2, 2)), NOW), diskName: `minutes-${ymd(o.startsAt)}.md`,
    });
  }

  // Flyers for the next or most recent one-off events.
  const oneOffs = club.events.filter((e) => !e.isSeries && e.status === "SCHEDULED" && e.startsAt).sort((a, b) => Math.abs(a.startsAt!.getTime() - NOW.getTime()) - Math.abs(b.startsAt!.getTime() - NOW.getTime()));
  for (const ev of oneOffs.slice(0, club.def.life === "inactive" || !club.def.story ? 1 : 2)) {
    const where = ev.locationType === "CAMPUS" ? `${ctx.buildings.get(ev.buildingCode ?? "SU")?.name ?? ""} · ${ev.room ?? ""}` : ev.locationType === "VIRTUAL" ? "Online (Google Meet)" : (ev.address ?? "").split(",")[0];
    const svg = makeFlyerSvg({ club: club.name, title: ev.title, when: human(ev.startsAt!), where, color: club.def.color, tagline: club.def.short.split("—")[0].slice(0, 60) });
    const fileId = addFile(ctx, scope, `${ev.title} flyer.svg`, svg, "image/svg+xml", { parentId: flyers, createdById: ev.createdById, createdAt: ev.createdAt });
    ctx.rows.attachments.push({ eventId: ev.id, fileId });
  }

  // Featured resources (listed on the club page).
  const [rTitle, rBlocks] = RESOURCE[club.def.key] ?? GENERIC_RESOURCE;
  addPdf(ctx, scope, `${rTitle}.pdf`, { title: rTitle, subtitle: club.name, blocks: rBlocks, footer: `${club.name} · Wildcat Clubs` }, { parentId: resources, featured: true, createdById: by, createdAt: addDays(base, 3) });
  if (RESOURCE[club.def.key]) {
    addPdf(ctx, scope, `${GENERIC_RESOURCE[0]}.pdf`, { title: GENERIC_RESOURCE[0], subtitle: club.name, blocks: GENERIC_RESOURCE[1], footer: `${club.name} · Wildcat Clubs` }, { parentId: resources, featured: true, createdById: by, createdAt: addDays(base, 4) });
  }

  clubDocuments(ctx, club, constitution, scope, {
    draftId: drafts.get(club.def.key) ?? null,
    v2: club.createdAt < new Date("2024-01-01T00:00:00Z") && rng.chance(0.3),
    readopt: club.def.key === "psych" ? psychReadopt(ctx, club) : undefined,
  });

  // Leaders-only notes.
  const ay = ctx.academicYear(NOW).label;
  addFile(ctx, scope, "Officer handbook.md", `# ${club.name} — Officer handbook\n\n- Weekly officer check-in after the general meeting\n- Budget lives in Wildcat Clubs → Budget & funding; submit requests two weeks ahead\n- Minutes go in Meeting Minutes within two days\n- Officer requirements: Club Officer Policy Test + Club Officer Training each year\n`, "text/markdown", { parentId: notes, createdById: by, createdAt: addDays(base, 5) });
  if (club.status === "APPROVED") {
    const pres = ctx.leaderAt(club, addDays(NOW, -30));
    addFile(ctx, scope, `Transition notes ${ay}.md`, `# Transition notes (${ay})\n\n## What went well\n- ${rng.pick(["Turnout at the first meetings", "Co-hosted events", "Our service day"])}\n\n## Watch out for\n- ${rng.pick(["Room bookings fill up early in September", "Funding requests take about ten days", "Keep the officer requirement deadlines on your calendar"])}\n`, "text/markdown", {
      parentId: notes, createdById: pres, createdAt: addDays(NOW, -rng.float(5, 40)),
    });
  }
}

type Contribution = { title: string; html: string };

/** What a past leader might have left behind in their seat (one of these per pick). */
const SEAT_IDEAS: Record<string, Contribution[]> = {
  President: [
    { title: "Fall recruitment drive", html: "<p>Planned the fall recruitment push: an involvement fair table, a first-week social and follow-up emails that turned sign-ups into regulars.</p>" },
    { title: "Officer transition handbook", html: "<p>Wrote the handbook the next officer team started from: who owns what, the yearly calendar and how funding requests work.</p>" },
    { title: "Campus partnership program", html: "<p>Set up a standing partnership with a campus department, so members got speakers, space and project ideas every semester.</p>" },
  ],
  "Vice President": [
    { title: "Semester event plan", html: "<p>Built the semester's event plan with the officers, booked rooms early and kept the club calendar current.</p>" },
    { title: "New member onboarding", html: "<p>Ran the welcome table and paired each new member with an officer for their first month.</p>" },
  ],
  Treasurer: [{ title: "Budget and funding requests", html: "<p>Kept the club's budget in Wildcat Clubs and wrote the funding requests that paid for the year's events.</p>" }],
  Secretary: [{ title: "Meeting minutes archive", html: "<p>Took and posted minutes for every general meeting, so members who missed one could catch up.</p>" }],
  "Communications Officer": [{ title: "Flyer and social media series", html: "<p>Designed the flyers and posts for the semester's events and grew the club's following.</p>" }],
  "Membership Officer": [{ title: "Member check-in program", html: "<p>Followed up with members who drifted away and started the welcome-back social each semester.</p>" }],
};

const OFFICER_IDEAS: Contribution[] = [
  { title: "Club newsletter", html: "<p>Started a short monthly newsletter with upcoming events, member spotlights and photos.</p>" },
  { title: "Volunteer roster", html: "<p>Kept a roster of members who could help at events, so no event ran short-handed.</p>" },
];

function contributionFor(club: ClubM, a: Assignment, r: Rng): Contribution {
  // Prefer a real event the club held during the term: the holder organized it.
  const events = club.events.filter((e) => !e.isSeries && e.status === "SCHEDULED" && e.startsAt && e.startsAt > a.startedAt && e.startsAt < a.endedAt! && e.occurrences.some((o) => o.attendees.size > 0));
  if (events.length && (a.seatName === "Events Coordinator" || r.chance(0.35))) {
    const ev = r.pick(events);
    return { title: ev.title, html: `<p>Organized ${ev.title} (${monthDay(ev.startsAt!)}, ${ev.startsAt!.getUTCFullYear()}): booked the space, lined up volunteers and ran check-in at the door.</p>` };
  }
  return r.pick(SEAT_IDEAS[a.seatName ?? ""] ?? (a.role === "PRESIDENT" ? SEAT_IDEAS.President : a.role === "VP" ? SEAT_IDEAS["Vice President"] : OFFICER_IDEAS));
}

type AddProject = (userId: string, assignmentId: string, clubId: string, title: string, html: string, start: Date, end: Date | null, files: string[]) => void;

/**
 * Role history shows the work, not just the titles: one or two past leaders
 * per club get a contribution tied to the seat they held, with up to two club
 * files they made during the term. Personas are left as PERSONAS.md describes.
 */
function roleContributions(ctx: Ctx, proj: AddProject) {
  const r = createRng(17102026); // its own stream, so the rest of the seed comes out the same
  const leadersOnly = new Set(ctx.rows.files.filter((f) => f.isFolder && f.visibility === "LEADERS").map((f) => f.id as string));
  for (const club of ctx.clubs) {
    if (club.status !== "APPROVED" && club.status !== "RETIRED") continue;
    const past = club.assignments.filter(
      (a) => a.endedAt && (a.role === "PRESIDENT" || a.role === "VP" || a.role === "OFFICER") && a.endedAt.getTime() - a.startedAt.getTime() > 60 * DAY && !ctx.person(a.userId).persona,
    );
    for (const a of r.sample(past, r.int(1, 2))) {
      const end = a.endedAt!;
      const files = ctx.rows.files
        .filter((f) => f.clubId === club.id && !f.isFolder && f.createdById === a.userId && !leadersOnly.has(f.parentId ?? "") && (f.createdAt as Date) >= a.startedAt && (f.createdAt as Date) <= end)
        .map((f) => f.id as string);
      const idea = contributionFor(club, a, r);
      const start = addDays(a.startedAt, r.float(7, 30));
      const finish = minDate(addDays(start, r.float(60, 200)), end);
      if (!files.length && r.chance(0.6)) {
        // No club file from the term: a write-up in the holder's own files, as the contribution dialog's uploads are.
        const holder = ctx.person(a.userId);
        files.push(
          addPdf(ctx, { ownerId: holder.id, dir: `users/${holder.handle}` }, `${idea.title} - summary.pdf`, {
            title: idea.title, subtitle: `${club.name} · ${a.seatName ?? "Officer"}, ${monthDay(finish)}, ${finish.getUTCFullYear()}`,
            blocks: [{ heading: "What we did", text: idea.html.replace(/<[^>]+>/g, "") }], footer: "Sample file for user testing",
          }, { createdById: holder.id, createdAt: finish, visibility: "MEMBERS" }),
        );
      }
      proj(a.userId, a.id, club.id, idea.title, idea.html, start, finish, r.sample(files, 2));
    }
  }
}

export function buildFiles(ctx: Ctx) {
  const { rng, NOW } = ctx;
  const alex = ctx.p("alex").id;

  // ─── University files: training materials ─────────────────────────────────
  const uni = { dir: "university" };
  const trainings = addFolder(ctx, uni, "Trainings", { createdById: alex, createdAt: addDays(NOW, -420), visibility: "INHERIT" });
  const slides = addPdf(ctx, uni, "Club Officer Training slides.pdf", {
    title: "Club Officer Training", subtitle: "WSUSA Clubs & Organizations · sample slides",
    blocks: [
      { heading: "Agenda", bullets: ["Your role and the Wildcat Clubs tools", "Funding & purchasing", "Event safety", "Hazing and non-discrimination", "Reporting concerns", "Q&A"] },
      { heading: "Requirements", text: "Officers, VPs and presidents attend one training session and pass the Club Officer Policy Test each academic year." },
      { heading: "Contacts", text: "WSUSA Clubs & Organizations, Shepherd Union." },
    ],
    footer: "Sample training material for user testing",
  }, { parentId: trainings, createdById: alex, createdAt: addDays(NOW, -400) });
  ctx.rows.attachments.push({ eventId: ctx.refs.trainingEventId, fileId: slides });
  const handout = addPdf(ctx, uni, "Funding Workshop handout.pdf", {
    title: "Funding Workshop", subtitle: "How club funding works at Weber State (sample)",
    blocks: [
      { heading: "Steps", bullets: ["Enter event costs in the Events Builder", "Enter general costs in the Budget tool", "Submit a request two weeks before purchase", "After approval, WSUSA issues an invoice"] },
      { heading: "Not eligible", bullets: ["Alcohol", "Gift cards for officers", "Personal entertainment"] },
    ],
    footer: "Sample handout for user testing",
  }, { parentId: trainings, createdById: alex, createdAt: addDays(NOW, -390) });
  ctx.rows.attachments.push({ eventId: ctx.refs.fundingWorkshopId, fileId: handout });

  // ─── Constitution drafts (owned by founders) ──────────────────────────────
  const drafts = new Map<string, string>();
  const frank = ctx.p("frank").id;
  const draft = (ownerId: string, title: string, succession: SuccessionMethod, createdAt: Date, updatedAt: Date) => {
    const id = ctx.id();
    ctx.rows.drafts.push({ id, ownerId, title, data: builderDraftData(succession), successionMethod: succession, createdAt, updatedAt });
    return id;
  };
  const bg = ctx.club("boardgames");
  drafts.set("boardgames", draft(frank, `${bg.name} — constitution & bylaws`, "ADVISOR_PRESIDENT", addDays(bg.createdAt, 2), addDays(NOW, -12.3)));
  draft(frank, `${ctx.club("beekeeping").name} — draft`, "ADVISOR_PRESIDENT", addDays(NOW, -8.1), addDays(NOW, -1.4));
  for (const key of ["datasci", "firstgen", "pickleball", "aviation"]) {
    const club = ctx.club(key);
    drafts.set(key, draft(club.founderId, `${club.name} — constitution & bylaws`, club.def.succession ?? "ADVISOR_PRESIDENT", addDays(club.createdAt, 1), addDays(club.createdAt, rng.float(2, 5))));
  }

  // ─── Club files ────────────────────────────────────────────────────────────
  for (const club of ctx.clubs) {
    if (club.status === "APPROVED" || club.status === "RETIRED") clubFiles(ctx, club, drafts);
  }
  for (const key of ["boardgames", "aviation"]) {
    const club = ctx.club(key);
    const scope = { clubId: club.id, dir: club.slug };
    const folder = addFolder(ctx, scope, "Constitution & Bylaws", { createdById: club.founderId, createdAt: addDays(club.createdAt, 1), visibility: "PUBLIC" });
    clubDocuments(ctx, club, folder, scope, { draftId: drafts.get(key) ?? null });
    if (key === "boardgames") {
      // Adopted recently, right before submitting.
      for (const d of ctx.rows.documents.filter((x) => x.clubId === club.id)) d.createdAt = addDays(NOW, -12.3);
      const res = addFolder(ctx, scope, "Resources", { createdById: frank, createdAt: addDays(club.createdAt, 3), visibility: "PUBLIC" });
      addFile(ctx, scope, "Puzzle shelf list.md", `# ${club.name} lending shelf\n\n- 1000-piece jigsaws (14)\n- 500-piece jigsaws (9)\n- Crossword collections (6)\n- Logic puzzle books (5)\n- Mechanical puzzles (8)\n- …and more as members donate (full list coming)\n`, "text/markdown", { parentId: res, createdById: frank, createdAt: addDays(club.createdAt, 4) });
    }
  }
  const bee = ctx.club("beekeeping");
  addFile(ctx, { clubId: bee.id, dir: bee.slug }, "Interest list.md", "# Beekeeping interest list\n\nPeople who signed up at the Involvement Fair:\n\n- (12 names — moving these to the roster once we're approved)\n\nQuestions for Facilities:\n- Can hives go on the Tracy Hall roof garden?\n", "text/markdown", { createdById: frank, createdAt: addDays(NOW, -8.5) });

  // ─── AAT (theatre): custom bylaws waiting on WSUSA ─────────────────────────
  const theatre = ctx.club("theatre");
  const tPres = ctx.leaderAt(theatre, NOW);
  const tFolder = ctx.rows.files.find((x) => x.clubId === theatre.id && x.isFolder && x.name === "Constitution & Bylaws")!.id as string;
  const customFile = addFile(ctx, { clubId: theatre.id, dir: theatre.slug }, "AAT Bylaws - custom draft (2026).pdf",
    makePdf(`${theatre.name} Bylaws (custom)`, "Proposed replacement for the builder bylaws · submitted for WSUSA approval", [
      { heading: "Why a custom version", text: "After four years we need bylaws that fit how productions actually run: a production manager seat, casting rules and crew sign-ups." },
      { heading: "Section 1 - Production Manager", text: "A Production Manager is appointed for each show by the President and Vice President." },
      { heading: "Section 2 - Casting", text: "Casting is done by the show's student director with one officer present. Officers do not cast themselves." },
      { heading: "Section 3 - Succession", text: "Officers are chosen by a vote of members who worked on at least one production that year." },
    ], "Submitted through Wildcat Clubs"),
    "application/pdf", { parentId: tFolder, createdById: tPres, createdAt: addDays(NOW, -4.2) });
  const customDocId = ctx.id();
  ctx.rows.documents.push({
    // Pending uploads stay unnumbered (version 0) until WSUSA approves them. Bylaws state only the succession method; joining isn't theirs to change.
    id: customDocId, clubId: theatre.id, kind: "BYLAWS", title: `${theatre.name} Bylaws (custom, 2026)`, version: 0, source: "CUSTOM_UPLOAD", status: "PENDING_APPROVAL",
    statedSuccessionMethod: "MEMBER_VOTE", statedJoinPolicy: null, note: "Adds a Production Manager seat and member votes for officers.",
    draftId: null, contentHtml: null, fileId: customFile, createdById: tPres, createdAt: addDays(NOW, -4.2), decidedAt: null,
  });
  ctx.refs.customDocId = customDocId;

  // ─── Profiles: experience, education and projects ─────────────────────────
  const maya = ctx.p("maya").id;
  ctx.rows.experiences.push(
    { id: ctx.id(), userId: maya, title: "Barista", organization: "Shepherd Union Coffee Bar", location: "Ogden, UT", startDate: new Date("2024-08-19T15:00:00Z"), endDate: null, description: "Morning shifts during the semester. Trained four new baristas.", source: "MANUAL", createdAt: new Date("2024-09-02T15:00:00Z") },
    { id: ctx.id(), userId: maya, title: "Summer Research Intern", organization: "Sleep & Memory Lab, Weber State Department of Psychology", location: "Ogden, UT", startDate: new Date("2026-06-01T15:00:00Z"), endDate: new Date("2026-08-07T15:00:00Z"), description: "Ran participant sessions and cleaned actigraphy data for a study on sleep and exam performance.", source: "MANUAL", createdAt: new Date("2026-08-10T15:00:00Z") },
  );
  ctx.rows.educations.push({ id: ctx.id(), userId: maya, school: "Bonneville High School", degree: "High School Diploma", field: null, startYear: 2019, endYear: 2023, description: "Concurrent enrollment in psychology and Spanish through Weber State." });

  const gwen = ctx.p("gwen").id;
  ctx.rows.experiences.push(
    { id: ctx.id(), userId: gwen, title: "Junior Data Analyst", organization: "Wasatch Analytics Group", location: "Salt Lake City, UT", startDate: new Date("2026-06-15T15:00:00Z"), endDate: null, description: "Dashboards and forecasting for healthcare clients.", source: "LINKEDIN_IMPORT", createdAt: new Date("2026-07-01T15:00:00Z") },
    { id: ctx.id(), userId: gwen, title: "Data Analytics Intern", organization: "Weber State Office of Institutional Research", location: "Ogden, UT", startDate: new Date("2025-05-12T15:00:00Z"), endDate: new Date("2025-08-15T15:00:00Z"), description: null, source: "LINKEDIN_IMPORT", createdAt: new Date("2026-07-01T15:00:00Z") },
  );
  ctx.rows.educations.push(
    { id: ctx.id(), userId: gwen, school: "Weber State University", degree: "B.S.", field: "Information Systems & Technologies", startYear: 2022, endYear: 2026, description: "Minor in Business Analytics. President, Applied AI Lab (2024–2026)." },
    { id: ctx.id(), userId: gwen, school: "Fremont High School", degree: "High School Diploma", field: null, startYear: 2018, endYear: 2022, description: null },
  );

  const ailab = ctx.club("ailab");
  const gwenPres = ailab.assignments.find((a) => a.userId === gwen && a.seatName === "President")!;
  const gwenDir = { ownerId: gwen, dir: "users/gwen-torres" };
  const report = addPdf(ctx, gwenDir, "Advising FAQ Chatbot - final report.pdf", {
    title: "Advising FAQ Chatbot", subtitle: "Applied AI Lab · final report, April 2025",
    blocks: [
      { heading: "Summary", text: "A retrieval-based chatbot that answers common advising questions from the catalog and advising FAQ pages, built by a team of six Lab members with the Student Success Center." },
      { heading: "Results", bullets: ["Answered 82% of test questions correctly", "Every answer links to its source page", "Handed off to the Student Success Center for a pilot"] },
      { heading: "Team", text: "Gwen Torres (lead) and five Applied AI Lab members." },
    ],
  }, { createdById: gwen, createdAt: new Date("2025-04-20T18:00:00Z"), visibility: "MEMBERS" });
  const diagram = addFile(ctx, gwenDir, "Chatbot architecture.svg", makeFlyerSvg({ club: "Applied AI Lab", title: "Advising FAQ Chatbot architecture", when: "Catalog pages → embeddings → retrieval → answer with sources", where: "Built with campus partners", color: "#4b2e83" }), "image/svg+xml", { createdById: gwen, createdAt: new Date("2025-03-02T18:00:00Z"), visibility: "MEMBERS" });
  const slides2 = addPdf(ctx, gwenDir, "Prompt Engineering Workshop - slides.pdf", {
    title: "Prompt Engineering for Everyone", subtitle: "Applied AI Lab workshop series · 2025-2026",
    blocks: [{ heading: "Sessions", bullets: ["Prompting basics", "Giving models context", "Checking answers and citing sources", "Responsible use at Weber State"] }],
  }, { createdById: gwen, createdAt: new Date("2025-10-01T18:00:00Z"), visibility: "MEMBERS" });
  const proj = (userId: string, assignmentId: string, clubId: string, title: string, html: string, start: Date, end: Date | null, files: string[]) => {
    const id = ctx.id();
    ctx.rows.projects.push({ id, userId, clubId, roleAssignmentId: assignmentId, title, descriptionHtml: html, url: null, startDate: start, endDate: end, createdAt: end ?? start });
    for (const fileId of files) ctx.rows.projectFiles.push({ projectId: id, fileId });
  };
  proj(gwen, gwenPres.id, ailab.id, "Advising FAQ Chatbot", "<p>Led a six-person team building a chatbot that answers advising questions with links to its sources. Piloted with the Student Success Center.</p>", new Date("2024-09-10T18:00:00Z"), new Date("2025-04-20T18:00:00Z"), [report, diagram]);
  proj(gwen, gwenPres.id, ailab.id, "Prompt Engineering Workshop Series", "<p>Designed and taught a four-part workshop series attended by more than 120 students across majors.</p>", new Date("2025-09-15T18:00:00Z"), mayGraduation(2026), [slides2]);

  const priya = ctx.p("priya").id;
  const robotics = ctx.club("robotics");
  const priyaVp = robotics.assignments.find((a) => a.userId === priya && a.seatName === "Vice President")!;
  const review = addPdf(ctx, { ownerId: priya, dir: "users/priya-patel" }, "Heavyweight bot drivetrain design review.pdf", {
    title: "Heavyweight Bot - Drivetrain Design Review", subtitle: `${robotics.name} · March 2026`,
    blocks: [{ heading: "Design", bullets: ["Four-wheel drive with invertible chassis", "Brushless motors with planetary gearboxes", "Target: 100 kg bot with a 10 kg margin under the weight limit"] }],
  }, { createdById: priya, createdAt: new Date("2026-03-12T18:00:00Z"), visibility: "MEMBERS" });
  proj(priya, priyaVp.id, robotics.id, "Heavyweight Bot Drivetrain", "<p>Led the drivetrain subteam for the club's first heavyweight combat robot.</p>", new Date("2025-09-02T18:00:00Z"), new Date("2026-04-10T18:00:00Z"), [review]);

  roleContributions(ctx, proj);
}
