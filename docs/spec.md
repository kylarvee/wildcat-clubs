# Wildcat Clubs — original product spec (from Kylar, 2026-10-16)

> Kept verbatim as the source of requirements. Decisions that resolve its tensions are in
> ARCHITECTURE.md §6.

**Note before building:** Please ensure centralization of components and clear points of authority for permissions and processes (A clear hierarchy of permissions is great; fewer cross-contaminated data inputs is best - inputs should come from a single tool, not multiple places, so it's clearer to the user; everything feeds into the data lake before being used elsewhere; etc.). This is a contained, unified platform, where all inputs come from within the platform and analysis tools feed themselves. There are external integrations that must happen with google organizations, and logins rely on university emails (Weber State university). There are missing components to this than need to be filled in for completion. Please populate a flush mock database for user testing. Solve any contradictory logic with a basic, simple solution (complexity kills). Right now we're tailoring this for weber state university.

The clubs platform is an all-in-one resource for student-led clubs to found, operate, and retire their clubs within.

**The Problem:** Right now, students have to deal with rudimentary, poorly organized platforms in order to register their clubs. Similarly, there are many tools that student clubs need for reporting to the university, managing and operating their clubs. There's also no standardized way for inter-club communication, making inter-club activities impossible.

**Our Platform:** This platform aims to create an in-house, contained system that helps student leaders align with university administration policies, trainings and funding requirements, and build and run their clubs with all of the information they need to be successful. It is accessible on web and mobile.

## How the platform will work, end to end

### Finding and Registering for a Club
* A student finds the platform from the public view. They land on our landing page, can read more about the platform, and click on the "Clubs List" page and use our clubs list tool to start viewing clubs.
  * They navigate and sort the page.
  * They click into different clubs to learn more about them
  * They click "register", and it prompts them to log in with their student email.
  * Once they're registered, the calendar then appears for them and auto subscribes them to the club. They are now a basic member of that club.
  * They're then prompted to download the mobile app for notifications
  * The user may, if they choose, continue to navigate other clubs. Now that they're logged in, they immediately see the calendar on every club page, and can quickly subscribe to calendars without having to register (if they choose). Now clicking "register" on each club immediately registers the user (unless the club leaders have setup a gate to membership).
* The student shows up to a club meeting
  * Uses the mobile app to scan the QR code; the attendance is then logged using our attendance tracker.
    * Students when looking at club pages now show their attendance records; they also have a page to view their attendance record
  * They attend the meeting and leave
  * They may or may not have continued attendance
  * After x events attended (whatever is determined by the system admin), the review feature is unlocked and the student may leave a review on the club.
* As the user attends a club more and more, they may be promoted to the roles of officer (there are a variety of officer roles built-in), VP, or President of a club.
  * As they rise, their roles are recorded on their profile; an advisor or president changes their status.
* Once they graduate, they have a full profile that is then retired, but their history within the club will be forever logged in their profile and in the clubs. You can see a history of all of the people who have held different roles, and where gaps have existed in roles. Ideally, you'll see their contributions to the club and the actual projects and files (images, documents, or literal files) they've worked on/contributed attached to the roles they took.

### Building a Club
* A student or faculty wants to start a club
  * They log into the platform
  * Click create a club (I think this should probably live on the club list)
  * The user selects what kind of club: Sponsored (must select a department; if the department doesn't exist, they select "other" and fill out the field; the administrators add the department in the department list), Affiliate, Registered
  * Fill out their profile (club profiles) - this may be saved as a draft
  * They choose an advisor
    * They must find a faculty advisor at the university (faculty or staff member)
    * They type in their name and email (must be a Weber State email)
    * Our system sends that person a notification
      * If they have an account, it appears in their portal as a request; they also receive an email.
      * If they do not have an account, they are notified via email; they create an account and approve themselves to be an advisor.
  * Use the constitution builder for their constitution and bylaws (constitution builder) — they auto-implement
* They wait for approval from WSUSA
  * Upon submission, they are informed of the process that happens on the other end
  * They are given the contact information of the people reviewing and the office location (WSUSA office staff)
* They receive approval from WSUSA
* The student sets up their club agenda
  * Plans events and budget (Events Builder)
  * Requests funding (if needed; Funding & budgeting tool)
  * Recruits friends/peers/interested students to register
    * Starts building out their org structure, setting roles and responsibilities; picks from default setup or customized if needed (Organization Chart)
  * Runs events (Attendance Tracker)
* Now the club is running an operation
  * They start planning activities with other clubs (Events builder)
  * Our attendance tool also logs cross-attendance events (in our tracking tool, stats will appear for all clubs involved; Inter-club activity flowchart)
* The club runs.

### Administrators
The university has rules, policies and trainings they need to enforce. Our platform centralizes documents, tests and training events required by the administration.
* Admin accounts set policy by using either our in-app text editor or our document preview tool
* The policy will appear in several places throughout the app
* Create events surrounding training for student officers and higher in the hierarchy (required to hold those roles)
  * Set up training events using our events builder
  * Use our attendance tool to track in-person training
  * Use our Test tool to ensure officers and higher are informed on policy (gate to the role)

### Students
Profile: Name; Major & Minors; Description; Roles and history (looks just like LinkedIn; dynamically updates with club roles): About, Activity, Experience (at the university within orgs; users may add their own experience - it would be cool if this read directly from an existing linkedin profile and auto-populated), Education, Projects. Have an "attendance tracker" to see all of their attendance within the platform relative to clubs.

Student Dashboard: A nav of the clubs you're registered in (and an option to browse more); Your calendar (of clubs you're registered with); Task Manager.

### Permissions
Three primary roles: Students, Advisors, Administrators.
* Students: includes students and student leaders (officers, Ambassadors, VPs, Presidents)
  * Presidents can assign the next president and update roles before leaving the role (Once they save after assigning a president and changing their status to "alumni", they lose the permissions and are logged in the club's role history); they have the ability to perform all activities within the club, including retiring the club and changing org structure.
  * VPs have all of the permissions the president has, except he cannot promote himself, backfill his role, or retire the club.
  * Officers: permissions for the different tools and features are modular and customizable; the setup is prompted when an officer is promoted
  * Ambassadors are similar to an officer role, but likely will not have permissions within the general club structure (at the option of the club and their needs).
* Advisors: Have full permissions over the club.
* Administrators: full permissions over clubs and other administrative oversights, as well as analysis tools within their dashboards for every club. They cannot add other administrators, and don't have access to system-wide configurations.
* System Administrators have full access to all permissions, and can modify system-wide configurations.

## Features
* In-app fully featured and functional text editor
* Document previewing/embedding
* In-app video embedding (from YouTube or Google Drive)
* **Attendance Tool** — The web application displays a QR code, and the mobile app uses the camera to scan the QR code and quickly checks the user in. For users who have never created an account, it seamlessly helps the user create an account on the app (so you can use the app and scan the QR before logging in). If the user is logged in, but has never attended the club, it auto-enrolls them at the most basic level within that club. This tool feeds into our database. A secondary mode allows a check-in in the mobile app during the event, where if you open the club page and are registered for that club, you can click the pop-up and check in (there must be an option not to check in as well so the user can navigate to the page if there's that kind of circumstance.)
* **Data lake, or database** — All data feeds here. We build surfaces from this.
* **Attendance Tracker** — displays each club's respective attendance, showing a table for every meeting date, and a mark for every person across dates. Summary statistics: attendance rates by event; retention rates (months, quarters, academic years, annual). These rates can also be viewed at the individual level.
* **Test Tool** — users can build tests, view all of the tests they've built, see summary statistics of each test and all tests, create recurring tests (one-off, weekly, monthly, semester, academic year, annual). They can also automate approvals, permissions, and actions off of test results, or lack of taking a test by the deadline. For each test: an info page before taking it (document tool, video embedding, text editor) with a "take test" button and an "are you sure?" confirmation that says how much time they have and how to submit; a timer (limited or unlimited, ticker always ticks); multiple choice (one or multiple answers); open text questions (short/long, uses the text editor); the builder writes what a correct answer looks like and Claude (Haiku and Sonnet only, dynamic routing) reviews and compares to give the reviewer quick feedback — does NOT replace manual review; may not have API support immediately — a system admin toggles it on/off, which enables and makes visible all relevant features. Multiple-choice results feed directly into the database. Builders see results for each user.
* **AI Integration** — dynamic routing between Claude Haiku and Sonnet to help students and administrators build their portions of the platform. Full knowledge of every aspect of the platform; helps users set up their accounts and makes actions on the user's behalf. System admin toggle as above.
* **Events Builder** — one-off or recurring events (DOW, weekly, monthly, semester, academic year, annual). Calendar like Google Calendar; a list of event ideas per club ("drafts") with an option on the calendar to add from the list. Each event: time; location (Google Maps pin — campus buildings pin the building; off campus use Google); additional info; attachments; other Google Calendar features like Google Meet and rooms. Feeds the database and creates a calendar anyone at the university may subscribe to. Coordinated events: tag another club (or all clubs); that club's student-leader or advisor must approve so it lands on their calendar (auto-approval off by default, may be turned on).
* **United Calendars Tool** — each user's own calendar on their dashboard, tailored to the clubs they're part of / subscribed to. Includes expected costs, where the creator can request funds and direct where funding should come from (University, college, or department level).
* **Review Tool** — 1–5 stars, optional text. Only students who attended three or more events (default; uniform; only a system admin adjusts) may review.
* **Club Profiles** — Club name; associated college (some independent, some university-level, some sports only); focus major or discipline; description (text editor, document embedding); additional documents (bylaws, constitution, etc.).
* **Clubs List** — public; grid (default) and list views; sortable by retention, ratings, active membership, college, major/discipline, activity, type, alphabetical. Logged-in students register and subscribe seamlessly.
* **Club Pages** — hero: logo, name, short description, calendar, register. Then about, summary stats (active membership, retention), org chart (native, dynamic — makes roles and responsibilities transparent for accountability), resources, reviews.
* **Club Files** — syncs with the club's email and creates a Google Drive space via API; a file-explorer-like tool on top of Drive with right-click and quick nav; reference files anywhere (pop-up picker); permissions by role/club with user-specified adjustments.
* **Anonymous Complaints (anonymity optional)** — report school policy violations to administrators. Anonymous reports may not be shared; admins must click through an anonymity pop-up every time before viewing; reports never leave the admin circle.
* **Organization Chart** — native hierarchy: President (or co-presidents), VP, configurable Officers with responsibilities, optional Ambassador (set up at the college level). College Ambassadors (college-level org add-on): President, VP, Ambassadors (Marketing, Inter-club coordination, Events, Club-representative ambassadors embedded in each club). Internal titles: custom secondary titles clubs define.
* **Messaging Tool** — built on Google Chat for the university: each club has a group chat; members DM members of clubs they share; leaders DM other clubs' leaders and create leader group chats.
* **Announcements** — club announcements with the text editor and embeds (events, etc.).
* **Funding & Budgeting** — itemized purchases; funding source (University, WSUSA (Registered default), Department (Sponsored & Affiliate default)); syncs with event builder costs (repeating events combine); admins approve and export invoices; each invoice creates an admin task to make sure funding goes through in the separate system.
* **Constitution Builder** — default constitution with core + modular components; default bylaws for voting and succession aligned with the platform (core + modular); custom documents need approval (recommended after a year of running); output is a PDF to preview, download and auto-implement into the club profile(s).
* **Inter-club activity flowchart** — canvas of all clubs; lines thicken with activity; active clubs bigger; interconnected clubs central; natural grouping (e.g., by college) — fully dynamic, no hand-set parameters; group by club (default), college, department, major/discipline; interactive (click for stats, links); leaders/advisors see their clubs highlighted.
* **Voting system** — active members vote on leadership (bylaw option); default succession is seniority; also leadership-only voting (leaders vote for each other, not themselves).

## Landing Page
Hero quick nav (log in, or browse clubs). Not logged in: browse clubs, see the inter-club flowchart, start registering (requires login, then jump to dashboard).

## Definitions
* Activity — Students: attended an event in the last 31 days (admin-configurable) OR one of the last two events, whichever is later. Clubs: at least two active events during the last semester (configurable); with no events they're active until the end of the first full semester they've existed (pilot period). Must also have ≥8 registered students (not required in the pilot period).
* Pilot Period — grace period for active status after a club is created (until the end of the first full semester).
* Interconnected — measured by cross-club/org physical attendance.

## Policy
* Review bombing (organizing people to post bad reviews with malicious intent) is not acceptable.
* Anonymous complaints may NEVER be shared outside university administrators and the proper authorities per WSU policy.

## Mobile App
A simplified version for mobile with the basic functionality required.
