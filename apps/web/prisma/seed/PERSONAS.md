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
| Rowan Ashby | rowan.ashby@weber.edu | Campus Recreation staff | The admin console for one office: sport clubs only |

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
confirmed for this year. She has service hours already: service projects in
her clubs, the latest *WSUSA Day of Service* (3 hours) and the *Weber Cares
Pantry Restock Night* about a week ago (2 hours), both university events.

1. **Check in, live now.**
   - In person: Wildcat Service Club's *Care Kit Assembly for the Weber Cares
     Pantry* started 15 minutes before the seed ran and ends 105 minutes after
     it. In-person events have no pop-up: scan the QR code, or, as a member,
     type **HERE26** (it shows as "Typed code"). About nine people are already
     checked in. It counts toward service hours, so the confirmation says
     **+2 service hours** and My involvement's total goes up by 2.
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
   seeding). Maya hasn't voted. It runs under the bylaws Psi Chi adopted
   about four weeks before the seed, frozen when the vote started:
   - **Who can vote:** members who'd been to at least **2 club events this
     semester** when voting opened. Maya has, so her page reads *You can
     vote* with her count; a handful of the 58 members can't.
   - **Quorum:** the result counts only if **25%** of eligible voters vote.
     The *Voting rules* card shows 9 votes in, short of the 13 or so needed,
     so Maya's vote brings it closer. Ties would go to a runoff, and voting
     opened 10 days after the vote was announced (the bylaws ask for 7 days'
     notice).
   - **As Alex** (or a Psi Chi leader), the manage view (**Manage**) lists
     who can and can't vote, each with their count of events. Closing voting
     early there shows *No quorum*, with **Start again** and **Use another
     way** (that ends this vote until you reseed).
4. **Review** Pre-Med Club or Psi Chi. Her Hiking and Outdoors Club review can
   be edited or deleted.
5. **My involvement** (`/me/involvement`, account menu; the old
   `/me/attendance` address redirects there): her leadership roles (none yet),
   service hours by term and by club with every date, and her attendance
   history, plus her record on each club page.
   - **Download involvement record**: a PDF built fresh on each download, with
     the four summary numbers, Leadership, Service hours, Clubs and attendance
     by term, and WSUSA trainings and requirements. Its footer has a QR code and
     a `/verify/…` link: open it (signed in or not) to see her record as it
     stands now and when the PDF was issued. Change one character of the link
     and the page says *This link isn't valid*.
   - **Try it:** check in to the Care Kit Assembly, then, as Alex, open Wildcat
     Service Club → Attendance → the live event and remove her check-in. Her
     total drops back by 2 hours, and so does a fresh download of the record.
6. **Events** (the header's Events, or the app's Events tab): *Mine* is her
   four clubs, ISMN (followed only) and university events.
   - **Free food** + **This weekend** (Friday 5 PM through Sunday) finds
     Hiking and Outdoors Club's *Trailhead Cookout & Easy Hike*, Saturday at
     11:30 AM at the Waterfall Canyon trailhead (seeded later on a Saturday
     it's on Sunday; seeded late on a Sunday it's next Saturday, so use
     **Next 7 days**). In the app it's the **Free food** chip.
   - **All of Weber State** shows everything she may see. Covers come from
     clubs' flyers (cards without one show the club's color and logo), and
     badges say *Free food*, *Free stuff*, *Service hours · 2*, *Online*,
     *Hybrid* or *Members only*. **Online or hybrid** finds a few workshops
     that are in person with a Meet link too. Search looks at event names,
     descriptions and host clubs.
   - **Month** is the calendar grid with the same filters; **Subscribe** has
     her private feed link (and the university events switch). An event page's
     **Add to calendar** offers Google Calendar or an .ics file. The old
     `/calendar` address opens Mine in Month view.
7. **Messages:** an unread DM from Priya; three unread messages in the
   Psi Chi chat.
8. **Profile** (`/u/mayachen`): barista job, summer research internship,
   education, club roles (none — she's a member). The header shows her
   service hours as one line (*… service hours · … service events*) to every
   signed-in account; only she and WSUSA see which events (the *Service hours*
   card beside it).
9. **Notifications** (the bell, or the app's Notifications tab):
   - ISMN, whose calendar she follows without joining, moved one of its next
     *Screening Night*s to another room: *Screening Night on Fri, … moves to …*.
     Members and followers both hear when a date in the next two weeks is
     cancelled, moved or changes rooms.
   - *Starting soon: Care Kit Assembly…*, the Reminders job's notice about an
     hour before it started, and *You can review Pre-Med Club now* from when
     her third check-in there unlocked reviews.
   - *Psi Chi Honors Club / Psi Cho (Psychology Club) now uses Member vote to
     fill seats* (unread, about four weeks old): when new bylaws change how a
     club fills seats or who can join, every member and WSUSA is told.
   - **Settings → Notifications:** *What reaches you* has a row for each of
     nine kinds of notification with an Email and a Push switch, all on (on
     means the usual: email only for what needs her). *Your account* is always
     on. *Remind me before events* is on, and the push card says no phone is
     getting push yet and how to fix that.
   - **Try it:** turn off Email for *Membership*. Then, as Dr. Alvarez, assign
     Maya a club task in Pre-Med Club (Tasks → **Assign a club task**): it's on
     Maya's bell, and the outbox (as Sydney) has no email to her for it.
   - **Try it:** as Maya, follow the RC Wrecker Bots Club's calendar. Then, as
     Priya, open one of its upcoming *Build Night*s in the Events Builder and
     change its room, or move the whole series to another day or time. Maya
     gets one notice (for the series, a summary like *Weekly Build Night moves
     to Thursdays at 6 PM, starting …*); Priya doesn't.

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
   general costs for this term and next, each in a category the cost pickers
   offer.
   - *Involvement Fair booth* was **partly approved** about a week ago: WSUSA
     funded the T-shirts and giveaways but not the *Retractable club banner*.
     The request shows what each line got, *Funded by WSUSA*, and the invoice
     WSUSA's approval created. A line funded for less than it asked is free
     again, so Oscar asked the Goddard School for the banner: *Club banner*
     (expected source: College) is **SUBMITTED**, which locks that line again
     while WSUSA reviews it.
   - *Fall speaker series* is **SUBMITTED** and waiting on WSUSA.
   - Submit the **DRAFT** *Spring 2027 Stock Pitch Competition* request. The
     club names the source it expects (*Expected source*); the confirm dialog
     asks *Send $… to WSUSA for review?*, since WSUSA reviews every request
     and may fund it from another source.
   - History: last spring's approved request with a processed invoice.
   - **Try it:** once Alex partly approves *Fall speaker series* (see Alex),
     open it: the unfunded line reads *Not funded*, and **Ask another source
     for the rest** starts a new request with that line already picked.
3. **Tasks:** *Pass: Club Officer Policy Test*, *Attend: Club Officer Training*
   and a club task from his president, *Reconcile September spending*. The
   test's week-ahead reminder (*Club Officer Policy Test is due in 7 days*, in
   the bell, by email and push) comes from the Reminders job about three days
   after seeding, and a day-ahead one follows.
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
   - **Sent back:** WSUSA asked for changes to SWE's *Bake Sale for SWE
     Scholarships* (it collects money): its editor shows Alex's note (who
     handles the cash box, and where the money goes). Add both to the
     description and save: that sends it back to WSUSA. Until it's approved
     it stays hidden.
   - **One permission paused:** she hasn't taken *Event Safety Training*. If
     Alex turns it on, it's already past its 14-day grace for her, so only
     **Events** pauses in SWE: the Events Builder says *Events is paused until
     you finish Event Safety Training*, and everything else (Members, Budget,
     the org chart) keeps working. Passing the test brings Events back.
5. Messages: a DM thread with Priya about co-hosting.
6. **Renewal:** SWE re-registered for 2026–27 in mid-September, and Vanessa
   did it (a VP can renew). The Overview reads *Re-registered 2026–27 · by
   Vanessa Brooks on Sep 13, 2026*, and the club page says *Re-registered
   2026–27*.

## Priya Patel — president

**Where Priya stands:** President of the RC Wrecker Bots Club since May 2026
(VP 2025–26, Events Coordinator 2024–25). About 90 members, an
**approval gate** with **five pending join requests**, Tuesday build nights,
and regular co-hosted events with CSWS (The Computing Society at Weber State)
and SWE. Both officer requirements met. The club hasn't re-registered with
WSUSA for 2026–27 yet, so its workspace Overview leads with the renewal card.
The club runs its own *Event Safety Quiz*.

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
   Programming* and *Girls in STEM Robot Day* (it involves people under 18,
   so WSUSA reviewed and approved it before it was posted).
   - **Waiting for review:** *Robot Demo Day at Roy Junior High* (about ten
     days out) involves people under 18 and travel, so it waits for WSUSA (in
     Alex's **Event reviews**). In the Events Builder it's dashed and its
     editor says *Waiting for WSUSA's review*; its page says the same, with no
     **Add to calendar** or check-in. Nobody else sees it: Maya won't find it
     on the Events page, and no notices or reminders go out.
   - **Try it:** **New event** → under **Does this event involve…** check
     **Travel or an overnight stay**: the trip's fields open right there
     (where to, leaving and coming back, overnight, drivers picked from the
     club or typed, notes). Save and the toast says it went to WSUSA for
     review. With nothing checked, it posts at once, as before.
   - **Event Safety Training** (Admin → Requirements, off): she passed it
     already, so turning it on leaves her Events alone.
   - **Try it:** open a *Build Night* in the Events Builder. Under **Basics**,
     pick **Free food** or **Free stuff**. Under **Cover image**, **Choose from
     club files** (Flyers & Photos has public flyers) or **Upload an image**;
     the cover must be one of the club's public images. Under **Where**, add an
     **Online link** and it reads *Hybrid* (check-in still happens in the
     room). Under **Service hours**, any event can count: *Hours per attendee*
     starts at the event's length and can't go over it. *Girls in STEM Robot
     Day*, a Service project, counts already.
6. **Budget:** *Combat robotics competition travel* is approved with an open
   invoice.
7. **Club tests:** results for the Event Safety Quiz.
8. **Messages:** the *Engineering club presidents* leaders group and DMs with
   Maya and Vanessa.
9. **Network map:** the RC Wrecker Bots Club should be highlighted and sit near
   the other EAST clubs.
10. **Graduation** (Settings → Graduation): she's the club's only President, so
    the page leads with *Pass the torch first* and links to the org chart's
    hand-off, and the confirmation names the club as well. She could still
    graduate, and WSUSA would get a task for the empty seat. (Don't confirm
    unless you mean it: graduating retires her profile.)
11. **Renew for 2026–27** (the Overview's renewal card): it's *Overdue since
    Sep 30* (renewal opened with the fall term on Aug 31 and was due 30 days
    later). Every required check is green: profile, President, advisor,
    constitution and bylaws. *A Vice President* is amber, with **Fill this
    seat**, because the VP seat is waiting on Dr. Alvarez. That one's only
    recommended, so **Renew for 2026–27** works: confirm the club will be
    active this academic year, add a note for WSUSA if you like, and the card
    becomes *Re-registered 2026–27 · by Priya Patel on …*. Her and Dr.
    Alvarez's *Renew RC Wrecker Bots Club for 2026–27* tasks close, and the
    club page's details say *Re-registered 2026–27*.
12. **A big send** (Settings → Notifications, and the outbox as Sydney): she
    posted *Competition team tryouts are this Saturday* to the club a few
    minutes before the seed ran. It's on every member's bell already, and
    because it reached more than 50 people its emails are *Waiting to send*
    until the next *Send queued messages* run. She turned *Events &
    reminders* email off herself, so co-host requests reach her bell and
    phone only.
13. **Constitution** (the workspace's Constitution page): the documents in
    effect were adopted by an earlier leader, and they keep the answers they
    were made from, so **Start from the current version** opens the builder
    on them. *What your documents set* lists what Wildcat Clubs applies: who
    votes in member votes, the quorum, ties, the notice before a vote, and
    when WSUSA follows up on an empty President seat (14 days) or a missing
    advisor (30 days). In the builder, those answers say *Wildcat Clubs
    applies this*, and GPA, dues, terms of office, removal and amendment
    votes say *Wildcat Clubs doesn't enforce this; your club and WSUSA do*.
    Adopt with **Self-select** as the primary method and every member's bell
    reads *RC Wrecker Bots Club now uses Self-select to fill seats* (WSUSA's
    too; reseed afterwards, since the club's story uses Advisor & President).
    A custom upload asks only what the document governs: bylaws ask the
    succession method, a constitution how students join.

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
6. **Tasks → *Renew RC Wrecker Bots Club for 2026–27*** (required): advisors
   get the renewal task too. She or Priya can renew from the club's Overview.
7. **Settings → Notifications:** she turned *Announcements* email off, so
   Priya's tryouts announcement is on her bell, with no email waiting for her
   in the outbox.

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
  (pending approval). They state only the primary way leaders are chosen
  (*Member vote*, a change); bylaws don't decide who can join, so approving
  them leaves joining as it is. Approving tells AAT's members and WSUSA that
  it now uses Member vote to fill seats.
- **Funding:** four requests in WSUSA's review (Wildcat Investors' *Fall
  speaker series* and *Club banner*, SWE and NSNA) and three open invoices (RC
  Wrecker Bots Club, Wildcat Investors, and Black Student Union (BSU)'s, which
  is past due and its own urgent row in the WSUSA queue). The Hiking and
  Outdoors Club's *Avalanche awareness course* is a sport club's, so Campus
  Recreation decides it (see Rowan): it's past review time, and Alex sees it
  under **All offices** or **Campus Rec**, not in WSUSA's default queue. Run
  the scheduled jobs (System → Scheduled jobs → Run now, as Sydney) and the
  deciding office's staff get one reminder about each late one; running them
  again sends nothing new.
  - **Try it:** open *Fall speaker series* → **Approve part**. Every line
    starts at its full amount; untick one (it reads *Not funded · unlocks for
    another source*), keep or change **Funded by** (it starts at the club's
    expected source), add a note and approve. The invoice and its task appear
    at once (there's no separate "Create invoice" step), the request moves to
    *Approved · invoice open*, and Oscar can ask another source for that line.
- **Review bombing:** Ogden Valley Disc Golf Club got four 1★ reviews within
  36 hours; members flagged them. One older Wildcat Paintball Club review is
  already hidden.
- **Reports:** five, all on those two clubs (two anonymous — opening one
  requires acknowledging the anonymity notice, and every opening is logged).
  The two new ones are also in WSUSA's queue, as tasks with no content.

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
- **Event reviews** (`/admin/events`): Priya's *Robot Demo Day at Roy Junior
  High* waits here, with what it involves, the trip (where, when, drivers,
  notes), the date and place, and who to contact. **Approve and post** and it
  shows up for everyone at once (Events page, calendars, Google once that's
  on), and Priya and the club's event planners hear. Or write a note and
  **Ask for changes**. SWE's bake sale is under **Sent back**. Campus
  Recreation's Moab trip isn't in WSUSA's queue (it's Rowan's), though Alex
  can open it from the Overview's **Campus Rec** filter.
- **Requirements, by office:** each card says whose it is. *Event Safety
  Training* is WSUSA's, **Only people with Events**, and off: turn it on and
  every leader holding Events who hasn't passed it gets a task, already past
  its grace (try Vanessa: only her Events pauses). Oscar, a Treasurer without
  Events, isn't asked. Campus Recreation's *Sport club safety forms* reaches
  only its sport clubs' officers. **New requirement** has **Whose
  requirement** and **Only people with one permission**.
- **Event review settings** (System settings → Event review, as Sydney):
  turn review off and new events post right away (their answers are still
  saved); *Large crowd* sets the "More than 100 people" threshold.
- **Ambassador programs** (Club approvals → Ambassador programs): only admins
  start a program and choose its advisor ("Change" appoints someone else and
  ends the previous advisor's role). In **EAST Ambassadors → Ambassador
  placements**, the RC Wrecker Bots Club is waiting on its request (badge
  "Asked for one"). Place one of the program's club representatives, or
  decline with a note; Priya's card updates either way.
- **Clubs missing a leader:** Engineering Honor Society / Tau Beta Pi's only
  President stepped down about three days ago (the advisor ended the role at
  their request), so nobody holds the seat. WSUSA has the task *Engineering
  Honor Society / Tau Beta Pi has no President*, and the club's other leaders
  and every admin got the notice in-app and by email (a staffing gap always
  sends, whatever anyone's settings say). Assign a President in its org chart
  (or **Fill this seat**) and the task closes on its own. To watch one open,
  end the only President's role in a small club's org chart. Clubs that were already
  leaderless get no task: Club analytics' **Leaders** filter (*No President*,
  *No advisor*) lists them, and the Overview counts both.
- **Join requests nobody can approve:** Kappa Omega Eta approves each join
  request, but nobody there holds the Members permission, and one request has
  waited nine days: *Join requests waiting at Kappa Omega Eta*, opened by the
  "Club staffing" scheduled job. Deciding the request on the club's Members
  page, or giving someone there the Members permission, closes it on the
  job's next run. Kappa Omega Eta is a Fraternity & Sorority Life chapter, and
  FSL has no staff yet, so its work falls back to WSUSA's queue: nothing waits
  unseen.
- **One queue, by office:** the dashboard's WSUSA queue, the Overview's
  *Waiting on WSUSA* and the counts in the admin side nav (Club approvals,
  Event reviews, Funding, Tests, Reports, Review moderation) all count the
  same open tasks, so they agree. WSUSA's queue is the default; the
  Overview's filter switches it to **Campus Rec**, **FSL** or **All offices**
  (Campus Rec's sport-club staffing gap and funding request show only there).
- **Offices** (Admin → Offices): WSUSA, Campus Recreation (club sports, decides
  their funding) and Fraternity & Sorority Life (Greek chapters, funding goes
  to WSUSA), each with its contacts, review time, staff and club count. Their
  details start from weber.edu's public pages, so the page asks to confirm
  them (save each office once). Add or remove staff by @weber.edu email.
  **Move a club:** open any club in Club approvals → *Overseen by* → **Move
  club**; its open admin tasks move with it (reports and review moderation
  stay WSUSA's) and its leaders are told.
- **Daily digest:** instead of an email for each club submission, funding
  request, custom document or flagged review, admins get one email each
  morning (the first *Send queued messages* run after 7 AM): what's waiting on
  WSUSA, and the notices since the last digest. They still arrive on the bell
  at once. New reports, possible review bombing and clubs that lose a leader
  are emailed right away (the outbox has the Disc Golf review-bombing alert).
  Settings → Notifications → **WSUSA digest** turns it off. Today's digest
  hasn't gone out yet.
- **Renewals** (Club approvals → Renewals): about 40 of the 289 clubs asked
  (roughly 60% of the active ones) have re-registered for 2026–27; the rest
  are *Overdue since Sep 30*. **Not renewed** lists clubs with a President or
  advisor to contact first, each with what's missing. Microbiology Club
  (*American Society of Microbiology Student Chapter @ WSU*) has a President
  but no advisor, so it can't renew: **Open renewal** shows its blocked card,
  *Before … can renew, it needs a faculty or staff advisor.* Most dormant
  clubs have nobody in either seat. **Renewed** shows who renewed, when and
  any note, and **Download CSV** exports the list. Nothing pauses or retires
  on its own. The Overview's *Where clubs stand* has the count. The three
  clubs approved this fall renew starting next year.

- **Service hours:** People → Maya Chen → **Involvement record (PDF)** downloads
  her record (each download is logged, privately, as *Downloaded an
  involvement record*). Club analytics has a *Service hours (this term)*
  column, in the CSV too: every check-in at a club's hosted or co-hosted
  service events this term.

Also try: policies (eleven published, one draft, one shown from a PDF),
trainings, university-wide announcements, analytics, directory and people.

## Sydney Park — system administrator

Everything Alex can do, plus **System settings**: activity windows, the review
threshold (3) and review-bombing rule (3 ratings ≤ 2★ in 48 hours), club
renewals (due 30 days after the academic year's first term starts), AI
switches (off), integrations (mock mode), the **outbox** (mocked emails, one
failed push, and the RC Wrecker Bots announcement's emails *Waiting to send*),
scheduled jobs (*Club renewals* keeps each club's renewal tasks in line with
its Presidents and advisors), and granting admin.

**Queued messages and the digest:** a notification for more than 50 people
puts its emails and pushes in the outbox as *Waiting to send* (the bells go
out at once). System → Scheduled jobs → **Run now** includes *Send queued
messages*: it sends about 200 a run, oldest first, so the first run sends the
whole tryouts announcement, and it sends today's WSUSA digest to the admins
who keep it on. Running it again sends nothing new. Sydney turned the digest
off (Settings → Notifications), so she was emailed the *Fall speaker series*
funding request one by one and gets no digest.

**Reminders:** System → Scheduled jobs → **Run now** includes *Reminders*. It
reminds people about events starting 45–75 minutes from the run (followers of
the host and co-host calendars with *Remind me before events* on who haven't
checked in; for a university training, only the people it's required of), and
sends requirement reminders a week and a day before they're due. Running it
again sends nothing new. To see one, have a leader create or move an event to
start in about an hour first; the outbox shows the emails (requirements only)
and pushes (none until a phone registers).

## Rowan Ashby — Campus Recreation staff

Rowan is on Campus Recreation's staff (Admin → Offices, added by Alex), not a
platform admin, so **Admin** is the same console scoped to the sport clubs
Campus Rec oversees: their queue (dashboard and Overview), Club approvals,
Club analytics, Event reviews, Funding (Campus Rec decides its clubs'
funding), Tests (its own tests and forms) and Requirements. Nothing from
WSUSA's or FSL's clubs shows anywhere, and People, Policies, Directory,
Reports, Review moderation, Announcements, Trainings, Offices and System are
404.

**Waiting for Rowan:**
- **A club missing a leader:** Cornhole Club's only President stepped down two
  days ago, so Campus Rec has *Cornhole Club has no President*, and Rowan got
  the notice in-app and by email. Assign a President in its org chart and the
  task closes.
- **Funding:** the Hiking and Outdoors Club's *Avalanche awareness course*,
  past Campus Rec's review time: an urgent row. Decide it like any request.
- **Renewals** (Club approvals → Renewals): the sport clubs that haven't
  re-registered for 2026–27.
- **Event reviews:** the Hiking and Outdoors Club's *Moab Canyoneering
  Weekend* (travel, overnight, two Campus Rec vans) waits for Campus Rec,
  members only and still hidden from its members. Approve it, or ask for
  changes with a note. Priya's school visit is WSUSA's, so it isn't here.
- **Requirements:** Campus Rec's own *Sport club safety forms* (a Test Tool
  form Campus Rec owns), required of its sport clubs' officers only: about a
  third haven't signed, all still inside the 30-day grace. New requirements
  here are always Campus Rec's and use its own tests and forms.

Sport clubs' pages say **Overseen by Campus Recreation** with its email and
phone; Rowan's club workspace header reads *Viewing as Campus Recreation
staff*. The daily digest covers Campus Rec's queue only.

---

## Other things in the data

- **Notifications.** Every seeded bell is a kind the app really sends
  (`src/components/notifications/catalog.ts`, the notification registry;
  `verify.ts` fails on any other). The registry also gives each kind its
  Settings category and whether it emails and pushes by default, and the
  outbox agrees with it: every row names its kind, and the queued emails go
  to exactly the people the registry emails. Three personas changed a
  setting: Priya (Events & reminders email off), Dr. Alvarez (Announcements
  email off) and Sydney (WSUSA digest off).
  Nobody has registered a phone for push, and nothing has been reminded yet:
  the first *Reminders* run sends the week-ahead and day-ahead reminders for
  required tasks that are already due soon.
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
- **Bylaw rules:** every adopted builder document keeps the answers it was
  made from (`ClubDocument.builderAnswers`). Most clubs have the builder's
  defaults: a 25% quorum, 3-day voting window, ties to a runoff, 7 days'
  notice, and WSUSA follow-up after 14 days without a President or 30
  without an advisor. Psi Chi's newer bylaws add the 2-event attendance
  requirement. Each running selection froze its club's rules
  (`Election.rules`); Applied AI Lab's past votes predate them and have none.
- **Role history contributions:** in most approved and retired clubs, one or
  two past leaders have a project tied to the seat they held, usually with a
  file (a club file they made that term, or a write-up in their own files).
- **Event Safety Quiz:** RC Wrecker Bots Club members who haven't passed it
  have a *Take: Event Safety Quiz* task, marked *Club test* (a club's own
  test, not a WSUSA requirement; /tasks has a Tests filter).
- **Renewals:** clubs re-registered for 2026–27 between Aug 31 and Sep 30
  (busiest in the first week and the last few days), mostly by their
  President, sometimes by a VP or the advisor, a few with a note for WSUSA.
  Every club that hasn't renewed has a required *Renew <club> for 2026–27*
  task for each current President and advisor, the way the *Club renewals*
  job opens them.

All policy text is sample text and says so at the top. People, memberships,
events and reviews are fictional even where the club is real; reports and
incidents exist only on the fictional demo clubs. Building coordinates are
approximate.
