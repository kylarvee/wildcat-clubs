# Wildcat Clubs — architecture

The all-in-one platform for Weber State student clubs to **found, operate and retire** —
web app (`apps/web`) plus a simplified mobile app (`apps/mobile`), one server, one database.

---

## 1. Principles (the rules every change follows)

1. **One data lake.** Every input lands in Postgres (`apps/web/prisma/schema.prisma`) before any
   surface uses it. Web pages, the mobile app, calendar feeds, the AI assistant and Google sync all
   read from the lake. Google Workspace (Calendar, Drive, Chat, Gmail) is a *mirror* we write to,
   never a second source of truth.
2. **One input tool per kind of data.** Each table has exactly one tool where people enter it
   (see §4). Other screens *show* it and link to the owning tool to change it.
3. **One write path.** All writes go through `src/lib/domain/*`. A domain function checks
   permission, validates, writes, appends to `ActivityLog`, and notifies / opens or closes tasks.
   Server actions, API routes, mobile endpoints and AI tools all call domain functions — never Prisma
   writes directly.
4. **One permission authority.** `src/lib/authz` decides who may do what. Nothing else does.
5. **One config authority.** Platform rules (activity windows, review threshold, AI switches,
   integrations, WSUSA contacts) are system config, changed only by sysadmins (`src/lib/config`).
6. **One metrics layer.** Every derived number (activity, retention, attendance rate, ratings,
   interconnection) comes from `src/lib/metrics`, so no two screens disagree.
7. **One inbox.** Anything waiting on a person (approvals, requirements, invoices, club to-dos,
   personal to-dos) is a `Task`. When the thing is decided anywhere, its tasks close.
8. **Simple beats clever.** When the spec contradicts itself, pick the simplest rule that keeps
   the user's intent (§6).

## 2. Stack

| Layer | Choice |
|---|---|
| Web | Next.js 16 (App Router, server components + server actions), React 19, TypeScript strict, Tailwind v4 |
| UI | Own kit in `src/components/ui` on Radix primitives; lucide icons; sonner toasts |
| Data | PostgreSQL + Prisma 6 |
| Rich text | TipTap 3 (one editor component everywhere) — HTML sanitized on write |
| Calendar | FullCalendar 6 |
| Charts / network | Recharts; d3-force canvas |
| PDF | @react-pdf/renderer (constitutions, invoices) |
| AI | Anthropic SDK — Claude Haiku / Sonnet with dynamic routing; off by default |
| Google | Workspace OAuth sign-in; service account (domain-wide delegation) for Calendar/Drive/Chat/Gmail |
| Mobile | Expo (React Native, expo-router, expo-camera, expo-notifications) |

Cache Components is off: every page depends on who is signed in.

## 3. Permissions (single hierarchy)

```
SYSADMIN   everything, incl. system config, AI/integration switches, granting ADMIN
ADMIN      (WSUSA staff) everything in every club + admin tools & analytics; no system config; can't add admins
ADVISOR    (faculty/staff, @weber.edu) everything in the clubs they advise
PRESIDENT  everything in their club, incl. naming a successor/co-president and retiring the club
VP         everything the president can, except assigning President/VP or retiring
OFFICER    the capabilities on their seat (chosen when promoted; defaults per seat)
AMBASSADOR like an officer; no capabilities unless the club grants them
MEMBER     member features (calendar, chat, reviews once eligible)
PUBLIC     clubs list, club pages (public parts), network canvas, public calendar, policies
```

* **Role rule:** you may assign only roles ranked below yours; the President may also name a
  President. (So a VP can't promote themself or backfill VP; officers assign nothing.)
* **Capabilities** (modular officer permissions): `profile, roster, orgchart, events, attendance,
  budget, files, announcements, elections, constitution, tests`.
* **Club phase:** founding clubs (DRAFT/SUBMITTED/CHANGES_REQUESTED) only have `profile, orgchart,
  constitution, files`. APPROVED clubs have everything. RETIRED/REJECTED clubs are read-only.
* **Officer requirements:** admins attach tests/trainings to roles (`RoleRequirement`). They must be
  met within `graceDays` (default 30; 0 = hard gate) of the later of taking the role, club approval,
  or the renewal period start. Overdue → the role's capabilities pause until done. Fulfillment is
  computed from test attempts and training check-ins — never stored twice.
* **Account kind** comes from the email domain: `@mail.weber.edu` = student, `@weber.edu` =
  faculty/staff. Only faculty/staff can be advisors; only students hold student roles.
* **Privacy:** profiles and attendance are visible only to signed-in university accounts; a
  person's attendance detail is visible to them, their club's attendance holders, advisors and admins.

## 4. Data ownership (who inputs what)

| Data | The one input tool | Shown in |
|---|---|---|
| Club profile, logo, docs list | Club Profile editor (`/clubs/[slug]/manage/profile`) | clubs list, club page, network, admin |
| Constitution & bylaws | Constitution Builder (or custom upload → admin approval) | club page Resources, profile |
| Membership | Register button (web/mobile) **or** check-in auto-enroll — both call `memberships.joinClub()`; roster tool approves | everywhere |
| Calendar subscriptions | Subscribe toggle (club pages, dashboard) | united calendar, ICS feeds |
| Roles & seats | Org Chart tool (`roles.assignRole`); elections & hand-offs apply through it | org chart, profiles, role history |
| Events, schedule, location, co-hosts, **event costs** | Events Builder | calendars, ICS, club page, budget, attendance |
| Attendance | Attendance Tool only (QR scan, in-app self check-in, leader manual add) | tracker, activity, reviews gate, network, clubs list |
| General costs & funding requests | Funding & Budgeting tool | admin approvals, invoices |
| Files | Club Files (explorer) | file picker everywhere, Resources |
| Policies | Policy editor (admin) | `<PolicyNotices placement=…>` across the app, policy library |
| Tests, attempts, grades | Test Tool | role requirements, results |
| Reviews | Review form on the club page | clubs list, club page |
| Complaints | Report form (`/report`) | admin complaints only |
| Messages | Messages | — |
| Announcements | Announcements tool | club page, dashboard, mobile |
| System rules | System settings (sysadmin) | everything |

## 5. Definitions

Exact formulas live in `src/lib/metrics/index.ts` (doc comment). Summary:

* **Active student (per club):** attended in the last 31 days, or attended one of the club's last 2 held events.
* **Held event:** a scheduled occurrence that started and has ≥1 check-in.
* **Active club:** approved and (in pilot period, or ≥2 held events in the current or previous term
  and ≥8 registered members).
* **Pilot period:** until the end of the first full term that starts after the club was created.
* **Retention:** of last period's attendees, the share who attended this period (month / quarter /
  academic year / year). Individual retention: share of periods since joining with a check-in.
* **Attendance rate:** member check-ins ÷ members at the time; non-members are "guests".
* **Interconnection:** cross-club physical attendance (a member of club A checking in at an event
  hosted or co-hosted by club B). Drives line weight; centrality emerges from the layout.

## 6. Decisions on contradictions and gaps

| Spec tension | Decision |
|---|---|
| Funding sources listed differently (University/WSUSA/Department vs University/College/Department) | One list: **University, WSUSA, College, Department**. Default: Registered → WSUSA; Sponsored/Affiliate → Department if the club has one, else WSUSA. |
| Costs in Events Builder *and* Budget *and* Calendar | Event costs are entered only in the Events Builder (they belong to the event; recurring events multiply by occurrences). General costs and all funding requests are entered only in the Budget tool. Calendars show costs read-only and link to Budget to request funds. |
| Officer "gate" vs. clubs needing officers to work immediately | Requirements with a grace period (default 30 days; set 0 for a hard gate). Permissions pause, the title stays. |
| VP permissions vs. role assignment | Rank rule: assign only below your rank; President may also name a President. |
| Auto-enroll on check-in vs. membership gates | Check-in always records attendance. Open clubs: you become a member. Gated clubs: a join request is filed. |
| Ambassador role "set up at the college level" | Each college may have a **College Ambassadors** org (a club of type `COLLEGE_AMBASSADORS`). Its leaders place Club Representative Ambassadors into the college's clubs; placements are `AMBASSADOR` role assignments with `viaClubId`. |
| Calendar subscription vs. registration | Separate. Registering subscribes you; you can subscribe without registering (once signed in). |
| Club "college" field (some independent / university-wide / sports) | `scope` = College · University-wide · Independent · Sports; `collegeId` only for College. |
| Department "Other" | Founder types it (`requestedDepartmentName`); an admin task adds it to the list and links the club. |
| Advisor must accept | Invite by name + @weber.edu email → email + in-app request (task). Accepting makes them ADVISOR. Submission for review requires an accepted advisor. |
| Anonymous reports | No reporter id is stored at all; the reporter gets a case code to check status. Every opening by an admin requires acknowledging the anonymity notice and is logged. Never in notifications, the activity log, exports or the AI. |
| Review bombing | Reviews need ≥3 attended events (sysadmin-set, uniform). One review per person per club. ≥3 ratings ≤2★ within 48h opens an admin task. Admins can hide reviews; members can flag. |
| Secret ballots | Votes record voter (one vote each) but no screen ever joins voter to choice. Results apply through the Org Chart path. |
| LinkedIn auto-populate | LinkedIn has no open profile API. Import the **Positions.csv** from LinkedIn's "Get a copy of your data" export. |
| Google Chat / Drive / Calendar | Built on our own tables now (works with no Google setup); adapters mirror to Workspace when a sysadmin turns each integration on. |

## 7. Code map (apps/web/src)

```
app/                      routes (pages, server actions in actions.ts, API routes in app/api)
  api/m/*                 mobile app API (Bearer token auth, same domain functions)
  api/ics/*               calendar subscription feeds
components/ui/            design system (Button, Card, Dialog, Field, Table, …) — use these
components/shell/         header, footer, nav
components/<feature>/     feature components
lib/db.ts                 Prisma client
lib/institution.ts        everything WSU-specific (name, email domains, time zone, maps)
lib/config/               system config + defaults (sysadmin)
lib/auth/                 sessions (cookie + bearer), Google sign-in, accounts, test personas
lib/authz/                THE permission authority (+ requirement gating, capability holders)
lib/domain/               THE write path (one module per area) + kit.ts conventions
lib/metrics/              derived numbers (read-only)
lib/lake/activity.ts      the activity stream
lib/integrations/         Google, email, push, Anthropic adapters (mock when off)
lib/events/recurrence.ts  recurrence expansion (semester-aware)
lib/attendance/token.ts   check-in codes & rotating QR tokens
lib/rich/sanitize.ts      HTML sanitizer for every rich text input
lib/terms.ts, lib/time.ts academic calendar & campus-time formatting
prisma/                   schema + seed
```

### Conventions
* Pages are server components. Protected pages call `requireUser()`; club pages call
  `getClubAccess(user, clubId)` and check `capabilities`. Missing things → `notFound()`.
* Mutations: a `"use server"` function in a colocated `actions.ts` that returns
  `act((actor) => domainFn(actor, input))`, then `revalidatePath(...)`.
* Rich text: `<RichTextEditor name=… />` to edit, `sanitizeRichHtml()` in the domain function,
  `<RichContent html=… />` to show.
* Policies: drop `<PolicyNotices placement="EVENTS" />` where a policy applies.
* Times: store UTC, show with `fmtDate/fmtTime/fmtRange` (campus time).
* Money: integer cents; show with `fmtMoney`.

## 8. Integrations & mock mode

Everything works with **no external accounts**: sign in with test personas, email/push go to the
outbox (`/system/outbox`), files store on local disk, chat is in-app, calendars publish ICS feeds.
Turning on an integration in System settings + setting its credentials switches the adapter:

| Integration | Env | Switch |
|---|---|---|
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (+ `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID`) | automatic |
| Calendar / Drive / Chat / Gmail | `GOOGLE_SERVICE_ACCOUNT_JSON`, `PLATFORM_SENDER_EMAIL` | System settings |
| Push | (Expo push service) | System settings |
| Claude | `ANTHROPIC_API_KEY` | System settings: assistant, grading |
| Test personas | `AUTH_MODE=mock|google|both` (default both outside production) | — |
