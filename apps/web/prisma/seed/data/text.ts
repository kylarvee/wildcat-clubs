import type { EventKind } from "@prisma/client";
import type { Topic } from "./clubs";

/** Text banks: event ideas, reviews, chat, announcements and profile bits. */

export type EventIdea = { title: string; kind: EventKind; where?: "campus" | "service" | "social" | "outdoors" | "virtual"; minutes?: number; cost?: [string, number, number] };

// cost = [description, quantity, unit cost in dollars]
export const EVENT_IDEAS: Record<Topic, EventIdea[]> = {
  tech: [
    { title: "Intro to Git & GitHub Workshop", kind: "WORKSHOP" },
    { title: "Résumé Review with Industry Engineers", kind: "WORKSHOP" },
    { title: "Pizza & Project Pitches", kind: "SOCIAL", cost: ["Pizza", 12, 14] },
    { title: "Tech Talk: Life as a Software Engineer at Hill AFB", kind: "WORKSHOP", where: "campus" },
    { title: "End-of-Semester Project Showcase", kind: "OTHER", minutes: 120, cost: ["Showcase snacks & drinks", 1, 180] },
    { title: "Soldering 101", kind: "WORKSHOP", cost: ["Soldering kits", 20, 9] },
    { title: "Mock Technical Interviews", kind: "WORKSHOP" },
    { title: "Industry Panel: Breaking Into Tech in Utah", kind: "WORKSHOP", minutes: 90 },
    { title: "Game Night & Bowling", kind: "SOCIAL", where: "social", cost: ["Lane rental", 6, 35] },
    { title: "Virtual Talk with Weber State Alumni Engineers", kind: "WORKSHOP", where: "virtual" },
    { title: "STEM Outreach Day at Ogden High", kind: "SERVICE", where: "service", minutes: 180 },
    { title: "Regional Competition Practice Run", kind: "COMPETITION", minutes: 180 },
    { title: "Python for Everyone (Part 1)", kind: "WORKSHOP" },
    { title: "Build Sprint Saturday", kind: "OTHER", minutes: 240, cost: ["Lunch for build sprint", 25, 11] },
  ],
  business: [
    { title: "Networking Night with Goddard Alumni", kind: "SOCIAL", minutes: 120, cost: ["Appetizers", 1, 350] },
    { title: "Excel Modeling Workshop", kind: "WORKSHOP" },
    { title: "Résumé & LinkedIn Photo Lab", kind: "WORKSHOP", cost: ["Photographer", 1, 150] },
    { title: "Stock Pitch Competition", kind: "COMPETITION", minutes: 120, cost: ["Prize gift cards", 3, 50] },
    { title: "Company Visit: Downtown Ogden Firms", kind: "OTHER", where: "social", minutes: 150 },
    { title: "Bake Sale Fundraiser", kind: "FUNDRAISER", minutes: 240, cost: ["Baking supplies", 1, 60] },
    { title: "Interview Etiquette Dinner", kind: "WORKSHOP", minutes: 120, cost: ["Plated dinner", 30, 18] },
    { title: "Case Competition Kickoff", kind: "COMPETITION" },
    { title: "Virtual Q&A with a Salt Lake Recruiter", kind: "WORKSHOP", where: "virtual" },
    { title: "Free Tax Prep Volunteer Day", kind: "SERVICE", where: "service", minutes: 240 },
    { title: "Meet the Firms", kind: "SOCIAL", minutes: 120, cost: ["Refreshments", 1, 220] },
  ],
  health: [
    { title: "MCAT Study Night", kind: "WORKSHOP", minutes: 120, cost: ["Snacks", 1, 45] },
    { title: "Physician Panel: The Road to Med School", kind: "WORKSHOP", minutes: 90 },
    { title: "Suturing Workshop", kind: "WORKSHOP", cost: ["Suture practice kits", 25, 12] },
    { title: "Blood Drive", kind: "SERVICE", minutes: 300 },
    { title: "CPR & First Aid Certification", kind: "WORKSHOP", minutes: 180, cost: ["Certification cards", 20, 15] },
    { title: "Community Health Fair Booth", kind: "SERVICE", where: "service", minutes: 240 },
    { title: "Mock Interview Night", kind: "WORKSHOP" },
    { title: "End-of-Semester Potluck", kind: "SOCIAL" },
    { title: "Virtual Admissions Q&A", kind: "WORKSHOP", where: "virtual" },
    { title: "Flu Shot Clinic Volunteer Shift", kind: "SERVICE", minutes: 180 },
  ],
  science: [
    { title: "Chemistry Demo Show", kind: "OTHER", cost: ["Demo supplies", 1, 120] },
    { title: "Research Poster Practice", kind: "WORKSHOP" },
    { title: "Grad School Panel", kind: "WORKSHOP" },
    { title: "Lab Safety Refresher", kind: "TRAINING" },
    { title: "Star Party", kind: "SOCIAL", where: "outdoors", minutes: 150 },
    { title: "Pizza & Problem Sets", kind: "SOCIAL", cost: ["Pizza", 8, 14] },
    { title: "Faculty Research Spotlight", kind: "WORKSHOP" },
  ],
  socsci: [
    { title: "Debate Watch Party", kind: "SOCIAL", minutes: 150, cost: ["Snacks", 1, 60] },
    { title: "Voter Registration Drive", kind: "SERVICE", minutes: 240 },
    { title: "Career Panel: Grad School in Psychology", kind: "WORKSHOP" },
    { title: "Guest Lecture: Civil Discourse in Polarized Times", kind: "WORKSHOP", minutes: 90 },
    { title: "Mental Health Awareness Fair", kind: "SERVICE", minutes: 180 },
    { title: "Mock Trial Night", kind: "COMPETITION", minutes: 120 },
    { title: "Research Lab Open House", kind: "OTHER" },
    { title: "Virtual Panel: Careers in Public Service", kind: "WORKSHOP", where: "virtual" },
    { title: "Ride-Along Info Session", kind: "WORKSHOP" },
  ],
  education: [
    { title: "Classroom Management Panel", kind: "WORKSHOP" },
    { title: "Praxis Study Session", kind: "WORKSHOP", minutes: 120 },
    { title: "Read-Aloud at the Weber County Library", kind: "SERVICE", where: "service", minutes: 120 },
    { title: "Teacher Appreciation Card Making", kind: "SERVICE" },
    { title: "Back-to-School Social", kind: "SOCIAL", cost: ["Ice cream social", 1, 90] },
  ],
  arts: [
    { title: "Open Mic Night", kind: "SOCIAL", minutes: 120, cost: ["Hot chocolate bar", 1, 70] },
    { title: "Play Reading", kind: "OTHER" },
    { title: "Improv Workshop", kind: "WORKSHOP" },
    { title: "Gallery Walk on 25th Street", kind: "SOCIAL", where: "social", minutes: 120 },
    { title: "Writing Sprint", kind: "WORKSHOP", minutes: 180 },
    { title: "Set Build Saturday", kind: "OTHER", minutes: 300, cost: ["Lumber and paint", 1, 240] },
    { title: "Holiday Art Sale", kind: "FUNDRAISER", minutes: 360 },
  ],
  culture: [
    { title: "Heritage Month Kickoff", kind: "SOCIAL", minutes: 120, cost: ["Catering", 1, 450] },
    { title: "Potluck & Game Night", kind: "SOCIAL", minutes: 150 },
    { title: "Culture Night", kind: "OTHER", minutes: 180, cost: ["Decorations", 1, 120] },
    { title: "Film Screening & Discussion", kind: "OTHER", minutes: 150 },
    { title: "Scholarship Application Workshop", kind: "WORKSHOP" },
    { title: "Alumni Mentoring Mixer", kind: "SOCIAL", minutes: 120, cost: ["Refreshments", 1, 160] },
    { title: "Día de los Muertos Celebration", kind: "SOCIAL", minutes: 180, cost: ["Pan dulce & cocoa", 1, 200] },
    { title: "Dance Workshop", kind: "WORKSHOP" },
  ],
  service: [
    { title: "Ogden Nature Center Cleanup", kind: "SERVICE", where: "service", minutes: 180 },
    { title: "Food Drive for the Weber Cares Pantry", kind: "SERVICE", minutes: 240 },
    { title: "Care Kit Assembly", kind: "SERVICE", minutes: 120, cost: ["Care kit supplies", 60, 6] },
    { title: "Tutoring Night", kind: "SERVICE" },
    { title: "Veterans Day Flag Ceremony", kind: "OTHER" },
    { title: "Trail Day on the Ogden River Parkway", kind: "SERVICE", where: "service", minutes: 180 },
    { title: "Volunteer Appreciation Social", kind: "SOCIAL", cost: ["Pizza", 10, 14] },
  ],
  sports: [
    { title: "Intro Clinic for Beginners", kind: "WORKSHOP" },
    { title: "Gear Swap", kind: "FUNDRAISER", minutes: 180 },
    { title: "Weekend Trip", kind: "SOCIAL", where: "outdoors", minutes: 480, cost: ["Van rental", 2, 120] },
    { title: "Home Tournament", kind: "COMPETITION", minutes: 300, cost: ["Tournament fees", 1, 200] },
    { title: "Season Kickoff Party", kind: "SOCIAL", cost: ["Snacks", 1, 80] },
    { title: "Charity Tournament", kind: "FUNDRAISER", minutes: 240 },
    { title: "Safety & Certification Clinic", kind: "TRAINING", minutes: 120 },
  ],
  games: [
    { title: "Tournament Night", kind: "COMPETITION", minutes: 180, cost: ["Prizes", 1, 60] },
    { title: "Cosplay Workshop", kind: "WORKSHOP", cost: ["Craft foam & glue", 1, 75] },
    { title: "Movie Marathon", kind: "SOCIAL", minutes: 300, cost: ["Snacks", 1, 55] },
    { title: "Simul Exhibition", kind: "OTHER", minutes: 150 },
    { title: "Speed Blitz Night", kind: "COMPETITION" },
    { title: "Sketch Night", kind: "SOCIAL" },
  ],
  ambassadors: [
    { title: "College Open House Volunteer Shift", kind: "SERVICE", minutes: 180 },
    { title: "Club Leaders Roundtable", kind: "OTHER", minutes: 90, cost: ["Lunch", 20, 12] },
    { title: "Prospective Student Tour Day", kind: "SERVICE", minutes: 180 },
    { title: "Ambassador Training", kind: "TRAINING" },
  ],
  faith: [
    { title: "Welcome Back Barbecue", kind: "SOCIAL", where: "outdoors", minutes: 120, cost: ["Burgers & drinks", 1, 180] },
    { title: "Study Group & Discussion", kind: "OTHER" },
    { title: "Service Saturday", kind: "SERVICE", where: "service", minutes: 180 },
    { title: "Guest Speaker Night", kind: "OTHER", minutes: 90 },
    { title: "Finals Week Snack Break", kind: "SOCIAL", cost: ["Snacks", 1, 70] },
    { title: "Game Night", kind: "SOCIAL", minutes: 120 },
  ],
  advocacy: [
    { title: "Voter Registration Table", kind: "SERVICE", minutes: 240 },
    { title: "Panel Discussion", kind: "WORKSHOP", minutes: 90 },
    { title: "Documentary Screening & Discussion", kind: "OTHER", minutes: 150 },
    { title: "Letter-Writing Night", kind: "OTHER" },
    { title: "Awareness Week Booth", kind: "SERVICE", minutes: 240, cost: ["Printing", 200, 0.25] },
    { title: "Community Cleanup", kind: "SERVICE", where: "service", minutes: 180 },
  ],
  greek: [
    { title: "Rush Week Open House", kind: "SOCIAL", minutes: 120, cost: ["Refreshments", 1, 150] },
    { title: "Philanthropy Fundraiser", kind: "FUNDRAISER", minutes: 240 },
    { title: "Study Hours", kind: "OTHER", minutes: 120 },
    { title: "Sisterhood/Brotherhood Night", kind: "SOCIAL", minutes: 120 },
    { title: "Service Project", kind: "SERVICE", where: "service", minutes: 180 },
  ],
  honor: [
    { title: "New Member Induction Ceremony", kind: "OTHER", minutes: 90, cost: ["Certificates & cords", 1, 160] },
    { title: "Grad School Application Workshop", kind: "WORKSHOP" },
    { title: "Faculty Research Talk", kind: "WORKSHOP" },
    { title: "Tutoring Night", kind: "SERVICE", minutes: 120 },
    { title: "Scholarship Info Session", kind: "WORKSHOP", where: "virtual" },
  ],
  media: [
    { title: "Pitch Meeting", kind: "OTHER" },
    { title: "Interviewing Workshop", kind: "WORKSHOP" },
    { title: "Audio Editing Basics", kind: "WORKSHOP" },
    { title: "Portfolio Review with Alumni", kind: "WORKSHOP", minutes: 90 },
    { title: "Open House & Studio Tour", kind: "SOCIAL" },
  ],
  music: [
    { title: "Jam Session", kind: "SOCIAL", minutes: 120 },
    { title: "End-of-Semester Recital", kind: "OTHER", minutes: 120, cost: ["Programs printing", 80, 0.5] },
    { title: "Masterclass", kind: "WORKSHOP", minutes: 90 },
    { title: "Open Mic Night", kind: "SOCIAL", minutes: 120 },
    { title: "Community Concert", kind: "SERVICE", where: "service", minutes: 120 },
  ],
  dance: [
    { title: "Beginner Lesson Night", kind: "WORKSHOP", minutes: 90 },
    { title: "Social Dance", kind: "SOCIAL", minutes: 150, cost: ["Sound system rental", 1, 90] },
    { title: "Showcase Performance", kind: "OTHER", minutes: 120 },
    { title: "Workshop with a Guest Instructor", kind: "WORKSHOP", minutes: 120, cost: ["Instructor fee", 1, 150] },
    { title: "Practice Marathon", kind: "PRACTICE", minutes: 180 },
  ],
  spirit: [
    { title: "Tailgate Before the Home Opener", kind: "SOCIAL", where: "campus", minutes: 150, cost: ["Food & drinks", 1, 250] },
    { title: "Sign & Banner Painting Night", kind: "OTHER", cost: ["Paint and poster board", 1, 85] },
    { title: "Away Game Watch Party", kind: "SOCIAL", minutes: 150, cost: ["Snacks", 1, 60] },
    { title: "Homecoming Spirit Week Booth", kind: "OTHER", minutes: 240 },
    { title: "Student Section Meetup", kind: "SOCIAL" },
  ],
  film: [
    { title: "Cult Classic Double Feature", kind: "SOCIAL", minutes: 240, cost: ["Popcorn & drinks", 1, 55] },
    { title: "Costume Screening Night", kind: "SOCIAL", minutes: 180 },
    { title: "Short Film Night", kind: "OTHER", minutes: 120 },
    { title: "Trivia & Trailers", kind: "SOCIAL" },
    { title: "Outdoor Movie Night", kind: "SOCIAL", where: "social", minutes: 150, cost: ["Projector rental", 1, 120] },
    { title: "Filmmaking Workshop", kind: "WORKSHOP" },
  ],
  general: [
    { title: "Welcome Social", kind: "SOCIAL", cost: ["Snacks", 1, 50] },
    { title: "Officer Q&A and Planning Night", kind: "OTHER" },
    { title: "Movie Night", kind: "SOCIAL", minutes: 150 },
    { title: "Service Day", kind: "SERVICE", where: "service", minutes: 180 },
    { title: "End-of-Semester Party", kind: "SOCIAL", minutes: 120, cost: ["Pizza", 6, 14] },
  ],
};


export const REVIEWS = {
  5: [
    "Best decision I made this year. Everyone in {club} is welcoming and the officers actually follow through.",
    "I showed up not knowing anyone and now these are my people. Meetings are organized and fun.",
    "{club} is so well run. You can tell the officers care about new members.",
    "Learned more here than in some of my classes, honestly. The workshops are great.",
    "Super welcoming. I came to one event and got pulled into a project the same night.",
    "Consistently good events and a great mix of majors. Highly recommend.",
    "Exactly what I hoped college would be like. Come to a meeting, you won't regret it.",
  ],
  4: [
    "Really solid club. Events can run a little long, but the people are great.",
    "Good community and useful events. I wish they met at a time that worked better with my labs.",
    "Fun and well organized. Communication between meetings could be a bit better.",
    "I've made good friends in {club}. Some meetings are better than others but it's worth it.",
    "Great officers. Would love more events on the Davis campus.",
    "Helpful for my career and a lot of fun. The room gets crowded early in the semester.",
  ],
  3: [
    "It's fine. Some meetings feel disorganized, but the big events are worth going to.",
    "Nice people, but it's hard to get involved if you're not already friends with the officers.",
    "Decent club. Turnout drops off after the first few weeks so meetings can be quiet.",
    "Mixed experience — great workshops, but a lot of announcements and not much doing.",
  ],
  2: [
    "Events get cancelled last minute a lot. I want to like it but it's frustrating.",
    "Meetings mostly feel like a social group for the officers.",
    "Not much happened this semester after the first couple of meetings.",
  ],
  1: [
    "Didn't feel welcome at all.",
    "Waste of time this semester.",
  ],
} as const;

export const BOMBING_REVIEWS = [
  "Cliquey. The officers only play rounds with their friends. Avoid.",
  "Total waste. One star.",
  "Don't bother. New people get ignored.",
  "Worst club on campus. Skip it.",
];

export const CHAT = {
  general: [
    "Is anyone heading over early? I can save seats.",
    "Thanks everyone who came out tonight!",
    "Slides from today are in the club files 👍",
    "Running about 10 minutes late, start without me",
    "Does anyone have a phone charger I can borrow at the meeting?",
    "That was such a good turnout tonight",
    "Reminder: check in with the QR code when you get there so we can keep our attendance numbers up",
    "Who's bringing snacks next week?",
    "Can someone remind me which room we're in?",
    "Welcome to all the new members this week!",
    "I'm in, count me in for Saturday",
    "Parking by the Union was a nightmare today, plan ahead",
    "Anyone want to carpool from the Davis campus?",
    "The event's on the calendar now if you want to subscribe",
    "Great meeting, see you all next week",
    "Can we do a group photo next time?",
    "Just finished midterms, I'll be back next week 😅",
    "Happy Friday Wildcats!",
    "Does anyone have notes from last week? I missed it",
    "I added the sign-up sheet to the files",
  ],
  tech: ["Who has the spare Arduino Megas?", "The 3D printer in the makerspace is jammed again", "Pushed the fix to the repo, can someone review?", "Anyone else going to the career fair Thursday?", "CAD files are in the shared folder"],
  business: ["The pitch template is in files", "Anyone want to practice interviews before the career fair?", "Market was wild today 📉", "Remember business casual for the networking night"],
  health: ["Who's in for the MCAT study group Sunday?", "Shadowing sign-up closes Friday", "Anyone have a spare stethoscope for skills lab?"],
  science: ["Lab coats required for the demo", "Anyone have the TA's office hours?", "Clear skies Thursday, telescope night is on"],
  socsci: ["Watch party snacks are covered", "Reading for next week is posted", "Please keep it civil in here, thanks all"],
  education: ["Praxis practice tests are in files", "Who's free for the read-aloud on Saturday?"],
  arts: ["Auditions sign-up is on the callboard", "We need two more people for crew", "Open mic list is filling up fast"],
  culture: ["Potluck sign-up sheet is in files", "Bring a friend this week!", "Who can help set up at 5?"],
  service: ["We need 6 more volunteers for Saturday", "Wear closed-toe shoes for the trail day", "The pantry said thank you for last month 💛"],
  sports: ["Conditions look great this weekend", "Carpool leaves the Stromberg lot at 7", "Who has extra gear to lend a beginner?", "Waivers need to be in before the trip"],
  games: ["Tournament bracket is posted", "Who's bringing the projector?", "Next week's pick is up for a vote"],
  ambassadors: ["Tour shifts are posted", "Please send me your club's updates by Friday", "Polo shirts are in the office"],
  faith: ["See everyone Thursday night", "Who's bringing treats this week?", "Thanks for the great discussion tonight"],
  advocacy: ["Tabling sign-up sheet is in files", "Bring a friend to the panel!", "Reminder: be respectful in here, even when we disagree"],
  greek: ["Study hours are in the library this week", "Philanthropy shifts are posted", "Chapter meeting moved to 7:30"],
  honor: ["Induction cords are in", "Tutoring sign-ups are open", "Dues reminder for new members"],
  media: ["Pitches due Friday", "Who can cover Saturday's game?", "Studio is booked until 6"],
  music: ["Sheet music is in the shared folder", "Who has an extra music stand?", "Rehearsal runs late Thursday"],
  dance: ["Wear shoes you can turn in", "Practice playlist is posted", "We need two more leads for Friday"],
  spirit: ["Wear purple Saturday!", "Banner paint night is Thursday", "Meet at the student section gate at 6"],
  film: ["Next week's pick is up for a vote", "Who's bringing the projector?", "That ending though 😳"],
  // "general" doubles as the generic topic's bank.
} as const;

export const ANNOUNCEMENTS = [
  {
    title: "Welcome back, Wildcats!",
    body: (club: string, room: string) =>
      `<h3>We're back for another semester</h3><p>Thanks to everyone who stopped by our table at the Involvement Fair. ${club} meets in <strong>${room}</strong> — check the calendar for this week's time.</p><ul><li>New members: check in with the QR code so we know you came.</li><li>Bring a friend — first meetings are the best time to join.</li></ul>`,
  },
  {
    title: "Officer elections are coming up",
    body: (club: string) =>
      `<p>${club} will choose next year's officers soon. If you've thought about leading, now's the time.</p><h3>How it works</h3><ol><li>Talk to a current officer about what the role involves.</li><li>Nominations open on the platform two weeks before voting.</li><li>Our bylaws explain who votes — they're under Resources on the club page.</li></ol>`,
  },
  {
    title: "Volunteers needed this weekend",
    body: () =>
      `<p>We need a few more hands for Saturday. Sign up in the club chat and we'll send details.</p><ul><li>Wear comfortable shoes</li><li>Water and snacks provided</li><li>Counts toward service hours</li></ul>`,
  },
  {
    title: "Room change for this week",
    body: (_club: string, room: string) => `<p>Heads up: this week's meeting moves to <strong>${room}</strong>. The calendar has the update.</p>`,
  },
  {
    title: "Photos from our last event",
    body: (club: string) => `<p>Thanks for making our last event one of the best turnouts ${club} has had. Photos are in the club files under <em>Flyers &amp; Photos</em>.</p>`,
  },
  {
    title: "Funding request approved",
    body: () => `<p>Good news: WSUSA approved our funding request, so snacks and supplies for the rest of the semester are covered. Thanks to our treasurer for putting it together.</p>`,
  },
  {
    title: "Midterm check-in",
    body: (club: string) =>
      `<p>Midterms are rough. ${club} is keeping meetings low-key the next two weeks — come study with us.</p><p><strong>Tip:</strong> the Stewart Library has extended hours during midterms.</p>`,
  },
  {
    title: "Officer meeting notes posted",
    body: () => `<p>Notes from this week's officer meeting are in Officer Notes. Please review the action items before Thursday.</p>`,
    leaders: true,
  },
] as const;

export const HEADLINES = [
  "{major} student at Weber State",
  "{major} major · Wildcat",
  "Aspiring {career} · {major} at WSU",
  "{major} student who loves a good group project",
  "Weber State {major} · class of {year}",
  "{major} · first-gen college student",
];

export const CAREERS: Record<string, string> = {
  gsbe: "financial analyst",
  east: "engineer",
  cos: "researcher",
  sbs: "counselor",
  edu: "teacher",
  health: "nurse",
  arts: "designer",
};

export const JOBS = [
  { title: "Barista", organization: "Shepherd Union Coffee Bar", location: "Ogden, UT" },
  { title: "Sales Associate", organization: "Newgate Mall", location: "Ogden, UT" },
  { title: "Peer Tutor", organization: "Weber State Writing Center", location: "Ogden, UT" },
  { title: "Lab Assistant", organization: "Weber State University", location: "Ogden, UT" },
  { title: "Server", organization: "25th Street restaurant", location: "Ogden, UT" },
  { title: "Lift Operator", organization: "Snowbasin Resort", location: "Huntsville, UT" },
  { title: "Student Office Assistant", organization: "Weber State Student Involvement & Leadership", location: "Ogden, UT" },
  { title: "Intern", organization: "Northrop Grumman", location: "Roy, UT" },
  { title: "Engineering Intern", organization: "Hill Air Force Base", location: "Hill AFB, UT" },
  { title: "Certified Nursing Assistant", organization: "McKay-Dee Hospital", location: "Ogden, UT" },
  { title: "Camp Counselor", organization: "Ogden City Recreation", location: "Ogden, UT" },
  { title: "Bank Teller", organization: "America First Credit Union", location: "Riverdale, UT" },
] as const;

export const MINUTES_ITEMS = [
  "Treasurer gave the budget update; funding request for next term is in draft.",
  "Events team confirmed the room for the next social.",
  "Discussed co-hosting with another club next month.",
  "New members introduced themselves.",
  "Reminder to check in with the QR code at every meeting.",
  "Brainstormed ideas for the end-of-semester event.",
  "Officer requirement reminder: finish the Club Officer Policy Test.",
  "Volunteers signed up for the service project.",
  "Talked about recruiting at the Involvement Fair.",
  "Reviewed feedback from last event — more food next time.",
];
