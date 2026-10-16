# Wildcat Clubs — test personas

The mock database gives every role in the platform a ready-made account with a
realistic history. Sign in at **/login** and pick a persona (personas are on
whenever `AUTH_MODE` is `mock` or `both`, the default outside production).

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
| Oscar Nguyen | oscar.nguyen@mail.weber.edu | Officer (Treasurer) | Budget & funding, officer test, requirement grace period |
| Vanessa Brooks | vanessa.brooks@mail.weber.edu | Vice President | Co-host approval, VP limits, elections |
| Priya Patel | priya.patel@mail.weber.edu | President | Running a big gated club, QR check-in screen, succession |
| Amir Haddad | amir.haddad@mail.weber.edu | College ambassador | Ambassador placements without capabilities |
| Frank Okafor | frank.okafor@mail.weber.edu | Club founder | Founding a club: draft, advisor invite, submission |
| Gwen Torres | gwen.torres@mail.weber.edu | Alumni | Retired profile, role history, projects |
| Dr. Elena Alvarez | elena.alvarez@weber.edu | Club advisor | Full permissions in two clubs |
| Prof. Nathan Reed | nathan.reed@weber.edu | Invited advisor | Accepting an advisor invitation |
| Alex Morgan | alex.morgan@weber.edu | Administrator (WSUSA) | Every admin queue |
| Sydney Park | sydney.park@weber.edu | System administrator | System settings, AI and integration switches, outbox |

Check-in codes are fixed: **HERE26** (live now), **LATER7** (later today),
**BUILD8** (Wildcat Robotics, live now). Type them at `/c/<code>` or in the app.

---

## Sam Rivera — new student

**Where Sam stands:** account created minutes before the seed ran. No majors,
clubs, check-ins, tasks or notifications.

1. Sign in — the dashboard should feel empty and point Sam to the clubs list.
2. Open **Clubs**: switch grid/list, sort by rating, activity, active members,
   retention, college or type. Inactive clubs (Astronomy, Math, Model UN,
   Ceramics) and pilot clubs (Data Science Society, First-Gen Wildcats,
   Pickleball Club) should read differently.
3. Register for **Chess Club** (open): Sam becomes a member at once, the club
   calendar is subscribed, and the "get the app" prompt appears.
4. Register for **Wildcat Robotics** (approval gate): the request is pending.
   Sign in as Priya or Dr. Alvarez to see it in Tasks.
5. Subscribe to **Anime Club**'s calendar without registering.
6. Check in at the live service event with code **HERE26**: Service & Volunteer
   Club is open, so the check-in also makes Sam a member.
7. Try to review a club — it stays locked until Sam has attended three events.
8. **Report a concern** anonymously and keep the case code.

## Maya Chen — club member

**Where Maya stands:** active member of Psychology Club (since fall 2024),
Pre-Med Society (spring 2025), Wildcat Climbing Club (fall 2025, approval gate)
and Service & Volunteer Club (joined two weeks ago, one check-in). She has three
or more check-ins in the first three, so she can review them; she already gave
Wildcat Climbing Club 5★. She follows Anime Club's calendar without joining.

1. **Check in, live now.** Service & Volunteer Club's *Care Kit Assembly for the
   Weber Cares Pantry* started 15 minutes before the seed ran and ends 105
   minutes after it (self check-in allowed). Open the club page for the
   check-in pop-up — and its "not now" option — or use **HERE26**. About nine
   people are already checked in.
2. **Later today:** Psychology Club's *Grad School Q&A with Psychology Faculty*
   starts about three hours after the seed ran (code **LATER7**; check-in opens
   30 minutes before).
3. **Vote:** Psychology Club → *President — Spring 2027* (member vote, three
   candidates, closes five days after seeding). Maya is an active member and
   hasn't voted.
4. **Review** Pre-Med Society or Psychology Club. Her Climbing review can be
   edited or deleted.
5. **Attendance tracker** (`/me/attendance`) and her record on each club page.
6. **United calendar:** four clubs, Anime Club (subscribed only) and university
   events.
7. **Messages:** an unread DM from Priya; three unread messages in the
   Psychology Club chat.
8. **Profile** (`/u/mayachen`): barista job, summer research internship,
   education, club roles (none — she's a member).

## Oscar Nguyen — officer (Treasurer)

**Where Oscar stands:** Treasurer of Finance & Investment Club since about 20
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
   answers. Submitting sends it to review (open answers need a person).
5. **Officer Training makeup session** is on the calendar (a Wednesday about a
   week out, 5:30 PM, Shepherd Union 404A). Checking in completes the training
   requirement.
6. Optional: the **Funding Rules Refresher** test (open to anyone).

## Vanessa Brooks — vice president

**Where Vanessa stands:** VP of the Society of Women Engineers since May 2026
(Secretary the year before). SWE picks officers by **leadership vote**. She has
met both officer requirements. She's also a member of Wildcat Robotics.

1. **Tasks → co-host request:** Cybersecurity Club asked SWE to co-host
   *Women in Cybersecurity Panel* (about nine days out). Approve it and it lands
   on SWE's calendar.
2. **Org chart:** she can assign officers and ambassadors but **not** President
   or VP, and can't retire the club.
3. **Elections:** *President — Spring 2027* (leadership vote) is **CLOSED** and
   waiting to be applied. As VP she can't apply a presidential result; SWE's
   president (graduating in December), its advisor or an admin can.
4. SWE's *Girls in STEM Robot Day supplies* funding request is submitted.
5. Messages: a DM thread with Priya about co-hosting.

## Priya Patel — president

**Where Priya stands:** President of Wildcat Robotics since May 2026 (VP
2025–26, Events Coordinator 2024–25). About 90 active members, an **approval
gate** with **five pending join requests**, Tuesday build nights, and regular
co-hosted events with ACM and SWE. Both officer requirements met. The club runs
its own *Event Safety Quiz*.

1. **Members:** approve or decline the five requests — their tasks close for
   everyone with the roster capability.
2. **Attendance:** *Open Build Night (extra session)* is live now (code
   **BUILD8**, about 12 already checked in). Open the rotating QR screen, add
   someone by hand, then look at the tracker (every meeting × every member)
   and retention.
3. **Org chart & history:** role history back to fall 2022 with hand-offs,
   December graduations, resignations and empty seats. She can name a
   successor or co-president and could retire the club.
4. **Events:** upcoming co-hosted *Robotics × ACM: Intro to ROS Workshop* and
   *Girls in STEM Robot Day*; idea drafts waiting for a date.
5. **Budget:** *Lunabotics competition travel* is approved with an open
   invoice.
6. **Club tests:** results for the Event Safety Quiz.
7. **Messages:** the *Engineering club presidents* leaders group and DMs with
   Maya and Vanessa.
8. **Network map:** Wildcat Robotics should be highlighted and sit near the
   other EAST clubs.

## Amir Haddad — college ambassador

**Where Amir stands:** Club Representative Ambassador in **Goddard School
Ambassadors** since fall 2025, placed as *College Ambassador* in **Accounting
Society** and **Marketing Association** (ambassador role, no capabilities). Also
a regular member of Entrepreneurship Club.

1. His profile lists the ambassador roles with the org that placed him.
2. Open Accounting Society's workspace: he's a leader there, but every tool is
   locked until the club grants him a capability.
3. Sign in as Alex to see Goddard School Ambassadors' placement view.

## Frank Okafor — club founder

**Where Frank stands:**
- **Wildcat Beekeeping Society** — DRAFT, started about nine days before
  seeding. The profile is half-finished (no short description, an unfinished
  About), a constitution draft is started, and his advisor invitation to
  Prof. Nathan Reed is pending.
- **Board Game Guild** — SUBMITTED about five days before seeding. Advisor
  accepted (after an earlier invitee declined); constitution and bylaws adopted
  with the builder. Waiting on WSUSA.

1. Finish the Beekeeping profile; submission stays blocked until an advisor
   accepts.
2. Open Board Game Guild: "in WSUSA review" with the reviewers' contact details
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

**Where Elena stands:** advisor of **Wildcat Robotics** (since its founding in
2022) and **Pre-Med Society** (since May 2024, after the previous advisor's term
ended). Full permissions in both.

1. Every tool in both workspaces is unlocked; she sees Robotics' join requests.
2. Pre-Med Society: an outgoing co-host request to Nursing and a partially
   approved funding request.
3. Advisors can assign any role and apply election results.

## Prof. Nathan Reed — invited advisor

**Where Nathan stands:** no clubs. Frank invited him to advise Wildcat
Beekeeping Society (task, notification, and a mocked email in the outbox).

1. **Tasks** → open the invitation → accept (he becomes advisor) or decline.

## Alex Morgan — WSUSA administrator

**Queues waiting for Alex:**
- **Club review:** Board Game Guild.
- **Department request:** "Aviation Technology" for Aviation Club (changes
  requested, with a note).
- **Custom bylaws:** Theatre Guild's uploaded bylaws (pending approval).
- **Funding:** three submitted requests (Finance & Investment Club, SWE,
  Nursing Student Association) and two open invoices (Wildcat Robotics, Black
  Student Union).
- **Review bombing:** Political Science Society got four 1★ reviews within 36
  hours; members flagged them. One older Anime Club review is already hidden.
- **Reports:** five (two anonymous — opening one requires acknowledging the
  anonymity notice, and every opening is logged).
- **Tests:** five officer-test attempts with open answers to grade.
- **Officer requirements:** one officer is past the grace period, so their
  permissions are paused (the seed prints who).

Also try: policies (nine published, one draft, one shown from a PDF),
trainings, university-wide announcements, analytics, directory and people.

## Sydney Park — system administrator

Everything Alex can do, plus **System settings**: activity windows, the review
threshold (3) and review-bombing rule (3 ratings ≤ 2★ in 48 hours), AI switches
(off), integrations (mock mode), the **outbox** (mocked emails, plus one failed
push), scheduled jobs, and granting admin.

---

## Other things in the data

- **47 clubs:** 39 approved across every college and university-wide,
  independent and sports scopes; 2 college ambassador orgs; 3 pilot clubs
  created this term; 4 inactive; Frank's draft and submitted clubs; Aviation
  Club (changes requested); Campus Poker League (rejected, with the reason);
  Photography Collective and Wildcat Rugby Club (retired, full role history).
- **About 450 students** (including ~80 alumni who held earlier roles), ~40
  faculty and staff, and 2 more WSUSA admins.
- **Events** from fall 2024 through fall 2026: weekly or biweekly meetings per
  semester (holidays and spring break cancelled), socials, workshops, service
  days and competitions, on campus, off campus and online; co-hosted events;
  idea drafts; Club Officer Training and Funding Workshop every semester.
- **About 40,000 check-ins** with semester-start spikes, pre-finals dips and
  members who drift away at different rates. Officers show up most. Members of
  several clubs in the same college give the network map its clusters.
- **Files:** each approved club has Meeting Minutes, Flyers & Photos, Resources
  (featured on the club page), Constitution & Bylaws (PDFs) and leaders-only
  Officer Notes. Bytes live in `apps/web/storage/seed/`.

All policy text is sample text and says so at the top. Names, people and
incidents are fictional; building coordinates are approximate.
