/**
 * THE CONTRACT for the mobile API (/api/m/*): request and response shapes.
 *
 * Source of truth. The Expo app keeps a copy in apps/mobile/src/api/types.ts —
 * change this file first, then mirror it there. Plain types only (no Prisma or
 * server imports) so the copy stays a straight copy.
 *
 * Every response is `ApiResult<T>`: `{ ok: true, data }` or
 * `{ ok: false, error, code }` with a matching HTTP status (see lib/domain/kit
 * apiRoute). Dates are ISO 8601 strings (UTC). Labels such as `whenLabel` are
 * already in campus time (America/Denver), so the app shows them as-is.
 * Auth: `Authorization: Bearer <token>` from POST /api/m/auth/*. The mobile
 * API never reads the web session cookie.
 */

// ─── Envelope ────────────────────────────────────────────────────────────────

export type ApiErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID" | "CONFLICT" | "ERROR";
export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string; code: ApiErrorCode };
export type ApiResult<T> = ApiOk<T> | ApiErr;

// ─── Shared enums (mirrors of the Prisma enums the app needs) ────────────────

export type UserKind = "STUDENT" | "FACULTY_STAFF";
export type UserStatus = "ACTIVE" | "ALUMNI" | "DEACTIVATED";
export type PlatformRole = "USER" | "ADMIN" | "SYSADMIN";
export type ClubRole = "MEMBER" | "AMBASSADOR" | "OFFICER" | "VP" | "PRESIDENT" | "ADVISOR";
export type MembershipStatus = "PENDING" | "ACTIVE" | "LEFT" | "ALUMNI" | "REMOVED" | "DECLINED";
export type JoinPolicy = "OPEN" | "APPROVAL";
export type Visibility = "PUBLIC" | "UNIVERSITY" | "MEMBERS";
export type CheckInMethod = "QR" | "SELF" | "MANUAL";
export type WindowState = "NOT_OPEN" | "OPEN" | "CLOSED";
export type CheckInVia = "mobile-scan" | "mobile-popup";

// ─── People and clubs ────────────────────────────────────────────────────────

export type MUser = {
  id: string;
  name: string;
  email: string;
  handle: string;
  kind: UserKind;
  status: UserStatus;
  platformRole: PlatformRole;
  /** Site-relative ("/api/files/…") or absolute; resolve against the API base URL. */
  avatarUrl: string | null;
  avatarColor: string;
};

export type MClubRef = {
  id: string;
  name: string;
  slug: string;
  /** Site-relative ("/api/files/…") or absolute; resolve against the API base URL. */
  logoUrl: string | null;
  logoColor: string;
};

/** The signed-in person's relationship to a club. */
export type MViewerState = {
  signedIn: boolean;
  isMember: boolean;
  isPending: boolean;
  isLeader: boolean;
  role: ClubRole | null;
  /** "Member", "Treasurer", "Vice President"… (seat name when they hold one). */
  roleLabel: string | null;
  subscribed: boolean;
};

export type MRole = {
  club: MClubRef;
  role: ClubRole;
  /** Seat name ("Treasurer") or the role's label. */
  title: string;
  since: string;
};

// ─── Events ──────────────────────────────────────────────────────────────────

/** One meeting of an event, as calendars and lists show it. */
export type MEvent = {
  occurrenceId: string;
  eventId: string;
  title: string;
  kindLabel: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  /** Campus date "2026-10-20", for grouping by day. */
  dayKey: string;
  /** "Tue, Oct 20" */
  dayLabel: string;
  /** "6:00 – 8:00 PM", "All day", or "Oct 20, 6:00 PM – Oct 21, 1:00 AM". */
  timeLabel: string;
  location: string;
  isVirtual: boolean;
  cancelled: boolean;
  /** Why a cancelled meeting was cancelled, when the club said. */
  note: string | null;
  visibility: Visibility;
  club: MClubRef | null;
  cohostNames: string[];
  happeningNow: boolean;
};

/** An occurrence you could check in to (live pop-up, scan result). */
export type MOccurrence = {
  id: string;
  eventId: string;
  code: string;
  title: string;
  kindLabel: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  /** "Tue, Oct 20 · 6:00 – 8:00 PM" */
  whenLabel: string;
  place: string | null;
  visibility: Visibility;
  cancelled: boolean;
  allowSelfCheckIn: boolean;
  opensAt: string;
  closesAt: string;
  windowState: WindowState;
  club: MClubRef | null;
  cohosts: MClubRef[];
};

export type MEventDetail = MEvent & {
  description: string;
  links: { label: string; url: string }[];
  /** What a maps app should search for (campus building or street address). */
  mapQuery: string | null;
  virtualUrl: string | null;
  /** How the event repeats ("Weekly on Tuesdays…"); null for a one-time meeting. */
  scheduleLabel: string | null;
  /** Open in the browser for the full page. */
  webPath: string;
};

export type MAnnouncement = {
  id: string;
  title: string;
  /** Plain text (rich content and embeds flattened), trimmed for a card. */
  bodyText: string;
  pinned: boolean;
  createdAt: string;
  authorName: string;
  /** null = a university-wide (WSUSA) announcement. */
  club: MClubRef | null;
};

// ─── Auth ────────────────────────────────────────────────────────────────────

export type MPersona = { key: string; name: string; email: string; group: string; label: string; blurb: string };

/** GET /api/m/auth/personas */
export type MAuthOptions = {
  /** Test personas are allowed on this server (AUTH_MODE mock or both). */
  personasEnabled: boolean;
  personas: MPersona[];
  /** The server can verify Google ID tokens (a Google client id is configured and AUTH_MODE allows Google). */
  googleEnabled: boolean;
};

/** POST /api/m/auth/persona { key } */
export type MPersonaSignInRequest = { key: string };
/** POST /api/m/auth/google { idToken } */
export type MGoogleSignInRequest = { idToken: string };
/** Both sign-ins return a session. Keep the token in secure storage. */
export type MSession = { token: string; expiresAt: string; user: MUser; created: boolean };

/** POST /api/m/auth/signout { pushToken? } — also forgets this phone's push token when given. */
export type MSignOutRequest = { pushToken?: string | null };
export type MSignOutResponse = { signedOut: true };

// ─── Me / devices ────────────────────────────────────────────────────────────

/** GET /api/m/me */
export type MMe = {
  user: MUser;
  unreadNotifications: number;
  openTasks: number;
  roles: MRole[];
  /** The web app's public address (for "Open Wildcat Clubs on the web"). */
  webUrl: string;
};

/** POST /api/m/push-token — register this phone; DELETE with { token } to stop pushes to it. */
export type MPushTokenRequest = { token: string; platform: "ios" | "android" | "web" };
export type MPushTokenResponse = { registered: boolean };

// ─── Home ────────────────────────────────────────────────────────────────────

export type MMyClub = {
  club: MClubRef;
  role: ClubRole | null;
  roleLabel: string | null;
  pending: boolean;
  subscribed: boolean;
};

/** GET /api/m/home */
export type MHome = {
  firstName: string;
  /** Check-ins open right now at clubs you belong to (the "happening now" banners). */
  live: MOccurrence[];
  clubs: MMyClub[];
  /** Your calendar for the next 14 days (cancelled meetings left out). */
  upcoming: MEvent[];
  announcements: MAnnouncement[];
};

// ─── Clubs ───────────────────────────────────────────────────────────────────

export type MClubMetrics = {
  registeredMembers: number;
  activeMembers: number;
  /** 0–1, last complete month vs the one before; null without data. */
  retentionRate: number | null;
  avgRating: number | null;
  reviewCount: number;
  isActive: boolean;
  inPilot: boolean;
  /** False until the metrics layer has numbers for the club (hide badges rather than guess). */
  hasMetrics: boolean;
};

export type MClubListItem = MClubRef & {
  shortDescription: string;
  typeLabel: string;
  /** "College of Science", "University-wide"… */
  placement: string;
  focus: string | null;
  joinPolicy: JoinPolicy;
  metrics: MClubMetrics;
  viewer: { member: boolean; pending: boolean; subscribed: boolean; leader: boolean } | null;
};

/** GET /api/m/clubs?q= */
export type MClubList = { items: MClubListItem[]; total: number };

export type MAttendanceSummary = {
  attended: number;
  heldSinceJoined: number;
  /** 0–1; only meaningful for members. */
  rate: number | null;
  lastAttendedAt: string | null;
  active: boolean;
  /** This account can review clubs at all (active students only; not alumni or faculty/staff). */
  canReview: boolean;
  /** canReview and attended ≥ reviewThreshold. */
  reviewEligible: boolean;
  reviewThreshold: number;
};

/** GET /api/m/clubs/[slug] */
export type MClubDetail = {
  club: MClubRef & {
    status: "APPROVED" | "RETIRED" | "DRAFT" | "SUBMITTED" | "CHANGES_REQUESTED" | "REJECTED";
    shortDescription: string;
    /** The about section as plain text. */
    about: string;
    typeLabel: string;
    placement: string;
    focus: string | null;
    joinPolicy: JoinPolicy;
    joinPolicyLabel: string;
    contactEmail: string | null;
    webPath: string;
  };
  metrics: MClubMetrics;
  viewer: MViewerState;
  upcoming: MEvent[];
  /** Your attendance here; null when signed out or you have no connection to the club. */
  attendance: MAttendanceSummary | null;
  /** Check-ins open now that you could make yourself (drives the "check in?" pop-up). */
  live: MOccurrence[];
};

/** POST /api/m/clubs/[slug]/join | leave | subscribe | unsubscribe (no body) */
export type MClubActionResponse = {
  /** join only: what happened ("PENDING" = a join request went to the leaders). */
  joinStatus: "ACTIVE" | "PENDING" | "ALREADY_MEMBER" | "ALREADY_PENDING" | null;
  viewer: MViewerState;
};

// ─── Check-in ────────────────────────────────────────────────────────────────

/**
 * POST /api/m/checkin/preview and POST /api/m/checkin.
 * Send what the camera read as `url` ("<web>/c/<code>?t=<token>" or
 * "wildcatclubs://c/<code>?t=…"), or a typed `code` (+ `token` when you have one).
 */
export type MCheckinRequest = { url?: string | null; code?: string | null; token?: string | null; via?: CheckInVia };

/** No side effects; works signed out. A live QR token comes back as `pass`, good for 10 minutes — send it as `token` after signing in. */
export type MCheckinPreview =
  | {
      found: false;
      message: string;
      /** The code is real, but this viewer can't see the event yet: sign in, or scan the QR at the event. */
      hidden?: boolean;
    }
  | {
      found: true;
      occurrence: MOccurrence;
      signedIn: boolean;
      pass: string | null;
      scan: "LIVE" | "EXPIRED" | "NONE";
      existing: { method: CheckInMethod; checkedInAt: string } | null;
      membership: "MEMBER" | "REQUESTED" | "NONE";
      /** Tapping "Check in" would work right now. */
      ready: boolean;
      /** Why it wouldn't, in plain words. */
      blocker: string | null;
    };

export type MCheckinResult = {
  status: "CHECKED_IN" | "ALREADY";
  attendanceId: string;
  method: CheckInMethod;
  methodLabel: string;
  checkedInAt: string;
  occurrence: MOccurrence;
  club: MClubRef | null;
  /** JOINED = now a member (open club); REQUESTED = a join request went to the leaders. */
  membership: "MEMBER" | "JOINED" | "REQUESTED" | "NONE";
  reviewProgress: { eligible: boolean; attended: number; required: number } | null;
  /** Officer requirements this check-in fulfilled. */
  requirementsMet: string[];
};

// ─── Calendar ────────────────────────────────────────────────────────────────

/** GET /api/m/calendar?from=ISO&to=ISO — your calendar (subscribed clubs + university events if you follow them). */
export type MCalendar = { from: string; to: string; events: MEvent[] };

// ─── Notifications ───────────────────────────────────────────────────────────

export type MNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  /** A web path ("/clubs/chess-club", "/events/…"); the app maps it to a screen or opens the web. */
  href: string | null;
  createdAt: string;
  readAt: string | null;
};

/** GET /api/m/notifications */
export type MNotifications = { unread: number; items: MNotification[] };
/** POST /api/m/notifications/read */
export type MReadRequest = { ids: string[] } | { all: true };
export type MReadResponse = { unread: number };

// ─── Attendance ──────────────────────────────────────────────────────────────

export type MClubAttendance = {
  club: MClubRef;
  membershipStatus: MembershipStatus | null;
  summary: MAttendanceSummary;
};

export type MAttendanceItem = {
  id: string;
  occurrenceId: string;
  eventId: string;
  title: string;
  startsAt: string;
  dateLabel: string;
  method: CheckInMethod;
  methodLabel: string;
  /** Host first, then approved co-hosts. */
  clubs: MClubRef[];
  /** Member of a participating club at the time; false = a guest visit; null = a university event. */
  asMember: boolean | null;
};

/** GET /api/m/attendance */
export type MAttendance = {
  totalCheckins: number;
  clubs: MClubAttendance[];
  /** Newest first (most recent 100). */
  history: MAttendanceItem[];
  /** More check-ins exist than `history` holds; the web page has them all. */
  more: boolean;
};
