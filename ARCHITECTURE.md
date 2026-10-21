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
4. **One permission authority.** `src/lib/authz` decides who may do what. Nothing else does —
   including who may *see* an event (`lib/authz/events`) and a file (`canViewFile`).
5. **One config authority.** Platform rules (activity windows, review threshold, AI switches,
   integrations, WSUSA's reviewers) are system config, changed only by sysadmins (`src/lib/config`).
   Each office's contacts and review time live on its `Office` row (Admin → Offices).
6. **One metrics layer.** Every derived number (activity, retention, attendance rate, ratings,
   interconnection) comes from `src/lib/metrics`, so no two screens disagree.
7. **One inbox.** Anything waiting on a person (approvals, requirements, invoices, club to-dos,
   personal to-dos) is a `Task`. When the thing is decided anywhere, its tasks close. What WSUSA
   or another office requires (`Task.required`) is listed first and marked "Required by WSUSA"
   (or "Required by Campus Rec": `Task.officeId` names who requires it) on every surface.
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
| PDF | @react-pdf/renderer (constitutions, invoices, involvement records, officers of record letters; shared pieces in `lib/documents`) |
| AI | Anthropic SDK — Claude Haiku / Sonnet with dynamic routing; off by default |
| Google | Workspace OAuth sign-in; service account (domain-wide delegation) for Calendar/Drive/Chat/Gmail |
| Mobile | Expo (React Native, expo-router, expo-camera, expo-notifications) |

Cache Components is off: every page depends on who is signed in.

## 3. Permissions (single hierarchy)

```
SYSADMIN   everything, incl. system config, AI/integration switches, granting ADMIN
ADMIN      (WSUSA staff) everything in every club + admin tools & analytics; no system config; can't add admins
OFFICE     (an office's staff, e.g. Campus Recreation) everything in that office's clubs + the admin console
           filtered to them (queue, Club approvals, analytics, Event reviews, its tests, Requirements,
           Funding when it decides funding); nothing in other offices' clubs; no WSUSA-only areas
ADVISOR    (faculty/staff, @weber.edu) everything in the clubs they advise
PRESIDENT  everything in their club, incl. naming a successor/co-president and retiring the club
VP         everything the president can, except assigning President/VP or retiring
OFFICER    the capabilities on their seat (chosen when promoted; defaults per seat)
AMBASSADOR like an officer; no capabilities unless the club grants them. In a regular club, only
           the college's ambassador program fills this seat (clubs ask for one)
MEMBER     member features (calendar, chat, reviews once eligible)
PUBLIC     clubs list, club pages (public parts), network canvas, the Events page, policies
```

* **Role rule:** you may assign only roles ranked below yours; the President may also name a
  President. (So a VP can't promote themself or backfill VP; officers assign nothing.) Nobody
  assigns AMBASSADOR in a regular club: those seats are filled by placement from the college's
  ambassador program, though the club's President/VPs may set a placed ambassador's capabilities
  or end the placement.
* **Capabilities** (modular officer permissions): `profile, roster, orgchart, events, attendance,
  budget, files, announcements, elections, constitution, tests`.
* **Club phase:** founding clubs (DRAFT/SUBMITTED/CHANGES_REQUESTED) only have `profile, orgchart,
  constitution, files`. APPROVED clubs have everything. RETIRED/REJECTED clubs are read-only.
* **Requirements engine:** one batch evaluator (`authz/requirements.loadRequirementBatch`) decides
  met / due / overdue / waiting for everyone at once, and the per-person event path uses the same
  code. The scheduled job does a full sweep once a day (and after an admin edits a requirement) and
  only deadline changes in between. The header's task count reads stored tasks, not live re-checks.
* **Requirements:** admins require tests, forms or trainings (`RoleRequirement`) of every club
  member (`MEMBER`), chosen leader roles, or both. They must be met within `graceDays` (default 30;
  0 = hard gate) of the latest of joining or taking the role, club approval, the renewal period
  start, and the day the requirement was added. Overdue → a leader role's capabilities pause until
  done; members have nothing to pause, so theirs just shows overdue. Fulfillment is computed from
  test attempts (a submitted form counts as passed) and training check-ins — never stored twice.
  An office's requirement (`officeId`) reaches only that office's clubs; a single-permission one
  (`gatesCapability`) reaches only leaders holding that permission and pauses only it (§6).
* **Offices** (`lib/offices`): every club is overseen by one office (`Club.officeId`): WSUSA, the
  umbrella, unless another office oversees it. Platform admins are the umbrella's staff and see
  every office; an office's staff (`OfficeMember`) get `viaPlatform: "OFFICE"` in its clubs
  (`getClubAccess`) and `adminScope`/`canAdminClub`/`adminClubWhere` filter every admin tool to
  those clubs. People, Directory, Policies, review moderation, Reports, university-wide
  announcements, Offices and System stay WSUSA's (they 404 for office staff).
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
| Calendar subscriptions | Subscribe toggle (club pages, dashboard); **Follow** on a forming club (the clubs list's Forming section, its forming page) | the Events page's **Mine**, ICS feeds, the approval news for a forming club's followers |
| Co-founder invitations | **Your founding team** on a founding club's Overview (`cofounders.inviteCofounder`; answered at `/cofounder/[token]`) | the founding team, the invitee's Tasks, the office's review |
| "List this club as forming" | The Start a club wizard and the founding club's Settings → Forming list (`clubs.setListedAsForming`) | the clubs list's Forming section, the forming page |
| Requests to bring a retired club back | **Ask to revive it** in the wizard's similar clubs or on the retired club's page (`clubs.requestClubRevival`) | the office's queue and Club approvals → Revival requests |
| Roles & seats | Org Chart tool (`roles.assignRole`); elections & hand-offs apply through it | org chart, profiles, role history |
| College Ambassador placements | The program's Ambassador placements page (`roles.placeAmbassador`); clubs ask with **Request a college ambassador** (`ambassadors.requestAmbassador`) | org charts, the program's placements, inboxes |
| An ambassador program's advisor | Admin → Club approvals → Ambassador programs (`ambassadors.setAmbassadorAdvisor`) | the program's org chart and settings |
| Events, schedule, location, co-hosts, cover, perks, service hours, **event costs**, the **"Does this event involve…" risk flags** and, with Travel, **the trip** (destination, leaving and returning, overnight, drivers, notes) | Events Builder | the Events page, ICS, club page, budget, attendance, service hours, the office's Event reviews |
| Attendance | Attendance Tool only (QR scan, the code shown at the event, one-tap for online events, leader manual add) | tracker, activity, reviews gate, network, clubs list, service hours, My involvement |
| General costs & funding requests | Funding & Budgeting tool | admin approvals, invoices |
| Files | Club Files (explorer) | file picker everywhere, Resources |
| Policies | Policy editor (admin) | `<PolicyNotices placement=…>` across the app, policy library |
| Tests and forms, attempts, grades and responses | Test Tool (a form is a test with grading off) | requirements, results |
| Requirements (what WSUSA requires of members and leaders) | Admin → Requirements | tasks (required), compliance |
| Offices: name, contacts, review time, whether it decides funding; its staff | Admin → Offices (WSUSA's admins, `domain/offices`) | club pages ("Overseen by …"), founders' confirmation, funding requests, the queue filter, the assistant |
| Which office oversees a club | Set by its scope and category when it's created and while it's founded (`domain/offices` `routedOfficeId`); afterwards Admin → Club approvals → the club → **Move club** (WSUSA's admins, `offices.setClubOffice`) | everywhere a club's office shows |
| Member details (student ID, birth date, gender, phone, year in school, address, emergency contact) | Settings → Member details (`lib/domain/details`; who sees what: `lib/authz/details`) | club roster (contact basics), admin People page, the yearly "Member details" requirement |
| Club category, website, social links | Club Profile editor | club page, clubs list filter, assistant |
| Meeting schedule | Events Builder (any repeating event: meetings, practices, …) | "Meets" on the club page, next meeting on dashboards |
| Reviews | Review form on the club page | clubs list, club page |
| Complaints | Report form (`/report`) | admin complaints only |
| Messages | Messages | — |
| Push devices | Mobile app sign-in (`lib/domain/devices`) | push delivery |
| AI conversations | Ask Wildcat Clubs (`lib/ai/conversations`, the write path for AiConversation/AiMessage, and AiUsage — one row per model call, which the hourly limit counts) | `/assistant` only — private to the owner, never in the activity log |
| Announcements | Announcements tool | club page, dashboard, mobile |
| System rules | System settings (sysadmin) | everything |

## 5. Definitions

Exact formulas live in `src/lib/metrics/index.ts` (doc comment). Summary:

* **Active student (per club):** attended in the last 31 days, or attended one of the club's last 2 held events.
* **Held event:** a scheduled occurrence that started and has ≥1 check-in.
* **Active club:** approved and (in pilot period, or ≥2 held events in the current or previous term
  and ≥8 registered members).
* **Pilot period:** until the end of the first full term that starts after the club was created.
* **Retention:** the share of one complete month's attendees who came back the next complete month,
  for the most recent pair of complete months (within the last 12) that both had attendees; the
  month still running never counts. Shown the same way everywhere: "Sep → Oct: 62% came back".
  The tracker's charts plot the same comparison for every month, quarter, academic year or year.
* **Months attended (per person):** of the months since someone got involved, how many had a
  check-in of theirs. Never called retention.
* **Activity score ("Events held lately"):** held events in the last 30 days (hosted or co-hosted);
  scheduled dates don't count until they're held.
* **At risk:** an approved club that's inactive; or in its pilot period without yet meeting the bar
  (events this term, members); or active only on last term's record past this term's halfway
  point, or exactly at the member minimum. One list for the admin Overview and the assistant.
* **Attendance rate:** member check-ins ÷ members at the time; non-members are "guests".
* **Interconnection:** cross-club physical attendance (a member of club A checking in at an event
  hosted or co-hosted by club B). Drives line weight; centrality emerges from the layout.
* **Service hours:** every check-in at a date of an event with `serviceMinutes` earns those minutes,
  summed from attendance every time (never stored), so a removed check-in or an edited event changes
  every total at once. An event's hours count for each club that put it on; a person's total counts
  each check-in once. Profiles show the total to signed-in accounts; only the person and admins see
  which events. One involvement record (`lib/documents/record`: roles, service hours, attendance,
  WSUSA trainings) backs My involvement, its PDF and the public `/verify/[token]` page, whose link is
  an HMAC over (kind, subject, issued at) with `DOCUMENT_SECRET` (no table). The same links back a
  club's officers of record (kind `officers`, subject the club; §6).

## 6. Decisions on contradictions and gaps

| Spec tension | Decision |
|---|---|
| Funding sources listed differently (University/WSUSA/Department vs University/College/Department) | One list, in this order everywhere: **University, WSUSA, College, Department**. The club picks an **Expected source** (default: Registered → WSUSA; Sponsored/Affiliate → Department if the club has one, else WSUSA; College Ambassadors orgs → College), WSUSA decides every request (or the club's office, when that office decides its clubs' funding, like Campus Recreation), and records the source that actually funds it (**Funded by**, `fundedSource`). WSUSA decides each line: a line funded for less than its total unlocks its budget line so the club can ask another source for the rest (`funding/locks`, one rule for the budget and the Events Builder). Approving creates the invoice and its task in the same step; the scheduled job reminds the deciding office's staff once when a request passes that office's review time (business days) or an invoice passes its due date. |
| Costs in Events Builder *and* Budget *and* Calendar | Event costs are entered only in the Events Builder (they belong to the event; recurring events multiply by occurrences). General costs and all funding requests are entered only in the Budget tool. Calendars show costs read-only and link to Budget to request funds. |
| Officer "gate" vs. clubs needing officers to work immediately | Requirements with a grace period (default 30 days; set 0 for a hard gate). Permissions pause, the title stays. |
| A requirement about one permission (Event Safety Training for anyone with Events) vs. pausing a whole role | `RoleRequirement.gatesCapability` names one Capability: the requirement reaches only leaders who hold it (presidents, VPs and advisors hold all; other seats what they grant, read from their roles, never from their pauses), and overdue it pauses only that permission. The title and every other permission keep working; `ClubAccess.pausedCapabilities` and `authz pausedNote` say "Events is paused until you finish Event Safety Training". Without it, an overdue requirement pauses every leader permission, as before. `RoleRequirement.officeId` makes it an office's: it reaches only that office's clubs and uses that office's own Test Tool tests and forms (`Test.officeId`), and in Admin → Requirements an office's staff see and manage only theirs (WSUSA's admins see all, labelled by office). One reach rule (`authz/requirement-rules` `requirementReaches`, `pauseFor`) serves getClubAccess, the batch evaluator, the sync (gaining or losing the permission opens or cancels the task: `roles.setRolePermissions` re-syncs) and the header's pauses read from stored tasks (`authz/people capabilitiesFromTasks`). |
| Risk-based event review | The Events Builder asks "Does this event involve…": an outdoor common space, people under 18, travel or an overnight stay, more than `events.largeCrowd` people (System settings), collecting money, alcohol. Travel asks for the trip right there (destination, leaving and returning, overnight, drivers picked from the club or typed, notes), checked in the domain. Nothing checked: posted on save, as before. Anything checked, with `events.riskReview` on: the event is PENDING, with one APPROVAL task in the club's office's queue (`sourceType` `eventReview`), decided on Admin → Event reviews (`/admin/events`): approve (with an optional note) or ask for changes with a note (CHANGES_REQUESTED; the club's next save sends it back). Until it's approved only the club's leaders and that office see it (`authz/event-visibility`: every list and feed shows published events only, and only the Events Builder's calendar and the event page let the others in), and nothing goes out: no follower notices or reminders, no Google Calendar copy, ICS, search, co-host invitations or check-in. Approving does what posting does: Google sync, co-host invitations, feeds and search. Re-review: a published event goes back to PENDING when a save adds a flag or changes the trip; removing flags never needs review; university events are never reviewed. Review off: the answers are saved, nothing waits. Rules in `lib/events/review` (pure). |
| The old system (weberorgs.dserec.com) asked for personal details, three agreements and club details inside every club's sign-up | Each datum has one home. Personal details live once on the person (`PersonalDetails`, private), reused by every club and confirmed yearly through a PROFILE requirement. The waiver, anti-hazing and non-discrimination agreements are one yearly WSUSA form for all clubs. Club email, social links, category, advisor and meetings live on the club (profile editor, advisor invite, Events Builder). Re-registration is a yearly **club renewal** (`domain/renewals`, one `ClubRenewal` per club per academic year): the platform computes the checks (profile complete, a President, an advisor, constitution and bylaws in effect; recommended: a VP and an event this term), the President, a VP or an advisor confirms the club will be active and renews ("Re-registered 2026–27"), and WSUSA sees who hasn't under Club approvals → Renewals. Nothing is paused or retired automatically. Event setup/cleanup minutes and a Practice type are in the Events Builder. Not carried over (yet): WSUSA pre-approving every event (only events with risk flags wait for their office: see risk-based review below), the club-sports lineup and a separate travel form (Travel in the Events Builder asks for the trip), the driver roster (every roster row was "approved", so it said nothing), compliance points (the clubs checked showed 0), and separate logo approval (WSUSA sees the logo when it reviews the club). |
| One-tap "Are you here? Check in" vs. proof of being in the room | In person, check-in takes the rotating QR code, or the event's code typed from the screen (members of the host or co-host clubs only); the app never shows an in-person event's code remotely. Only online events (nothing to scan) get the one-tap prompt (`rules.allowsTapCheckIn`), and those check-ins are stored as `TAP`. Method labels everywhere: "QR scan" (`QR`), "Typed code" (`SELF`), "One-tap (online)" (`TAP`), "Added by a leader" (`MANUAL`). The old per-event "self check-in" switch and its column are gone, and so are event "ideas" (undated drafts): every event is on the calendar or cancelled. |
| Critical WSUSA tasks members or leaders must fill out | No second tool: a WSUSA **form** is a Test-Tool test with grading off, required through Admin → Requirements (members, leader roles or both). Anything WSUSA requires or assigns is a `required` task: first in every list, its own card on /tasks, a badge on the dashboard, the top of mobile Home. Only leaders can be gated; overdue members just see it overdue. A new requirement's clock starts the day it's added, so nobody starts out overdue. A test handed in on time and waiting for grading never counts against anyone ("Submitted — waiting for grading"; `authz/requirement-rules`); it's met once graded as passed. Tests outside the requirements engine (club quizzes, WSUSA tests sent to chosen people) are `TEST` tasks ("Club test"), so only WSUSA requirements wear the Requirement badge. |
| VP permissions vs. role assignment | Rank rule: assign only below your rank; President may also name a President. |
| A new President mid-way through renewal (and terms of office in the bylaws) | **One renewal window for every club**: it opens with the academic year's first term and is due `renewal.dueDays` later, whatever a club's bylaws say about terms (one academic year, one semester, until succeeded, the month new leaders take office); per-club timing isn't built. Instead the renewal tasks follow the seats right away: one per-club sync (`domain/renewals.syncClubRenewal`, the plan pure in `renewals/rules.renewalTaskPlan`) runs after every role change (from `staffing.staffingAfterRoleChange`, so the org chart, hand-offs, applied elections and next in line, confirmed proposals, advisor acceptance, staffing fixes, graduations and members leaving all reach it) and from the daily "Club renewals" job, which syncs only the clubs out of line. While renewal is open and the club hasn't renewed, each current President and advisor has one required "Renew {club} for 2026–27" task (due on the one due date, marked as required by the club's office); someone who takes the seat gets theirs at once, with a bell and a card that say it's theirs to finish ("You became President on Oct 9, after renewal opened…", and "before you took office" when it was already late), and the outgoing President's is cancelled. Renewing closes them as done; nothing happens without a window, for clubs that aren't asked, or once the club renewed. |
| Proof of who leads a club (a bank account, a room booking, a sponsor) | One **officers of record** letter (`lib/documents/officers`, one read model for the PDF and the verify page): the club, "Overseen by …" with that office's public contacts from its `Office` row, recognized since (its approval) and this year's re-registration (or not yet), its current pipeline officers (President, VPs, officer seats in chart order; a program's own ambassador seats; never a regular club's placed College Ambassador) with titles and start dates, its advisors, and the date issued. Names, titles and dates only: no student's contact details are read or printed. **Download officers of record (PDF)** on the org chart and the admin club page; who may download is who opens the workspace (`isLeader`: Ambassador and up, advisors, admins and the club's office staff), for approved clubs only, each download logged privately (`officers.downloaded`, `domain/officers`). Its QR code and link are a `/verify/[token]` link of kind `officers` (subject the club; HMAC, no table) that shows the officers as they stand today, or that the club has since retired. |
| Clubs left without leaders | `domain/staffing` runs after every role change (roles, memberships). When a change ends the last President, the last advisor, or the last person who can approve join requests in a gated club, WSUSA gets one task per gap (due when the club's bylaws say the seat must be filled) and the remaining leaders are told; the task closes when the seat is filled. Only transitions open tasks, so clubs that were already leaderless don't flood the queue (they're the "No President" / "No advisor" filters in Club analytics). Join requests nobody can approve go to WSUSA after 7 days. Graduating as a club's last President shows a warning with a link to hand off first. |
| One queue, by office | `analytics/admin.officeQueue(scope)` is the only definition of what's waiting on an office: the dashboard, the admin Overview, the admin nav counts and the daily digest all read it, with the viewer's scope (`queueScopeFor`). WSUSA's admins see WSUSA's queue by default (the umbrella's tasks plus those of any office nobody staffs), with a filter for each office or All offices; an office's staff see theirs. "Past review time" uses each office's own `reviewDays`. |
| Several campus offices oversee clubs (WSUSA, Campus Recreation, Fraternity & Sorority Life) | One office per club (`Club.officeId`). **The umbrella invariant:** exactly one office is the umbrella (WSUSA), nothing points at it by id, and a null `officeId` (Club, Task, Test, RoleRequirement) means it; setting anything to the umbrella stores null (`offices/rules storedOfficeId`). Its staff are the platform admins; every other office's are its `OfficeMember` rows, faculty or staff only. New clubs: Sports scope → Campus Recreation, FSL category → Fraternity & Sorority Life, else WSUSA; re-derived while founding, then only WSUSA moves a club. `createTask` routes ADMINS tasks by `offices/rules routeAdminTask`: a club's work to its office; reports, review moderation, department requests and Google account checks to WSUSA; funding and invoices to the club's office only when it decides funding (else WSUSA); a university test's grading to its office. Moving a club moves its open admin tasks by the same rule. An office with no staff falls back to WSUSA's admins (`officeStaffIds`, `taskScopeFor`), so nothing goes unseen. Club-matter notices go through `notifyOffice`. Students see "Overseen by …" with that office's contact. |
| Event changes and reminders | Members and followers of the host and co-host clubs hear when a date in the next two weeks is cancelled, moved or changes place (a series change is one summary; cancellations within 48 hours are also emailed). The scheduled jobs remind people about 45–75 minutes before events ("Remind me before events" in Settings), and 7 days and 1 day before a WSUSA requirement is due; a check-in that unlocks reviews says so. `ReminderLog` keeps every reminder to once. |
| How notifications are delivered | One registry (`components/notifications/catalog.ts`, enforced by a test) gives every kind a category and default channels; in-app is always on. People choose email and push per category in Settings → Notifications ("Email me notifications" still turns all email off); account and staffing notices always send. Any send to more than 50 people writes the bells at once and queues email and push (`QUEUED` in the outbox) for the "Send queued messages" job, about 200 per run. Admins get one daily digest of the WSUSA queue instead of an email per routine submission; urgent items (reports, review bombing, staffing gaps) still email at once. |
| Auto-enroll on check-in vs. membership gates | Check-in always records attendance. Open clubs: you become a member. Gated clubs: a join request is filed. |
| Ambassador role "set up at the college level" | Each college may have a **College Ambassadors** org (a club of type `COLLEGE_AMBASSADORS`), started only by an admin (Admin → Club approvals → Ambassador programs; students can't found one). The admin also appoints its **advisor** there: one faculty/staff member per program, the college's point person, who runs its elections and leadership pipeline with its President (`ambassadors.setAmbassadorAdvisor`; programs take no advisor invitations). Its leaders place Club Representative Ambassadors into the college's clubs; placements are `AMBASSADOR` role assignments with `viaClubId`. A club can't fill its own College Ambassador seat: its leaders press **Request a college ambassador** on the org chart, which files an APPROVAL task in the program's inbox (`sourceType` `ambassadorRequest`, `sourceId` = the club, one open at a time). It closes when the program places someone, declines with a note, or the club withdraws it. |
| Calendar subscription vs. registration | Separate. Registering subscribes you; you can subscribe without registering (once signed in). |
| A calendar page *and* an events list | One **Events page** (`/events`; the URL holds every filter, so any view can be shared): **All of Weber State** or **Mine** (the clubs you subscribe to), as a list or a month. `/calendar` redirects to Mine as a month. Filters: Today, Tomorrow, This weekend (Friday 5 PM through Sunday), Next 7 days or a date; type, category, free food, free stuff, service hours, online or hybrid, clubs you follow. Rules in `lib/events/rules`, parsing in `lib/events/browse-params`, the one query in `lib/events/browse`. |
| Event covers, perks and hybrid events | Set in the Events Builder only. A cover is one of the host club's own **public** images (a university event's comes from University files); uploading one there files it in the club's Flyers folder. Perks are badges and filters (free food, free stuff). An in-person event with an online link is **hybrid**; check-in stays in person (QR or typed code), and only online events get one-tap. |
| Service hours: logged vs. earned | Earned only by checking in. The event creator turns on **Counts toward service hours** and enters the hours each attendee earns per date (whole quarter hours, never more than the event's length; Service projects start on, at the event's length up to 8 hours). Nobody logs hours by hand, so there's nothing to approve, and fixing attendance fixes the totals. |
| Club "college" field (some independent / university-wide / sports) | `scope` = College · University-wide · Independent · Sports; `collegeId` only for College. |
| Department "Other" | Founder types it (`requestedDepartmentName`); an admin task adds it to the list and links the club. |
| Advisor must accept | Invite by name + @weber.edu email → email + in-app request (task). Accepting makes them ADVISOR. Submission for review requires an accepted advisor. |
| Starting a club that already exists | The Start a club wizard runs the club search on the proposed name and short description as the founder types (`lib/search/similar`, debounced) and shows **Similar clubs already exist**: approved clubs with **Join instead**, retired ones with **Ask to revive it**, each with its standing from `lib/metrics` (active, pilot, inactive with "No events since March", or retired) and its members. Approved clubs come from the search index; retired clubs aren't indexed, so a separate name match finds them (`similar-rules`: typos, plurals and half-typed words count, rarer name words weigh more, and common ones like "Wildcat" can't make a match alone). Nothing blocks creating the club: the office reviewing it sees the same list on its review page and decides. |
| Bringing a retired club back | A student asks with **Ask to revive it**: one open APPROVAL task per club, routed to its office (`sourceType` `clubRevival`; the "Revival requests" queue row and Club approvals tab), and its staff are told (`notifyOffice`). The office approves (the usual reinstate path, then the student takes the President seat through `roles.grantRole`, told once) or declines with a note; the student hears either way. Reinstating the club any other way closes the request. Only students ask, since they'd lead it. |
| Founding alone | Founders (the President while the club is being founded, or whoever started it: `authz/founding isFounder`) invite fellow students as **co-founders** by name and @mail.weber.edu email (`domain/cofounders`), at most 8 waiting. Invitees with an account get a task and a notification; others an email with the link, and the task once they sign in. Accepting makes them a member with source FOUNDER, so a founder can seat them on the founding org chart before approval (until they have a seat they see the club's page, not its workspace). Decline, cancel and resend work like advisor invites; open invitations close when the club is decided or retires. |
| A forming club vs. clubs going public only once approved | Founders may **List this club as forming** (wizard, Settings). Signed-in accounts then see it in the clubs list's **Forming** section (the plain list, not search results) and on a minimal page: its name, short description, founders' names (never their contacts) and Follow. Signed-out visitors see nothing. Forming clubs stay out of search, the network map and analytics. Following is the usual calendar subscription; approval and rejection turn the flag off, and approval tells followers "{club} is now an official Weber State club". |
| Anonymous reports | No reporter id is stored at all; the reporter gets a case code to check status. Every opening by an admin requires acknowledging the anonymity notice and is logged. Never in notifications, the activity log, exports or the AI. |
| Review bombing | Reviews need ≥3 attended events (sysadmin-set, uniform). One review per person per club. ≥3 ratings ≤2★ within 48h opens an admin task. Admins can hide reviews; members can flag. |
| Secret ballots | Votes record voter (one vote each) but no screen ever joins voter to choice. Results apply through the Org Chart path. |
| How leaders are chosen (seniority vs. votes vs. appointment) | Every org chart is a **leadership pipeline** (`lib/roles/pipeline`): President → Vice President → officer seats in order → members. The college's ambassador seats sit outside a regular club's pipeline. Filling a seat is one selection on the Election lifecycle, in one of four modes: **Advisor & President** (the default; one proposes, the other confirms, no ballots), **Next in line** (the seats just below are asked; the first in line who says yes moves up), **Self-select** (current leaders' secret ballot; counts only if unanimous; no one votes for themselves) and **Member vote** (active members' secret ballot). People below the seat start as candidates. A club's constitution names its primary mode (`successionMethod`), and the President and advisor may use any other mode for a given seat. Results apply through `roles.assignRole`/`endRoleAssignment`, and whoever moves up leaves their old seat. The bylaws' voting answers are real rules (`constitution` `clubRules`, read from the adopted documents' `builderAnswers`), frozen into `Election.rules` when a selection starts: events attended to vote, quorum, how ties break (runoff, advisor or President), the notice before voting opens, and the default voting window. Answers no engine enforces (minimum GPA, dues, term length, amendment and removal votes) are marked in the builder as the club's and WSUSA's to enforce. |
| Club search (names only vs. what's on the page) | One engine (`lib/search`) serves /clubs, the mobile clubs list and the assistant. Each approved club's visible content is a weighted Postgres full-text document in two versions: public, and public plus "Weber State only". That content is the name and acronym, labels, descriptions, seats, events, public announcements, constitution, reviews and public file names. Members- and leaders-only content never goes in. Ranking = relevance (with a query) + popularity from `lib/metrics` + personal signals (majors, co-members, attendance, follows). Each card shows at most two reasons, and they only ever give counts. "Found in …" snippets show where a match came from. Writes reindex their club right away and the "Club search" job catches the rest. Searches are logged with no account attached, so WSUSA can see what students look for and don't find. |
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
lib/authz/                THE permission authority (+ requirement gating, capability holders, admin scope by office)
lib/offices/              who oversees a club: the umbrella, officeForClub, officeStaffIds, notifyOffice; rules.ts (pure): routing, the new-club rule
lib/founding/rules.ts     founding (pure): forming, co-founder and revival names and rules; lib/authz/founding: who founds, who sees a forming club
lib/domain/               THE write path (one module per area) + kit.ts conventions
lib/metrics/              derived numbers (read-only)
lib/search/               club search: index build, matching, ranking (pure), snippets, query log; similar.ts: clubs like a proposed one
lib/roles/pipeline.ts     leadership pipeline order and the four selection modes' rules (pure)
lib/lake/activity.ts      the activity stream
lib/integrations/         Google, email, push, Anthropic adapters (mock when off)
lib/events/recurrence.ts  recurrence expansion (semester-aware)
lib/events/rules.ts       covers, perks, hybrid links, service hours (pure); browse-params / browse: the Events page
lib/metrics/service.ts    service hours, from attendance (a person's record, club and term totals)
lib/attendance/token.ts   check-in codes & rotating QR tokens
lib/documents/            PDF kit (page, header, tiles, tables, verification QR), signed verify links, the involvement record, the officers of record (officers.ts, officers-pdf.tsx; downloads in lib/domain/officers)
lib/renewals/             yearly re-registration: the window, checks, who renews and the per-club task plan (rules.ts, pure); facts.ts loads the checks
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
* Raw SQL with dates: the Postgres server runs in America/Denver and Prisma sends a JS `Date`
  parameter as `timestamptz`; compare with `(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`
  against our `timestamp` columns (see `lib/metrics`). Prisma's normal filters are unaffected.
* Writing files in this repo from Claude sessions: the desktop app's worktree guard blocks the
  editor tools here, so edits go through the shell (`tools/replace.py` for exact replacements).

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
| Test personas | `AUTH_MODE=mock|google|both` (default both outside production; production is Google-only unless `ALLOW_TEST_SIGNIN=1`) | — |

**Club Google accounts.** Drive, Calendar and Chat sync run as a club's own Workspace account (its
contact email, through domain-wide delegation) only for APPROVED clubs, and only after WSUSA
verifies the account (Admin → Club approvals → club → Club Google account; an ADMINS task with
sourceType `googleAccount` asks for it). Changing the address clears the verification and the
club's Google IDs (calendar, Drive folder, Chat space, and the copies in them), so the next sync
builds fresh ones in the new account. `lib/integrations/google` `clubGoogleAccount()` is the one
check every adapter uses.

**Redirects.** Any `next=` / `returnTo` parameter that becomes a redirect goes through
`safeNext()` from `lib/auth/redirect` (client-safe): it returns the value only when it's a
same-site path, else `/dashboard`.
