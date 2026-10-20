/**
 * MIRROR — do not edit here first. Source of truth:
 *   apps/web/src/app/api/m/_types.ts
 * Change the web contract, then copy it over this file (everything below the
 * first comment block is identical).
 */

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
/** What an event offers: "Free food", "Free stuff". */
export type EventPerk = "FREE_FOOD" | "FREE_STUFF";
/** QR scan · SELF typed code · TAP one-tap at an online event · MANUAL added by a leader. Show `methodLabel` when a response has one. */
export type CheckInMethod = "QR" | "SELF" | "TAP" | "MANUAL";
export type WindowState = "NOT_OPEN" | "OPEN" | "CLOSED";
/** "mobile-scan": a scan or a typed code. "mobile-popup": the one-tap "check in?" prompt (recorded as TAP at online events). */
export type CheckInVia = "mobile-scan" | "mobile-popup";
/** APPROVAL, REQUIREMENT, TEST and INVOICE tasks close on their own once the thing is done; CLUB and PERSONAL ones are checked off. */
export type TaskKind = "APPROVAL" | "REQUIREMENT" | "TEST" | "INVOICE" | "CLUB" | "PERSONAL";

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
  /** The event's cover image, site-relative ("/api/files/…"; resolve against the API base URL); null = show the club's color. */
  coverUrl: string | null;
  /** In badge order: "Free food", then "Free stuff". */
  perks: EventPerk[];
  /** Service hours each attendee earns per date they check in (1.5 = an hour and a half); null = doesn't count. Badge: "Service hours · 1.5". */
  serviceHours: number | null;
  /** In person with an online link too ("Hybrid"). Check-in still happens in the room: the QR code or the typed code. */
  hybrid: boolean;
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
  /** An online event: members can check in with one tap (in person needs the QR code or the typed code). */
  allowTapCheckIn: boolean;
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
  /** The online link: online events, and hybrid ones (in person with a link too). */
  virtualUrl: string | null;
  /** How the event repeats ("Weekly on Tuesdays…"); null for a one-time meeting. */
  scheduleLabel: string | null;
  /** Open in the browser for the full page. */
  webPath: string;
  /** "Show check-in QR" and "Add someone": only while check-in is open, and only for people who can run it. */
  leaderCheckin: MLeaderCheckin | null;
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
/**
 * `delivering`: pushes really reach this phone — it's registered and the
 * server's Push switch (System → AI & integrations) is on. While that switch
 * is off, notifications still land in the Notifications tab.
 */
export type MPushTokenResponse = { registered: boolean; delivering: boolean };

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
  /** What WSUSA requires of you that's still open, soonest due first (done on the web). */
  required: MRequiredTask[];
  /** "See more": GET /api/m/announcements?cursor=… for older announcements; null when there are none. */
  announcementsCursor: string | null;
  /** Your open tasks, for the Tasks row ("5 approvals waiting"). */
  tasks: { open: number; approvals: number };
};

export type MRequiredTask = {
  id: string;
  title: string;
  /** "Due Friday", "Overdue · was due Oct 14"; null when undated. */
  dueLabel: string | null;
  overdue: boolean;
  /** Web path to open in the in-app browser. */
  path: string;
};

// ─── Clubs ───────────────────────────────────────────────────────────────────

export type MClubMetrics = {
  registeredMembers: number;
  activeMembers: number;
  /** 0–1, month retention (the latest two full months in a row with check-ins); null without data. */
  retentionRate: number | null;
  /** How to show it, the same words as the web: "Sep → Oct: 62% came back", or what it's waiting for. */
  retentionText: string;
  avgRating: number | null;
  reviewCount: number;
  isActive: boolean;
  inPilot: boolean;
  /** False until the metrics layer has numbers for the club (hide badges rather than guess). */
  hasMetrics: boolean;
};

/** A run of search text; `hit` runs are the words that matched (show them highlighted). */
export type MTextRun = { text: string; hit: boolean };

/** Where a search found its words: "Found in Event · “Girls in STEM Robot Day”" plus the passage around them. */
export type MSearchMatch = {
  /** "Event", "Announcement", "Constitution", "Student review"… */
  label: string;
  /** The item's title with the matched words marked; empty for fixed sections (About, Club details…). */
  title: MTextRun[];
  /** The passage around the match; null when only the title matched. */
  snippet: MTextRun[] | null;
  /** Site-relative web path to where the text lives ("/events/…", "/clubs/…#announcements"). */
  path: string;
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
  /** With a search, for clubs near the top: where the words were found, when the name and description don't show it. */
  foundIn?: MSearchMatch | null;
  /** Up to two short reasons the club is suggested ("Matches your major (Nursing)", "Popular this term"). */
  reasons?: string[];
};

/**
 * GET /api/m/clubs?q=&sort= — best match first with a query, Recommended
 * (popularity plus your own majors, clubs and check-ins) without one. `sort`
 * takes the web list's values (name, rating, members…).
 */
export type MClubList = {
  items: MClubListItem[];
  total: number;
  /** With a query: "all" = every word matched, "close" = close spellings, "some" = only some of the words. */
  search?: { mode: "all" | "close" | "some"; matches: number } | null;
};

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
  /** This club's meetings with check-in open now that you can run ("Show check-in QR", "Add someone"); empty for everyone else. */
  leaderCheckins: MLeaderCheckin[];
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
  /** WSUSA requirements this check-in fulfilled. */
  requirementsMet: string[];
};

// ─── Leader check-in tools ───────────────────────────────────────────────────

/**
 * A meeting whose check-in is open that you can run: the Attendance
 * permission in the host club (admins at university events), as on the web.
 */
export type MLeaderCheckin = { occurrence: MOccurrence; checkedIn: number };

/**
 * GET /api/m/checkin/[occurrenceId]/qr — the rotating QR to show at the
 * door: the same token as the web's live check-in screen. Fetch it again
 * after `refreshInMs`. A code keeps working for about a minute after it
 * changes, so a slow network doesn't lock anyone out.
 */
export type MCheckinQr = {
  occurrence: MOccurrence;
  /** What the QR encodes: "<web>/c/<code>?t=<token>". */
  url: string;
  /** The QR's modules, top row first ("1" = dark). Draw dark on white with a margin; no QR library needed. */
  qr: string[];
  /** The event's check-in code, shown under the QR. */
  code: string;
  /** Whose members may type the code ("RC Wrecker Bots Club or SWE"). Null at university events: only the QR works there, so the code isn't shown. */
  codeClubs: string | null;
  rotateSeconds: number;
  /** Milliseconds until this QR changes, by the server's clock. */
  refreshInMs: number;
  /** The same moment as a time. */
  refreshAt: string;
  windowState: WindowState;
  checkedIn: number;
};

/** GET /api/m/checkin/[occurrenceId]/people?q= (2+ characters) — who a leader can add: the host club's members first, then any Weber State account. */
export type MCheckinCandidate = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  avatarColor: string;
  /** An active member of the host club. */
  isMember: boolean;
  /** Already checked in to this meeting. */
  alreadyIn: boolean;
};
export type MCheckinCandidates = { items: MCheckinCandidate[] };

/** POST /api/m/checkin/[occurrenceId]/people { userId } — checks them in as "Added by a leader". */
export type MManualCheckinRequest = { userId: string };
export type MManualCheckinResult = {
  attendanceId: string;
  name: string;
  method: CheckInMethod;
  /** "Added by a leader" */
  methodLabel: string;
  /** WSUSA requirements this check-in fulfilled for them. */
  requirementsMet: string[];
  checkedIn: number;
};

// ─── Tasks ───────────────────────────────────────────────────────────────────

/** A request you can approve or decline right in the app. */
export type MTaskDecision =
  | {
      kind: "JOIN";
      /** The membership: POST /api/m/join-requests/[id]/approve | decline */
      id: string;
      personName: string;
      clubName: string;
    }
  | {
      kind: "COHOST";
      /** The co-host invitation: POST /api/m/cohost-requests/[id]/approve | decline */
      id: string;
      eventTitle: string;
      /** The club (or Weber State) hosting the event. */
      hostName: string;
      /** Your club, the one invited to co-host. */
      clubName: string;
    };

/** One open task, worded like the web's Tasks page. */
export type MTask = {
  id: string;
  kind: TaskKind;
  /** "Required by WSUSA" on required tasks; otherwise the kind ("Approval", "Club test", "Club form", "Invoice"…). */
  badge: string;
  /** WSUSA requires it: listed first, with the "Required by WSUSA" badge. */
  required: boolean;
  title: string;
  description: string | null;
  club: MClubRef | null;
  /** "Due tomorrow", "Overdue · was due Oct 14"; null when undated or waiting for grading. */
  dueLabel: string | null;
  overdue: boolean;
  /** Due within two days. */
  dueSoon: boolean;
  /** "Submitted — waiting for grading": handed in on time, so it isn't late. Shown instead of a due date. */
  waitingLabel: string | null;
  /** "From Priya Patel": who handed you a club task. */
  fromLabel: string | null;
  /** "Everyone with Budget & funding": a club task for everyone who holds a permission. */
  forGroup: string | null;
  /** How it closes, for tasks that close on their own ("Closes on its own once you pass the test or submit the form."). */
  note: string | null;
  /** Approve or decline here (join requests, co-host invitations). */
  decision: MTaskDecision | null;
  /** A personal or club to-do: check it off with POST /api/m/tasks/[id]/done. */
  checkable: boolean;
  /** Where it's done, as a site path ("/tests/…"); the app opens its own screen when it has one, else the web. Null when there's nothing to open. */
  path: string | null;
};

/** GET /api/m/tasks — your open tasks: required first, then soonest due (undated last), the same list as the web's Tasks page. */
export type MTasks = {
  items: MTask[];
  /** More are open than `items` holds; the web's Tasks page lists them all. */
  more: boolean;
};

/** POST /api/m/join-requests/[membershipId]/approve | decline and /api/m/cohost-requests/[cohostId]/approve | decline (no body). */
export type MDecisionResponse = {
  status: "APPROVED" | "DECLINED";
  /** What happened, ready to show ("Jordan Lee is now a member of RC Wrecker Bots Club."). */
  message: string;
  /** Your open tasks now, for the badges. */
  openTasks: number;
};

/** POST /api/m/tasks/[taskId]/done { done } — check off (or reopen) a personal or club to-do. */
export type MTaskDoneRequest = { done: boolean };
export type MTaskDoneResponse = { done: boolean; openTasks: number };

// ─── Announcements ───────────────────────────────────────────────────────────

/**
 * GET /api/m/announcements?cursor=&limit= — older announcements for "See
 * more" on Home: the web dashboard's feed (same audiences), newest first, a
 * page at a time. Start from MHome.announcementsCursor; `nextCursor` is null
 * at the end.
 */
export type MAnnouncementPage = { items: MAnnouncement[]; nextCursor: string | null };

// ─── Calendar ────────────────────────────────────────────────────────────────

/** GET /api/m/calendar?from=ISO&to=ISO — your calendar (subscribed clubs + university events if you follow them). */
export type MCalendar = { from: string; to: string; events: MEvent[] };

/**
 * GET /api/m/events?filter=&from=ISO&to=ISO → MCalendar: the Events tab, the
 * same events as the web Events page. "all" (the default) is every event you
 * may see (signed out: public events); "free-food" and "service" narrow it;
 * "following" (sign-in needed) is the web's Mine: the clubs you follow, plus
 * university events if you keep them on. Defaults to today (campus time)
 * through six weeks out; at most about a year at a time. Cancelled meetings
 * are included and marked.
 */
export type MEventFilter = "all" | "free-food" | "service" | "following";

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

/**
 * Service hours from your check-ins (lib/metrics/service): every check-in at
 * an event that counts adds its hours, so a removed check-in takes them away.
 */
export type MServiceSummary = {
  minutes: number;
  /** minutes ÷ 60 (exact quarter hours), e.g. 42.5. */
  hours: number;
  /** Dates you checked in to serve. */
  events: number;
  /** "42.5 service hours · 12 service events", as the web says it. */
  label: string;
};

/** GET /api/m/attendance */
export type MAttendance = {
  totalCheckins: number;
  clubs: MClubAttendance[];
  /** Newest first (most recent 100). */
  history: MAttendanceItem[];
  /** More check-ins exist than `history` holds; the web page has them all. */
  more: boolean;
  service: MServiceSummary;
  /** Your involvement record as a PDF on the web (open with openWeb; the web asks you to sign in once). */
  recordPath: string;
};
