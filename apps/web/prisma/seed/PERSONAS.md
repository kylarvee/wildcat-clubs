# Wildcat Clubs — test personas

The mock database gives every role in the platform a ready-made account with a
realistic history. Sign in at **/login** and pick a persona (personas are on
whenever `AUTH_MODE` is `mock` or `both`, the default outside production).

Its approved and retired clubs are Weber State's real clubs
(`data/wsu-directory.json`, the public club list) with their real names,
purpose statements and contact emails. Every person, membership, event and
record in them is invented.

```
cd apps/web
npm run db:reset    # fresh schema + seed (~10 s)
npm run db:seed     # re-seed only (clears every table first)
npx tsx prisma/seed/verify.ts   # checks that every scenario below still holds
```

**Time matters.** The seed is anchored to the moment it runs: "live now",
"later today", "due in 10 days" and "the last 30 days" are relative to that.
Re-run `npm run db:seed` right before a testing session. The terminal output
ends with the exact check-in codes and the name of the officer whose
permissions are paused.

| Persona | Email | Role | Best for testing |
|---|---|---|---|
| Sam Rivera | sam.rivera@mail.weber.edu | New student | First visit, registering, join gates, first check-in |
| Maya Chen | maya.chen@mail.weber.edu | Club member | Check-in (live now), voting, reviews, calendar, attendance |
| Oscar Nguyen | oscar.nguyen@mail.weber.edu | Officer (Treasurer) | Budget & funding, officer test, requirement grace period, being asked to move up |
| Vanessa Brooks | vanessa.brooks@mail.weber.edu | Vice President | Co-host approval, VP limits, a self-select result she can't apply, member details that still need confirming |
| Priya Patel | priya.patel@mail.weber.edu | President | Running a big gated club, QR check-in screen, the leadership pipeline |
| Amir Haddad | amir.haddad@mail.weber.edu | College ambassador | Ambassador placements without capabilities |
| Frank Okafor | frank.okafor@mail.weber.edu | Club founder | Founding a club: draft, advisor invite, submission |
| Gwen Torres | gwen.torres@mail.weber.edu | Alumni | Retired profile, role history, projects |
| Dr. Elena Alvarez | elena.alvarez@weber.edu | Club advisor | Full permissions in two clubs, confirming a proposed Vice President |
| Prof. Nathan Reed | nathan.reed@weber.edu | Invited advisor | Accepting an advisor invitation |
| Alex Morgan | alex.morgan@weber.edu | Administrator (WSUSA) | Every admin queue |
| Sydney Park | sydney.park@weber.edu | System administrator | System settings, AI and integration switches, outbox |

Check-in codes are fixed: **HERE26** (live now), **LATER7** (later today),
**BUILD8** (RC Wrecker Bots Club, live now). Type them at `/c/<code>` or in the app.

---

## Sam Rivera — new student

**Where Sam stands:** account created minutes before the seed ran. No majors,
clubs, check-ins, tasks or notifications.

1. Sign in — the dashboard should feel empty and point Sam to the clubs list.
2. Open **Clubs**: all 290 approved clubs on the real list (plus the two
   college ambassador orgs). Switch grid/list, filter by category, sort by
   rating, activity, attending members, retention, college or type. Most clubs
   read as Inactive, as they do in reality: dormant clubs with nobody on the
   roster, clubs under 8 members, and four that stopped meeting (Society of
   Physics Students, Actuary Club, Model United Nations Organization, Art
   Guild). Clubs in their pilot period (Data Analytics Club, First Generation
   Club at WSU, Swing Dance/ Social Dance Club) read "Pilot period".
3. Register for **Chess Club** (open): Sam becomes a member at once, follows
   the club's calendar, and a "You're in!" toast confirms it. (The "get the
   app" prompt shows instead once a sysadmin adds a store link in System
   settings → Mobile app links.)
4. Register for **RC Wrecker Bots Club** (approval gate): the request is
   pending. Sign in as Priya or Dr. Alvarez to see it in Tasks.
5. Follow **Incredibly Strange Movie Night (ISMN)**'s calendar without
   registering.
6. Check in at the live service event: Sam isn't a member of Wildcat Service
   Club, so typing **HERE26** is refused (typed codes are only for the host and
   co-host clubs' members). Scan its QR code instead, shown on another device
   from the club's Attendance screen (signed in as Alex, say). The club is
   open, so the check-in also makes Sam a member.
7. Try to review a club — it stays locked until Sam has attended three events.
8. **Report a concern** anonymously and keep the case code.

## Maya Chen — club member

**Where Maya stands:** active member of Psi Chi Honors Club / Psi Cho
(Psychology Club) (since fall 2024), Pre-Med Club (spring 2025), Hiking and
Outdoors Club (fall 2025, approval gate) and Wildcat Service Club (joined two
weeks ago, one check-in). She has three or more check-ins in the first three,
so she can review them; she already gave the Hiking and Outdoors Club 5★. She
follows ISMN's calendar without joining. Her member details are complete and
confirmed for this year.

1. **Check in, live now.**
   - In person: Wildcat Service Club's *Care Kit Assembly for the Weber Cares
     Pantry* started 15 minutes before the seed ran and ends 105 minutes after
     it. In-person events have no pop-up: scan the QR code, or, as a member,
     type **HERE26** (it shows as "Typed code"). About nine people are already
     checked in.
   - Online: Pre-Med Club's *Online MCAT Study Hall* (Google Meet) started 10
     minutes before the seed ran and runs two hours. Online events are the
     only ones with the check-in pop-up: open Pre-Med Club's page (web or
     app), the dashboard or the app's Home, then **Check in** — or **Not now**.
     One tap shows as "One-tap (online)"; about six members already checked in.
2. **Later today:** Psi Chi's *Grad School Q&A with Psychology Faculty*
   starts about three hours after the seed ran (code **LATER7**; check-in opens
   30 minutes before).
3. **Vote:** Psi Chi → *President — Spring 2027* (member vote, the club's
   primary method; three candidates — the two officers below the President
   came from the org chart, a third member ran; closes five days after
   seeding). Maya is an active member and hasn't voted.
4. **Review** Pre-Med Club or Psi Chi. Her Hiking and Outdoors Club review can
   be edited or deleted.
5. **Attendance tracker** (`/me/attendance`) and her record on each club page.
6. **United calendar:** four clubs, ISMN (followed only) and university
   events.
7. **Messages:** an unread DM from Priya; three unread messages in the
   Psi Chi chat.
8. **Profile** (`/u/mayachen`): barista job, summer research internship,
   education, club roles (none — she's a member).

## Oscar Nguyen — officer (Treasurer)

**Where Oscar stands:** Treasurer of Wildcat Investors since about 20
days before the seed (the previous treasurer resigned two days earlier). His
seat grants only the `budget` capability. Neither officer requirement is met
yet, but he's inside the grace period: the **Club Officer Policy Test** is due
about 10 days after seeding (30-day grace) and **Club Officer Training** about
25 days after (45-day grace).

1. Open the club workspace: **Budget & funding** is unlocked; tools his seat
   doesn't grant are locked.
2. **Budget:** event costs (from the Events Builder, some per-occurrence) and
   general costs for this term and next.
   - Submit the **DRAFT** *Spring 2027 Stock Pitch Competition* request.
   - *Fall speaker series* is **SUBMITTED** and waiting on WSUSA.
   - History: last spring's approved request with a processed invoice.
3. **Tasks:** *Pass: Club Officer Policy Test*, *Attend: Club Officer Training*
   and a club task from his president, *Reconcile September spending*.
4. **Take the officer test:** info page with an embedded video, "are you sure?"
   confirmation with the 30-minute limit, eight choice questions and two open
   answers. Submitting sends it to review (open answers need a person). His
   task then reads *Submitted — waiting for grading*: handed in on time, it
   never pauses him while it waits, even past the deadline. If it's graded
   as not passed, the usual deadline applies again.
5. **Officer Training makeup session** is on the calendar (a Wednesday about a
   week out, 5:30 PM, Shepherd Union 404A). Checking in completes the training
   requirement.
6. Optional: the **Funding Rules Refresher** test (open to anyone).
7. **Move up?** Wildcat Investors' Vice President stepped down, so the club
   (whose primary method is **Next in line**) asked its officers whether
   they'll move up. One officer behind Oscar in line said yes, the others
   said no, and Oscar hasn't answered: *Move up to Vice President?* is in
   his Tasks and on the club page. Yes puts him first in line (he'd move up
   when the round closes and the result is applied); no takes him off the
   list. Answers are due about four days after seeding.

## Vanessa Brooks — vice president

**Where Vanessa stands:** VP of the Society of Women Engineers (SWE) since May
2026 (Secretary the year before). SWE's primary way of choosing leaders is
**Self-select**: its leaders vote, never for themselves, and it counts only if
it's unanimous. She has met both officer requirements. She's also a member of the RC Wrecker Bots
Club. Her member details are filled in but **not confirmed** this year, and she
hasn't signed the *Club Member Agreements* form.

1. **Tasks → co-host request:** Cyber Security Club (CSC) asked SWE to co-host
   *Women in Cybersecurity Panel* (about nine days out). Approve it and it lands
   on SWE's calendar.
2. **Org chart:** she can assign officers but **not** President or VP, and
   can't retire the club. SWE has no College Ambassador, and only EAST
   Ambassadors can place one: the card under the chart has **Request a college
   ambassador** (with an optional note). The request lands in the program
   leaders' Tasks.
3. **Elections:** *President — Spring 2027* (self-select) is **CLOSED**: everyone
   below the President started as a candidate, all but two withdrew (Vanessa
   among them), and every other leader chose the same one — unanimous. It's
   waiting to be applied. As VP she can't apply a presidential result; SWE's
   president (graduating in December), its advisor or an admin can.
4. SWE's *Girls in STEM Robot Day supplies* funding request is submitted.
5. Messages: a DM thread with Priya about co-hosting.

## Priya Patel — president

**Where Priya stands:** President of the RC Wrecker Bots Club since May 2026
(VP 2025–26, Events Coordinator 2024–25). About 90 members, an
**approval gate** with **five pending join requests**, Tuesday build nights,
and regular co-hosted events with CSWS (The Computing Society at Weber State)
and SWE. Both officer requirements met; the *Annual Club Re-registration* form
is still hers to fill out. The club runs its own *Event Safety Quiz*.

1. **Members:** approve or decline the five requests — their tasks close for
   everyone with the roster capability.
2. **Attendance:** *Open Build Night (extra session)* is live now (code
   **BUILD8**, about 12 already checked in). Open the rotating QR screen: it
   tells members of the RC Wrecker Bots Club they can type the code if they
   have no camera (typed codes are only for the host and co-host clubs'
   members). Add someone by hand, then look at the tracker (every meeting ×
   every member, each mark showing QR scan, Typed code, One-tap (online) or
   Added by a leader) and retention.
3. **Org chart & history:** role history back to fall 2022 with hand-offs,
   December graduations, resignations and empty seats. She can name a
   successor or co-president and could retire the club.
4. **The leadership pipeline** (top of the org chart): every seat in order
   with its holders and who's next in line. The Vice President stepped down
   about nine days before seeding, so Priya started *Vice President — Fall
   2026* with the club's primary method, **Advisor & President**: the
   officers below the VP became candidates, and she proposed the first of
   them in line. It's waiting for Dr. Alvarez to confirm (Priya can withdraw
   it). Any other open seat shows **Fill this seat**, which starts a
   selection in the primary mode or any of the other three. The College
   Ambassador seat belongs to the college's program (EAST Ambassadors), so it
   has no Fill or Assign button. Priya asked EAST Ambassadors for one about two
   days ago: the card under the chart shows the request as **Requested**, with
   **Withdraw request**.
5. **Events:** upcoming co-hosted *Wrecker Bots × CSWS: Intro to Embedded
   Programming* and *Girls in STEM Robot Day*.
6. **Budget:** *Combat robotics competition travel* is approved with an open
   invoice.
7. **Club tests:** results for the Event Safety Quiz.
8. **Messages:** the *Engineering club presidents* leaders group and DMs with
   Maya and Vanessa.
9. **Network map:** the RC Wrecker Bots Club should be highlighted and sit near
   the other EAST clubs.

## Amir Haddad — college ambassador

**Where Amir stands:** Club Representative Ambassador in **Goddard School
Ambassadors** since fall 2025, placed as *College Ambassador* in **Beta Alpha
Psi** and **Weber Association of Marketing (WAM) / Marketing Club** (ambassador
role, no capabilities). Also a regular member of the Weber Entrepreneurs
Association (WEA).

1. His profile lists the ambassador roles with the org that placed him.
2. Open Beta Alpha Psi's workspace: he's a leader there, but every tool is
   locked until the club grants him a capability.
3. Sign in as Alex to see Goddard School Ambassadors' placement view: clubs
   ask for an ambassador from their org chart, and requests show first there
   with **Place an ambassador** or **Decline**.

## Frank Okafor — club founder

**Where Frank stands:**
- **Wildcat Beekeeping Society** — DRAFT, started about nine days before
  seeding. The profile is half-finished (no short description, an unfinished
  About), a constitution draft is started, and his advisor invitation to
  Prof. Nathan Reed is pending.
- **Wildcat Puzzle Society** — SUBMITTED about five days before seeding.
  Advisor accepted (after an earlier invitee declined); constitution and bylaws
  adopted with the builder. Waiting on WSUSA.

Both are new clubs, so they're fictional, and their names don't overlap any
club on the real list.

1. Finish the Beekeeping profile; submission stays blocked until an advisor
   accepts.
2. Open Wildcat Puzzle Society: "in WSUSA review" with the reviewers' contact details
   and office; profile, org chart, constitution and files are still editable.
3. Full loop: sign in as **Nathan** to accept, back as Frank to submit, then as
   **Alex** to approve.

## Gwen Torres — alumni

**Where Gwen stands:** graduated May 2026 (status ALUMNI). VP then President of
the **Applied AI Lab** (May 2024 – May 2026, ended *Graduated*); she won the
2024 member-vote election. Two projects are tied to her presidency with files
(a report PDF, an architecture diagram, workshop slides). Post-grad job and
education on her profile.

1. `/u/gwentorres`: the retired profile keeps roles, projects and files.
2. Applied AI Lab's org chart and role history show her years, plus two applied
   elections.
3. Try to register for a club — alumni accounts can't join new clubs.

## Dr. Elena Alvarez — advisor

**Where Elena stands:** advisor of the **RC Wrecker Bots Club** (since its
founding in 2022) and **Pre-Med Club** (since May 2024, after the previous
advisor's term ended). Full permissions in both.

1. Every tool in both workspaces is unlocked; she sees the Wrecker Bots' join
   requests.
2. **Tasks → *Confirm … as Vice President*** (also on her dashboard): Priya
   proposed an officer for the Wrecker Bots' open VP seat. Confirming puts
   them in the seat, and the officer seat they leave opens up in the
   pipeline; she can also send it back.
3. Pre-Med Club: an outgoing co-host request to the National Student Nurses
   Association (NSNA) Ogden Campus and a partially approved funding request.
4. Advisors can assign any role and apply election results.
5. Pre-Med Club's org chart: the College Ambassador card says the College of
   Science doesn't have an ambassador program yet (WSUSA starts them).

## Prof. Nathan Reed — invited advisor

**Where Nathan stands:** no clubs. Frank invited him to advise Wildcat
Beekeeping Society (task, notification, and a mocked email in the outbox).

1. **Tasks** → open the invitation → accept (he becomes advisor) or decline.

## Alex Morgan — WSUSA administrator

**Queues waiting for Alex:**
- **Club review:** Wildcat Puzzle Society.
- **Department request:** "Aviation Technology" for Aviation Club (changes
  requested, with a note).
- **Custom bylaws:** Associated Artists of the Theatre (AAT)'s uploaded bylaws
  (pending approval).
- **Funding:** three submitted requests (Wildcat Investors, SWE, NSNA) and two
  open invoices (RC Wrecker Bots Club, Black Student Union (BSU)).
- **Review bombing:** Ogden Valley Disc Golf Club got four 1★ reviews within
  36 hours; members flagged them. One older Wildcat Paintball Club review is
  already hidden.
- **Reports:** five, all on those two clubs (two anonymous — opening one
  requires acknowledging the anonymity notice, and every opening is logged).

The two are fictional **demo clubs** (approved, with members, events and
check-ins) made to carry these incidents, so nothing negative is invented
about a real club.
- **Tests:** five officer-test attempts with open answers to grade (each also a
  task in Tasks). All five were handed in on time, so those officers' tasks
  and their cells in Admin → Requirements read *Submitted — waiting for
  grading*, and none of them is paused.
- **WSUSA requirements:** one officer is past the grace period, so their
  permissions are paused (the seed prints who). Their club workspace banner,
  *Permissions paused*, names what's overdue and links to it.
- **Ambassador programs** (Club approvals → Ambassador programs): only admins
  start a program and choose its advisor ("Change" appoints someone else and
  ends the previous advisor's role). In **EAST Ambassadors → Ambassador
  placements**, the RC Wrecker Bots Club is waiting on its request (badge
  "Asked for one"). Place one of the program's club representatives, or
  decline with a note; Priya's card updates either way.

Also try: policies (eleven published, one draft, one shown from a PDF),
trainings, university-wide announcements, analytics, directory and people.

## Sydney Park — system administrator

Everything Alex can do, plus **System settings**: activity windows, the review
threshold (3) and review-bombing rule (3 ratings ≤ 2★ in 48 hours), AI switches
(off), integrations (mock mode), the **outbox** (mocked emails, plus one failed
push), scheduled jobs, and granting admin.

---

## Other things in the data

- **300 clubs.** All 292 clubs on Weber State's list: 290 approved and 2
  retired (Photographic Society and Ballroom and Hip Hop Club, with full role
  history). Plus the two college ambassador orgs (Goddard School Ambassadors,
  EAST Ambassadors — platform structures, not on the list), two fictional
  approved demo clubs that carry the reports, review bombing, hidden review
  and roster removals (Wildcat Paintball Club, Ogden Valley Disc Golf Club),
  and four fictional new clubs: Frank's draft and submitted clubs, Aviation
  Club (changes requested) and Campus Poker League (rejected, with the
  reason). Real clubs get no rating below 3★, no flags and no reports.
- **Story clubs.** About 40 of the real clubs carry the walkthroughs above and
  keep their story's size and history (the RC Wrecker Bots Club has ~90
  members, though its real roster is smaller). They keep a stable key in
  `data/clubs.ts` (`robotics`, `swe`, `psych`…); slugs follow the real names.
- **The rest of the list follows the real roster.** Clubs with people on it get
  about that many members, officers in the seats the list shows (president,
  VPs, other officers, advisors), a weekly or biweekly meeting and a light
  event history; with 8+ members they read as active. Clubs with nobody on the
  roster are dormant: approved, at most two members, no officers or advisor,
  and nothing on the calendar this academic year or last. About 68 of the 292
  approved clubs read as active.
- **Categories.** Every club has a WSUSA category (Academic, Cultural, FSL,
  Honor society, Service & advocacy, Student life, Religious) and a type:
  Sponsored for department-connected academic clubs, Registered for
  independent ones, Affiliate only for FSL and club sports. About pages are the
  clubs' own purpose statements (or one neutral line when the list has none);
  contact emails are the real ones. No websites or social links.
- **About 850 active students** and ~160 alumni who held earlier roles, ~100
  faculty and staff (a faculty member in every department), and 2 more WSUSA
  admins. Names, pronouns and gender agree with each other.
- **Member details** (Settings → Member details) for every active student
  except Sam, and most faculty and staff — all invented: W0-numbers,
  801-555-01xx phones, example.com emails, generated street numbers in Ogden,
  Layton, Roy and nearby towns. About 70% of active students confirmed theirs
  this academic year; the rest still owe it (never confirmed, confirmed last
  year, or a field or two missing). One concurrent-enrollment freshman is 17.
- **Events** from fall 2024 through fall 2026: weekly or biweekly meetings per
  semester (holidays and spring break cancelled), socials, workshops, service
  days and competitions, on campus, off campus and online; co-hosted events;
  Club Officer Training and Funding Workshop every semester.
- **About 63,000 check-ins** with semester-start spikes, pre-finals dips and
  members who drift away at different rates. Officers show up most. Members of
  several clubs in the same college give the network map its clusters.
- **Files:** each approved club that meets has Meeting Minutes, Flyers & Photos,
  Resources (featured on the club page), Constitution & Bylaws (PDFs) and
  leaders-only Officer Notes; dormant clubs keep just their constitution and
  bylaws. Bytes live in `apps/web/storage/seed/`.
- **Leadership pipeline:** each club's bylaws name a primary way to fill
  seats. Most clubs use the default, Advisor & President; a handful each use
  Next in line (Wildcat Investors), Self-select (SWE) and Member vote (Psi
  Chi, Applied AI Lab). Selections in the data: Psi Chi's open member vote,
  SWE's unanimous self-select waiting to be applied, the Wrecker Bots'
  proposal waiting for its advisor, Wildcat Investors' next-in-line round and
  Applied AI Lab's two applied member votes.
- **Role history contributions:** in most approved and retired clubs, one or
  two past leaders have a project tied to the seat they held, usually with a
  file (a club file they made that term, or a write-up in their own files).
- **Event Safety Quiz:** RC Wrecker Bots Club members who haven't passed it
  have a *Take: Event Safety Quiz* task, marked *Club test* (a club's own
  test, not a WSUSA requirement; /tasks has a Tests filter).

All policy text is sample text and says so at the top. People, memberships,
events and reviews are fictional even where the club is real; reports and
incidents exist only on the fictional demo clubs. Building coordinates are
approximate.
