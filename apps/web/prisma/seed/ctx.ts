import type { ClubRole, ClubScope, ClubStatus, ClubType, EventKind, LocationType, MembershipSource, MembershipStatus, Prisma, Recurrence, RoleEndReason, Term, Visibility } from "@prisma/client";
import { createIdFactory, createRng, type Rng } from "./lib/rng";
import type { ClubDef } from "./data/clubs";
import type { CollegeKey } from "./data/reference";

/**
 * Shared state for one seed run. Steps build rows in memory (ids are made
 * here, so rows can point at each other before anything is written) and
 * index.ts inserts them in dependency order at the end.
 */

export type Person = {
  id: string;
  name: string;
  first: string;
  last: string;
  email: string;
  handle: string;
  kind: "STUDENT" | "FACULTY_STAFF";
  status: "ACTIVE" | "ALUMNI";
  persona?: string;
  collegeKey: CollegeKey | null;
  majorId: string | null;
  majorName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  jobTitle: string | null;
  /** Students: first day enrolled and graduation day (future for current students). */
  enrollStart: Date;
  gradDate: Date | null;
  propensity: number;
  createdAt: Date;
};

export type Seat = { id: string; role: ClubRole; name: string; defaultPermissions: string[]; maxHolders: number };

export type Engagement = { base: number; half: number; floor: number };

export type Member = {
  id: string;
  userId: string;
  clubId: string;
  status: MembershipStatus;
  source: MembershipSource;
  requestedAt: Date;
  joinedAt: Date | null;
  endedAt: Date | null;
  internalTitle: string | null;
  eng: Engagement;
  /** Joined by checking in: joinedAt is moved to the first check-in during attendance. */
  viaCheckin?: boolean;
};

export type Assignment = {
  id: string;
  clubId: string;
  userId: string;
  positionId: string | null;
  seatName: string | null;
  role: ClubRole;
  permissions: string[];
  viaClubId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  endReason: RoleEndReason | null;
  assignedById: string | null;
  pinned?: boolean;
};

export type Occ = {
  id: string;
  eventId: string;
  clubId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: "SCHEDULED" | "CANCELLED";
  note: string | null;
  roomOverride: string | null;
  checkinCode: string;
  checkinSecret: string;
  attendees: Map<string, { id: string; at: Date; method: "QR" | "SELF" | "MANUAL"; recordedById: string | null }>;
};

export type Ev = {
  id: string;
  clubId: string | null;
  title: string;
  descriptionHtml: string | null;
  kind: EventKind;
  status: "DRAFT" | "SCHEDULED" | "CANCELLED";
  visibility: Visibility;
  startsAt: Date | null;
  durationMinutes: number;
  recurrence: Recurrence;
  recurrenceInterval: number;
  recurrenceWeekdays: number[];
  recurrenceUntil: Date | null;
  locationType: LocationType;
  buildingId: string | null;
  buildingCode: string | null;
  room: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  virtualUrl: string | null;
  allowSelfCheckIn: boolean;
  createdById: string;
  createdAt: Date;
  termId: string | null;
  isSeries: boolean;
  cohosts: { id: string; clubId: string; status: "PENDING" | "APPROVED" | "DECLINED"; requestedById: string; decidedById: string | null; createdAt: Date; decidedAt: Date | null }[];
  occurrences: Occ[];
  /** Planned cost lines for the Events Builder (turned into BudgetItems). */
  cost?: [string, number, number];
};

export type ClubM = {
  id: string;
  def: ClubDef;
  slug: string;
  name: string;
  type: ClubType;
  status: ClubStatus;
  scope: ClubScope;
  collegeKey: CollegeKey | null;
  collegeId: string | null;
  departmentId: string | null;
  focusMajorId: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  approvedAt: Date | null;
  retiredAt: Date | null;
  founderId: string;
  /** End of the club's active life: now, or its retirement. */
  end: Date;
  seats: Map<string, Seat>;
  members: Member[];
  byUser: Map<string, Member>;
  assignments: Assignment[];
  events: Ev[];
  advisorIds: string[];
};

export class Ctx {
  /** The moment everything is anchored to. SEED_NOW (ISO) pins it, e.g. to rehearse a later date. */
  readonly NOW = process.env.SEED_NOW ? new Date(process.env.SEED_NOW) : new Date();
  readonly rng: Rng = createRng(20261016);
  readonly id = createIdFactory(16102026);

  terms: Term[] = [];
  colleges = new Map<CollegeKey, { id: string; name: string; shortName: string }>();
  departments = new Map<string, { id: string; collegeKey: CollegeKey | null }>();
  majors = new Map<string, { id: string; collegeKey: CollegeKey | null; departmentId: string | null }>();
  buildings = new Map<string, { id: string; name: string; lat: number; lng: number; rooms: string[] }>();

  people: Person[] = [];
  byId = new Map<string, Person>();
  persona = new Map<string, Person>();
  admins: Person[] = [];
  staff: Person[] = [];

  clubs: ClubM[] = [];
  clubByKey = new Map<string, ClubM>();
  clubById = new Map<string, ClubM>();

  universityEvents: Ev[] = [];
  /** Ids/keys other steps need to find again. */
  refs: Record<string, string> = {};
  usedCodes = new Set<string>();

  // Rows written as-is (in insert order in index.ts)
  rows = {
    userMajors: [] as Prisma.UserMajorCreateManyInput[],
    experiences: [] as Prisma.ExperienceCreateManyInput[],
    educations: [] as Prisma.EducationCreateManyInput[],
    projects: [] as Prisma.ProjectCreateManyInput[],
    projectFiles: [] as Prisma.ProjectFileCreateManyInput[],
    decisions: [] as Prisma.ClubDecisionCreateManyInput[],
    invites: [] as Prisma.AdvisorInviteCreateManyInput[],
    drafts: [] as Prisma.ConstitutionDraftCreateManyInput[],
    files: [] as Prisma.FileItemCreateManyInput[],
    documents: [] as Prisma.ClubDocumentCreateManyInput[],
    subscriptions: [] as Prisma.CalendarSubscriptionCreateManyInput[],
    attachments: [] as Prisma.EventAttachmentCreateManyInput[],
    reviews: [] as Prisma.ReviewCreateManyInput[],
    reviewFlags: [] as Prisma.ReviewFlagCreateManyInput[],
    budgetItems: [] as Prisma.BudgetItemCreateManyInput[],
    fundingRequests: [] as Prisma.FundingRequestCreateManyInput[],
    fundingItems: [] as Prisma.FundingRequestItemCreateManyInput[],
    invoices: [] as Prisma.InvoiceCreateManyInput[],
    conversations: [] as Prisma.ConversationCreateManyInput[],
    conversationMembers: [] as Prisma.ConversationMemberCreateManyInput[],
    messages: [] as Prisma.MessageCreateManyInput[],
    announcements: [] as Prisma.AnnouncementCreateManyInput[],
    policies: [] as Prisma.PolicyCreateManyInput[],
    tests: [] as Prisma.TestCreateManyInput[],
    questions: [] as Prisma.TestQuestionCreateManyInput[],
    requirements: [] as Prisma.RoleRequirementCreateManyInput[],
    testAssignments: [] as Prisma.TestAssignmentCreateManyInput[],
    attempts: [] as Prisma.TestAttemptCreateManyInput[],
    answers: [] as Prisma.TestAnswerCreateManyInput[],
    elections: [] as Prisma.ElectionCreateManyInput[],
    candidates: [] as Prisma.ElectionCandidateCreateManyInput[],
    votes: [] as Prisma.VoteCreateManyInput[],
    complaints: [] as Prisma.ComplaintCreateManyInput[],
    complaintNotes: [] as Prisma.ComplaintNoteCreateManyInput[],
    complaintAccess: [] as Prisma.ComplaintAccessLogCreateManyInput[],
    tasks: [] as Prisma.TaskCreateManyInput[],
    notifications: [] as Prisma.NotificationCreateManyInput[],
    outbox: [] as Prisma.OutboxMessageCreateManyInput[],
    activity: [] as Prisma.ActivityLogCreateManyInput[],
  };

  p(key: string): Person {
    const x = this.persona.get(key);
    if (!x) throw new Error(`Persona ${key} missing`);
    return x;
  }

  club(key: string): ClubM {
    const c = this.clubByKey.get(key);
    if (!c) throw new Error(`Club ${key} missing`);
    return c;
  }

  person(id: string): Person {
    const x = this.byId.get(id);
    if (!x) throw new Error(`Person ${id} missing`);
    return x;
  }

  /** Unique check-in code (same alphabet as lib/attendance/token: no 0/O/1/I). */
  checkinCode(fixed?: string): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    if (fixed && !this.usedCodes.has(fixed)) {
      this.usedCodes.add(fixed);
      return fixed;
    }
    for (;;) {
      const c = this.rng.string(alphabet, 6);
      if (!this.usedCodes.has(c)) {
        this.usedCodes.add(c);
        return c;
      }
    }
  }

  termAt(at: Date): Term | null {
    return this.terms.find((t) => t.startsOn <= at && at <= t.endsOn) ?? null;
  }

  /** The term containing `at`, else the last one that started before it. */
  termFor(at: Date): Term {
    return this.termAt(at) ?? [...this.terms].reverse().find((t) => t.startsOn <= at) ?? this.terms[0];
  }

  term(name: string): Term {
    const t = this.terms.find((x) => x.name === name);
    if (!t) throw new Error(`Term ${name} missing`);
    return t;
  }

  /** Academic year containing `at` (first term start → last term end with that label). */
  academicYear(at: Date) {
    const t = this.termFor(at);
    const same = this.terms.filter((x) => x.academicYear === t.academicYear);
    return { label: t.academicYear, start: same[0].startsOn, end: same[same.length - 1].endsOn };
  }

  activity(a: Prisma.ActivityLogCreateManyInput) {
    this.rows.activity.push(a);
  }

  /** Active role assignments for a user in a club at an instant. */
  rolesAt(club: ClubM, userId: string, at: Date) {
    return club.assignments.filter((a) => a.userId === userId && a.startedAt <= at && (!a.endedAt || a.endedAt > at));
  }

  holderAt(club: ClubM, seatName: string, at: Date): string | null {
    const a = club.assignments.find((x) => x.seatName === seatName && x.startedAt <= at && (!x.endedAt || x.endedAt > at));
    return a?.userId ?? null;
  }

  /** The person who'd act for the club at a time: president, else VP, else advisor, else founder. */
  leaderAt(club: ClubM, at: Date): string {
    const pres = club.assignments.find((x) => x.role === "PRESIDENT" && x.startedAt <= at && (!x.endedAt || x.endedAt > at));
    if (pres) return pres.userId;
    const vp = club.assignments.find((x) => x.role === "VP" && x.startedAt <= at && (!x.endedAt || x.endedAt > at));
    if (vp) return vp.userId;
    return club.advisorIds[0] ?? club.founderId;
  }

  /** Who holds a capability in a club at a time (advisors, presidents, VPs and officers with it). */
  capabilityHoldersAt(club: ClubM, cap: string, at: Date): string[] {
    return [
      ...new Set(
        club.assignments
          .filter((a) => a.startedAt <= at && (!a.endedAt || a.endedAt > at))
          .filter((a) => a.role === "ADVISOR" || a.role === "PRESIDENT" || a.role === "VP" || a.permissions.includes(cap))
          .map((a) => a.userId),
      ),
    ];
  }

  memberAt(club: ClubM, userId: string, at: Date): boolean {
    const m = club.byUser.get(userId);
    return Boolean(m && m.joinedAt && m.joinedAt <= at && (!m.endedAt || m.endedAt > at) && m.status !== "PENDING" && m.status !== "DECLINED");
  }
}
