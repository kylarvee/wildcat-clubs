import type { ClubScope, ClubStatus, ClubType, JoinPolicy, SuccessionMethod } from "@prisma/client";
import type { CollegeKey } from "./reference";

/**
 * Every club in the mock database. Approved clubs get a full history (members,
 * roles back to founding, events, attendance, files, budget); founding-stage
 * clubs get exactly what their stage needs.
 */

export type Category = "tech" | "business" | "health" | "science" | "socsci" | "education" | "arts" | "culture" | "service" | "sports" | "games" | "ambassadors";

export type Life = "active" | "inactive" | "pilot" | "ambassadors" | "draft" | "submitted" | "changes" | "rejected" | "retired";

export type Meeting = { dow: number; time: [number, number]; duration: number; interval: 1 | 2; building: string; room: string; title?: string };

export type ClubDef = {
  key: string;
  slug: string;
  name: string;
  type: ClubType;
  scope: ClubScope;
  college?: CollegeKey;
  department?: string;
  requestedDepartmentName?: string;
  focusMajor?: string;
  focusOther?: string;
  status: ClubStatus;
  life: Life;
  /** Year and month the club was created (ignored for clubs placed relative to today). */
  founded?: [number, number];
  /** ACTIVE members today (approved clubs). */
  size: number;
  joinPolicy?: JoinPolicy;
  succession?: SuccessionMethod;
  autoApproveCohosts?: boolean;
  color: string;
  category: Category;
  /** Event and attendance intensity, ~0.3 (quiet) to 1.2 (very active). */
  activity: number;
  meeting: Meeting;
  related: string[];
  short: string;
  about: string;
  does: string[];
  join?: string;
  /** Inactive clubs stopped meeting after this term. */
  lastActiveTerm?: string;
  retired?: { at: [number, number, number]; reason: string };
  rejectedNote?: string;
};

const M = (dow: number, h: number, m: number, duration: number, interval: 1 | 2, building: string, room: string, title?: string): Meeting => ({
  dow, time: [h, m], duration, interval, building, room, title,
});

export const CLUBS: ClubDef[] = [
  // ─── Goddard School of Business & Economics ────────────────────────────────
  {
    key: "ailab", slug: "applied-ai-lab", name: "Applied AI Lab", type: "SPONSORED", scope: "COLLEGE", college: "gsbe",
    department: "Information Systems & Technologies", focusMajor: "Information Systems & Technologies", status: "APPROVED", life: "active",
    founded: [2023, 9], size: 64, succession: "MEMBER_VOTE", color: "#4b2e83", category: "tech", activity: 1.05,
    meeting: M(3, 18, 0, 90, 1, "WB", "Room 210", "Lab Night"),
    related: ["acm", "datasci", "fic", "entre"],
    short: "Build real AI projects with Weber State students from every major — no experience required.",
    about: "The Applied AI Lab is where Wildcats learn to build with AI by actually building. Members pair up on projects for campus partners and local businesses, from chatbots that answer advising questions to models that forecast parking demand.",
    does: ["Weekly lab nights with project teams and mentors", "Workshops on prompt engineering, Python and responsible AI", "A spring showcase where teams demo to Goddard School faculty and employers", "Case packages for local nonprofits"],
    join: "Anyone at Weber State. Business, engineering, design and humanities majors all have a place on project teams.",
  },
  {
    key: "fic", slug: "finance-investment-club", name: "Finance & Investment Club", type: "REGISTERED", scope: "COLLEGE", college: "gsbe",
    focusMajor: "Finance", status: "APPROVED", life: "active", founded: [2022, 9], size: 48, color: "#0f766e", category: "business", activity: 0.9,
    meeting: M(2, 17, 30, 60, 1, "WB", "Room 108"),
    related: ["accounting", "entre", "marketing", "ailab"],
    short: "Pitch stocks, run a paper portfolio and meet Wasatch Front finance pros.",
    about: "We help Wildcats get comfortable with markets before their first internship. Members research companies, pitch them to the group and manage a paper portfolio that's tracked all year.",
    does: ["Weekly market recap and stock pitches", "Excel and valuation modeling workshops", "Networking nights with Goddard School alumni", "The spring Stock Pitch Competition"],
  },
  {
    key: "accounting", slug: "accounting-society", name: "Accounting Society", type: "SPONSORED", scope: "COLLEGE", college: "gsbe",
    department: "School of Accounting & Taxation", focusMajor: "Accounting", status: "APPROVED", life: "active", founded: [2022, 9], size: 42,
    color: "#1e3a8a", category: "business", activity: 0.85,
    meeting: M(4, 12, 0, 60, 2, "WB", "Room 205", "Lunch & Learn"),
    related: ["fic", "marketing", "entre"],
    short: "Lunch-and-learns with firms, CPA exam tips and tax-season volunteering.",
    about: "The Accounting Society connects School of Accounting & Taxation students with the firms that recruit at Weber State. We also volunteer during tax season so neighbors in Ogden can file for free.",
    does: ["Lunch-and-learns with Big Four and regional firms", "CPA exam and internship prep", "VITA free tax prep volunteer days", "Meet the Firms night every fall"],
  },
  {
    key: "marketing", slug: "marketing-association", name: "Marketing Association", type: "AFFILIATE", scope: "COLLEGE", college: "gsbe",
    department: "Business Administration", focusMajor: "Marketing", status: "APPROVED", life: "active", founded: [2023, 1], size: 36,
    color: "#be123c", category: "business", activity: 0.8,
    meeting: M(1, 17, 30, 60, 2, "WB", "Room 218"),
    related: ["entre", "accounting", "fic"],
    short: "Real campaigns for real clients, plus portfolio nights and agency tours.",
    about: "We run small campaigns for campus departments and Ogden businesses so members graduate with work they can show. Everyone's welcome, whether you're into data, design or sales.",
    does: ["Client projects for campus and local partners", "Agency tours along the Wasatch Front", "Portfolio and LinkedIn nights", "Case competitions"],
  },
  {
    key: "entre", slug: "entrepreneurship-club", name: "Entrepreneurship Club", type: "REGISTERED", scope: "COLLEGE", college: "gsbe",
    focusMajor: "Business Administration", status: "APPROVED", life: "active", founded: [2024, 1], size: 30, color: "#b45309", category: "business", activity: 0.75,
    meeting: M(3, 12, 0, 60, 2, "WB", "Room 108", "Founders' Lunch"),
    related: ["marketing", "fic", "ailab"],
    short: "Test your idea, find a co-founder and pitch at the Wildcat Venture Challenge.",
    about: "For students who'd rather build something than wait for permission. We meet over lunch to workshop ideas, bring in local founders and help teams get ready for pitch competitions.",
    does: ["Founders' lunches with Ogden entrepreneurs", "Idea workshops and customer-interview practice", "Pitch prep for the Wildcat Venture Challenge"],
  },
  {
    key: "gsbe-amb", slug: "goddard-school-ambassadors", name: "Goddard School Ambassadors", type: "COLLEGE_AMBASSADORS", scope: "COLLEGE", college: "gsbe",
    status: "APPROVED", life: "ambassadors", founded: [2023, 8], size: 16, color: "#312e81", category: "ambassadors", activity: 0.7,
    meeting: M(1, 12, 0, 60, 2, "WB", "Room 205", "Ambassador Huddle"),
    related: ["accounting", "marketing", "fic", "entre", "ailab"],
    short: "The Goddard School's student ambassadors — connecting business clubs with the college.",
    about: "Goddard School Ambassadors represent the business school at recruiting events and act as the link between the college and its clubs. Club Representative Ambassadors sit in on each business club so news, needs and opportunities move both ways.",
    does: ["Club representatives embedded in every Goddard School club", "Marketing help for business clubs", "College-wide events and recruiting days"],
    join: "Ambassadors apply each spring; club members can talk to their club's ambassador any time.",
  },

  // ─── Engineering, Applied Science & Technology ──────────────────────────────
  {
    key: "robotics", slug: "wildcat-robotics", name: "Wildcat Robotics", type: "SPONSORED", scope: "COLLEGE", college: "east",
    department: "Electrical & Computer Engineering", focusMajor: "Electrical Engineering", status: "APPROVED", life: "active", founded: [2022, 9], size: 90,
    joinPolicy: "APPROVAL", color: "#1d4ed8", category: "tech", activity: 1.2,
    meeting: M(2, 18, 0, 120, 1, "NB", "Room 150 (Makerspace)", "Build Night"),
    related: ["acm", "swe", "motorsports", "cyber"],
    short: "Design, build and compete with robots — from VEX to NASA Lunabotics.",
    about: "Wildcat Robotics is Weber State's competitive robotics team. We design, machine, wire and program robots in the Noorda makerspace and take them to regional and national competitions.",
    does: ["Tuesday build nights in the Noorda makerspace", "Teams for NASA Lunabotics and regional VEX U events", "Soldering, CAD and embedded programming workshops", "STEM outreach at Ogden-area schools"],
    join: "Open to every major. Because shop time is limited, new members are approved by our membership officer — we just want to make sure you've done the makerspace safety orientation.",
  },
  {
    key: "swe", slug: "society-of-women-engineers", name: "Society of Women Engineers", type: "AFFILIATE", scope: "COLLEGE", college: "east",
    department: "Mechanical Engineering", focusMajor: "Mechanical Engineering", status: "APPROVED", life: "active", founded: [2022, 10], size: 44,
    succession: "LEADERSHIP_VOTE", color: "#7c3aed", category: "tech", activity: 0.95,
    meeting: M(4, 17, 30, 60, 2, "NB", "Room 220"),
    related: ["robotics", "acm", "cyber"],
    short: "Support, mentorship and outreach for women in engineering and technology.",
    about: "Weber State's SWE section builds community for women and allies across EAST. We bring in engineers from Hill Air Force Base and local industry, run outreach for girls in STEM and send members to the SWE national conference.",
    does: ["Industry panels and mentoring circles", "Girls in STEM outreach days with Ogden schools", "Résumé reviews before career fairs", "Travel to the SWE national conference"],
  },
  {
    key: "acm", slug: "acm-computer-science-club", name: "ACM Computer Science Club", type: "AFFILIATE", scope: "COLLEGE", college: "east",
    department: "School of Computing", focusMajor: "Computer Science", status: "APPROVED", life: "active", founded: [2022, 9], size: 72, color: "#0e7490", category: "tech", activity: 1.0,
    meeting: M(1, 18, 30, 90, 1, "NB", "Room 308", "Hack Night"),
    related: ["robotics", "cyber", "ailab", "datasci", "swe"],
    short: "Hack nights, coding interviews practice and the Wildcat Hackathon.",
    about: "Weber State's chapter of the Association for Computing Machinery. We code together, prep for technical interviews and run the Wildcat Hackathon every spring.",
    does: ["Monday hack nights", "LeetCode and mock interview sessions", "Tech talks from Utah software companies", "The Wildcat Hackathon"],
  },
  {
    key: "cyber", slug: "cybersecurity-club", name: "Cybersecurity Club", type: "REGISTERED", scope: "COLLEGE", college: "east",
    focusMajor: "Cybersecurity", status: "APPROVED", life: "active", founded: [2023, 1], size: 38, joinPolicy: "APPROVAL", color: "#15803d", category: "tech", activity: 0.9,
    meeting: M(3, 18, 30, 90, 1, "NB", "Room 210", "Lab Night"),
    related: ["acm", "robotics", "swe"],
    short: "Capture-the-flag practice, home labs and security certifications.",
    about: "We practice offensive and defensive security in a safe lab, compete in capture-the-flag events and help each other study for certifications like Security+.",
    does: ["Weekly CTF practice", "Home lab build nights", "Security+ study groups", "Competitions like the National Cyber League"],
    join: "Open to everyone. Because we practice real techniques, new members agree to the lab's ethics pledge and are approved by an officer.",
  },
  {
    key: "motorsports", slug: "wildcat-motorsports", name: "Wildcat Motorsports", type: "SPONSORED", scope: "COLLEGE", college: "east",
    department: "Automotive Technology", focusMajor: "Automotive Technology", status: "APPROVED", life: "active", founded: [2023, 9], size: 34, joinPolicy: "APPROVAL",
    color: "#c2410c", category: "tech", activity: 0.85,
    meeting: M(4, 18, 0, 120, 1, "D3", "Room 106", "Shop Night"),
    related: ["robotics", "swe"],
    short: "Building a Formula SAE car at the Davis campus — every major welcome.",
    about: "Wildcat Motorsports designs and builds a small formula-style race car each year at the Davis campus automotive shops. Engineering, automotive, business and design students all have a role.",
    does: ["Thursday shop nights at Davis D3", "Design reviews and fabrication training", "Sponsorship and outreach team", "Competition trips"],
    join: "Open to every major. New members are approved after the shop safety orientation.",
  },
  {
    key: "east-amb", slug: "east-ambassadors", name: "EAST Ambassadors", type: "COLLEGE_AMBASSADORS", scope: "COLLEGE", college: "east",
    status: "APPROVED", life: "ambassadors", founded: [2024, 8], size: 14, color: "#1e40af", category: "ambassadors", activity: 0.7,
    meeting: M(5, 12, 0, 60, 2, "NB", "Room 210", "Ambassador Huddle"),
    related: ["robotics", "swe", "acm", "cyber", "motorsports"],
    short: "EAST's student ambassadors — tours, outreach and a voice for engineering clubs.",
    about: "EAST Ambassadors give tours, staff college events and place a Club Representative Ambassador in each EAST club so clubs always have a direct line to the college.",
    does: ["Club representatives in EAST clubs", "Prospective-student tours of Noorda", "Inter-club coordination so engineering clubs don't double-book"],
    join: "Ambassadors apply each spring.",
  },

  // ─── College of Science ─────────────────────────────────────────────────────
  {
    key: "premed", slug: "pre-med-society", name: "Pre-Med Society", type: "REGISTERED", scope: "COLLEGE", college: "cos",
    focusOther: "Pre-health professions", status: "APPROVED", life: "active", founded: [2022, 9], size: 104, color: "#be185d", category: "health", activity: 1.0,
    meeting: M(1, 17, 0, 60, 1, "TY", "Room 150"),
    related: ["chem", "nursing", "psych", "dental"],
    short: "MCAT prep, physician panels and shadowing tips for future doctors.",
    about: "Pre-Med Society helps Wildcats on the path to medical, PA and other health professional schools. We demystify the application, connect members with shadowing and service, and keep each other going through the MCAT.",
    does: ["Physician and admissions panels", "MCAT study nights", "Shadowing and service hour opportunities", "Mock interviews"],
  },
  {
    key: "chem", slug: "chemistry-club", name: "Chemistry Club", type: "AFFILIATE", scope: "COLLEGE", college: "cos",
    department: "Chemistry & Biochemistry", focusMajor: "Chemistry", status: "APPROVED", life: "active", founded: [2022, 10], size: 26, color: "#0891b2", category: "science", activity: 0.75,
    meeting: M(4, 12, 0, 50, 2, "TY", "Room 225"),
    related: ["premed", "astro", "datasci"],
    short: "Demo shows, research talks and the best Mole Day party in Ogden.",
    about: "A home for chemistry and biochemistry students and anyone who likes things that fizz. We run demo shows for local schools, host research talks and celebrate Mole Day properly.",
    does: ["Chemistry demo shows for schools", "Faculty research talks", "Grad school and industry panels", "Mole Day (Oct 23) celebration"],
  },
  {
    key: "astro", slug: "astronomy-club", name: "Astronomy Club", type: "AFFILIATE", scope: "COLLEGE", college: "cos",
    department: "Physics & Astronomy", focusMajor: "Physics", status: "APPROVED", life: "inactive", founded: [2022, 9], size: 7, color: "#1e293b", category: "science", activity: 0.35,
    meeting: M(4, 19, 30, 90, 2, "LL", "Ott Planetarium", "Star Night"),
    related: ["chem", "math"],
    lastActiveTerm: "Spring 2025",
    short: "Star parties, planetarium shows and telescope nights.",
    about: "We host star parties, borrow the department's telescopes and run planetarium nights in the Ott Planetarium.",
    does: ["Telescope nights", "Planetarium shows", "Trips to dark-sky sites"],
  },
  {
    key: "math", slug: "math-club", name: "Math Club", type: "AFFILIATE", scope: "COLLEGE", college: "cos",
    department: "Mathematics", focusMajor: "Mathematics", status: "APPROVED", life: "inactive", founded: [2023, 1], size: 8, color: "#475569", category: "science", activity: 0.35,
    meeting: M(3, 15, 30, 60, 2, "TY", "Room 316", "Problem Session"),
    related: ["astro", "datasci", "acm"],
    lastActiveTerm: "Fall 2025",
    short: "Problem sessions, Putnam practice and pi(e) on March 14.",
    about: "Math Club meets to work interesting problems together, practice for the Putnam exam and talk about life after a math degree.",
    does: ["Problem-solving sessions", "Putnam practice", "Pi Day pie sale"],
  },

  // ─── Social & Behavioral Sciences ───────────────────────────────────────────
  {
    key: "psych", slug: "psychology-club", name: "Psychology Club", type: "AFFILIATE", scope: "COLLEGE", college: "sbs",
    department: "Psychology", focusMajor: "Psychology", status: "APPROVED", life: "active", founded: [2022, 9], size: 58, succession: "MEMBER_VOTE",
    color: "#9333ea", category: "socsci", activity: 0.9,
    meeting: M(3, 17, 0, 60, 1, "SS", "Room 238"),
    related: ["premed", "polisci", "cj"],
    short: "Research, grad school prep and mental health advocacy for psych majors and the curious.",
    about: "Psychology Club brings together students interested in how people think and behave. We connect members with faculty research labs, demystify grad school, and run mental health awareness events with the Counseling & Psychological Services Center.",
    does: ["Faculty research spotlights", "Grad school and careers panels", "Mental health awareness week", "Psi Chi collaboration"],
  },
  {
    key: "polisci", slug: "political-science-society", name: "Political Science Society", type: "REGISTERED", scope: "COLLEGE", college: "sbs",
    focusMajor: "Political Science", status: "APPROVED", life: "active", founded: [2022, 9], size: 40, color: "#b91c1c", category: "socsci", activity: 0.85,
    meeting: M(2, 12, 0, 60, 1, "SS", "Room 130", "Brown Bag Discussion"),
    related: ["psych", "cj", "modelun"],
    short: "Civil debate, debate watch parties and internships at the Utah Capitol.",
    about: "We talk politics without shouting. Members of every party and none meet for brown-bag discussions, host watch parties and help each other land legislative internships.",
    does: ["Weekly brown-bag discussions", "Debate and election-night watch parties", "Voter registration drives", "Legislative internship info sessions"],
  },
  {
    key: "cj", slug: "criminal-justice-association", name: "Criminal Justice Association", type: "AFFILIATE", scope: "COLLEGE", college: "sbs",
    department: "Criminal Justice", focusMajor: "Criminal Justice", status: "APPROVED", life: "active", founded: [2023, 1], size: 32, color: "#334155", category: "socsci", activity: 0.75,
    meeting: M(2, 17, 0, 60, 2, "SS", "Room 341"),
    related: ["polisci", "psych"],
    short: "Ride-alongs, agency panels and mock crime scenes.",
    about: "For students headed into law enforcement, corrections, law and victim advocacy. We bring in local agencies, tour facilities and practice with mock crime scenes.",
    does: ["Agency career panels", "Ride-along and tour sign-ups", "Mock crime scene nights"],
  },
  {
    key: "modelun", slug: "model-united-nations", name: "Model United Nations", type: "REGISTERED", scope: "COLLEGE", college: "sbs",
    focusMajor: "Political Science", status: "APPROVED", life: "inactive", founded: [2022, 10], size: 6, color: "#2563eb", category: "socsci", activity: 0.3,
    meeting: M(4, 16, 0, 60, 2, "SS", "Room 130"),
    related: ["polisci"],
    lastActiveTerm: "Spring 2025",
    short: "Research, resolutions and regional MUN conferences.",
    about: "Model UN members represent countries at simulated UN sessions and travel to regional conferences.",
    does: ["Position paper workshops", "Practice committee sessions", "Regional conferences"],
  },

  // ─── Moyes College of Education ─────────────────────────────────────────────
  {
    key: "educators", slug: "future-educators-association", name: "Future Educators Association", type: "AFFILIATE", scope: "COLLEGE", college: "edu",
    department: "Teacher Education", focusMajor: "Elementary Education", status: "APPROVED", life: "active", founded: [2023, 9], size: 34, color: "#16a34a", category: "education", activity: 0.75,
    meeting: M(3, 16, 30, 60, 2, "ED", "Room 210"),
    related: ["exsci", "service"],
    short: "Classroom-ready skills, Praxis prep and read-alouds in Ogden schools.",
    about: "For students becoming teachers. We swap classroom management ideas, prep for the Praxis together and volunteer for read-alouds at Ogden School District elementary schools.",
    does: ["Classroom management panels with local teachers", "Praxis study sessions", "Read-aloud volunteer days"],
  },
  {
    key: "exsci", slug: "exercise-science-club", name: "Exercise Science Club", type: "AFFILIATE", scope: "COLLEGE", college: "edu",
    department: "Kinesiology", focusMajor: "Exercise Science", status: "APPROVED", life: "active", founded: [2023, 1], size: 28, color: "#ea580c", category: "health", activity: 0.7,
    meeting: M(2, 12, 0, 60, 2, "SG", "Room 202"),
    related: ["educators", "nursing", "ultimate"],
    short: "Certifications, lab tours and training science for future trainers and PTs.",
    about: "We help Kinesiology students prep for certifications, explore careers in PT, coaching and strength training, and keep moving together.",
    does: ["NSCA and ACSM certification study groups", "Physical therapy clinic tours", "Group workouts"],
  },

  // ─── Dumke College of Health Professions ────────────────────────────────────
  {
    key: "nursing", slug: "nursing-student-association", name: "Nursing Student Association", type: "SPONSORED", scope: "COLLEGE", college: "health",
    department: "Annie Taylor Dee School of Nursing", focusMajor: "Nursing", status: "APPROVED", life: "active", founded: [2022, 9], size: 76, joinPolicy: "APPROVAL",
    color: "#0d9488", category: "health", activity: 0.9,
    meeting: M(4, 12, 0, 60, 2, "MH", "Room 101"),
    related: ["premed", "dental", "exsci"],
    short: "NCLEX prep, community health fairs and support through nursing school.",
    about: "The Nursing Student Association supports students in the Annie Taylor Dee School of Nursing from pre-nursing through the NCLEX. We volunteer at health fairs, host NCLEX reviews and celebrate every pinning class.",
    does: ["NCLEX review sessions", "Community health fairs and flu clinics", "Peer mentoring for new cohorts", "Pinning ceremony support"],
    join: "Open to pre-nursing and nursing students. An officer confirms you're in a nursing track before approving.",
  },
  {
    key: "dental", slug: "dental-hygiene-student-association", name: "Dental Hygiene Student Association", type: "AFFILIATE", scope: "COLLEGE", college: "health",
    department: "Dental Hygiene", focusMajor: "Dental Hygiene", status: "APPROVED", life: "active", founded: [2023, 9], size: 24, color: "#0284c7", category: "health", activity: 0.65,
    meeting: M(2, 12, 0, 50, 2, "MH", "Room 214"),
    related: ["nursing", "premed"],
    short: "Board prep, community smile days and continuing-ed talks.",
    about: "Dental hygiene students supporting each other through boards and clinic, and bringing free screenings to the community.",
    does: ["Board exam prep", "Community smile days", "Continuing-ed speakers"],
  },

  // ─── Lindquist College of Arts & Humanities ─────────────────────────────────
  {
    key: "theatre", slug: "theatre-guild", name: "Theatre Guild", type: "SPONSORED", scope: "COLLEGE", college: "arts",
    department: "Performing Arts", focusMajor: "Theatre Arts", status: "APPROVED", life: "active", founded: [2022, 9], size: 46, joinPolicy: "APPROVAL",
    color: "#a21caf", category: "arts", activity: 0.9,
    meeting: M(1, 19, 0, 120, 1, "BC", "Eccles Theater rehearsal hall", "Guild Night"),
    related: ["writing", "ceramics", "pride"],
    short: "Student-run productions, improv nights and backstage crews.",
    about: "Theatre Guild puts on student-directed shows each semester and runs improv nights in the Browning Center. Actors, designers, techies and stage managers all belong here.",
    does: ["A student-directed production each semester", "Improv nights", "Backstage and design crews", "Trips to the Utah Shakespeare Festival"],
    join: "Open to all. Because productions have limited crew spots, an officer approves new members after a quick chat.",
  },
  {
    key: "writing", slug: "creative-writing-club", name: "Creative Writing Club", type: "AFFILIATE", scope: "COLLEGE", college: "arts",
    department: "English Language & Literature", focusMajor: "Creative Writing", status: "APPROVED", life: "active", founded: [2023, 1], size: 27, color: "#78350f", category: "arts", activity: 0.7,
    meeting: M(4, 18, 0, 90, 2, "EH", "Room 229", "Workshop Night"),
    related: ["theatre", "anime"],
    short: "Workshops, open mics and Metaphor, Weber State's student literary journal.",
    about: "Writers of every genre workshop drafts, run open mics and help publish Metaphor, the student literary journal.",
    does: ["Peer workshop nights", "Open mic nights", "Writing sprints during finals", "Metaphor journal submissions"],
  },
  {
    key: "ceramics", slug: "ceramics-guild", name: "Ceramics Guild", type: "AFFILIATE", scope: "COLLEGE", college: "arts",
    department: "Visual Art & Design", focusMajor: "Art", status: "APPROVED", life: "inactive", founded: [2023, 1], size: 7, color: "#92400e", category: "arts", activity: 0.35,
    meeting: M(5, 14, 0, 120, 2, "KA", "Ceramics Studio 160", "Open Studio"),
    related: ["theatre", "writing"],
    lastActiveTerm: "Fall 2025",
    short: "Open studio time and the holiday pottery sale.",
    about: "Ceramics Guild shares studio time, glaze recipes and runs a holiday pottery sale to fund materials.",
    does: ["Open studio afternoons", "Holiday pottery sale"],
  },

  // ─── University-wide ────────────────────────────────────────────────────────
  {
    key: "bsu", slug: "black-student-union", name: "Black Student Union", type: "REGISTERED", scope: "UNIVERSITY", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 52, color: "#111827", category: "culture", activity: 0.9,
    meeting: M(3, 18, 0, 75, 1, "SU", "Room 404A"),
    related: ["lia", "isa", "pride", "firstgen", "service"],
    short: "Community, culture and advocacy for Black students and allies at Weber State.",
    about: "The Black Student Union is a home base for Black Wildcats and everyone who wants to support them. We celebrate culture, advocate on campus and build friendships that last past graduation.",
    does: ["Weekly community meetings", "Black History Month events", "Professional mentoring with alumni", "Partnership events with other cultural clubs"],
  },
  {
    key: "lia", slug: "latinos-in-action", name: "Latinos in Action", type: "REGISTERED", scope: "UNIVERSITY", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 64, color: "#c2410c", category: "culture", activity: 0.95,
    meeting: M(2, 18, 0, 75, 1, "SU", "Room 316"),
    related: ["bsu", "firstgen", "isa", "service"],
    short: "Leadership, culture and service for Latino students — todos son bienvenidos.",
    about: "Latinos in Action develops Latino leaders through service, culture and college success. We tutor in local schools, celebrate our heritage and help each other graduate.",
    does: ["Tutoring in Ogden schools", "Día de los Muertos and Hispanic Heritage Month events", "Scholarship workshops", "Family nights"],
  },
  {
    key: "pride", slug: "pride-alliance", name: "Pride Alliance", type: "REGISTERED", scope: "UNIVERSITY", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 48, color: "#db2777", category: "culture", activity: 0.85,
    meeting: M(4, 18, 30, 75, 1, "SU", "Room 321"),
    related: ["bsu", "theatre", "service"],
    short: "A welcoming space for LGBTQ+ Wildcats and allies.",
    about: "Pride Alliance builds community and visibility for LGBTQ+ students at Weber State. Meetings are relaxed — come for game nights, stay for the friends.",
    does: ["Weekly socials and game nights", "Coming Out Week and Pride events", "Ally trainings", "Drag bingo fundraiser"],
  },
  {
    key: "veterans", slug: "veterans-club", name: "Veterans Club", type: "REGISTERED", scope: "UNIVERSITY", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 28, color: "#3f6212", category: "service", activity: 0.7,
    meeting: M(5, 12, 0, 60, 2, "SSC", "Room 140"),
    related: ["service", "cj"],
    short: "Student veterans, service members and military families helping each other succeed.",
    about: "Weber State has one of Utah's largest student veteran communities. We help with the move from service to school, connect members with benefits and give back to Ogden.",
    does: ["GI Bill and benefits help nights", "Veterans Day ceremony", "Service projects with local veteran organizations"],
  },
  {
    key: "isa", slug: "international-student-association", name: "International Student Association", type: "REGISTERED", scope: "UNIVERSITY", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 80, color: "#0369a1", category: "culture", activity: 0.95,
    meeting: M(5, 16, 0, 90, 2, "SU", "Room 404B", "Coffee Hour"),
    related: ["bsu", "lia", "service", "anime"],
    short: "Culture nights, coffee hours and a home away from home.",
    about: "ISA connects international students with each other and with domestic Wildcats who love to travel. Our International Night is one of the biggest events on campus.",
    does: ["Biweekly coffee hours", "International Night", "Thanksgiving dinner for students far from home", "Trips around Utah"],
  },
  {
    key: "service", slug: "service-volunteer-club", name: "Service & Volunteer Club", type: "REGISTERED", scope: "UNIVERSITY", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 70, color: "#059669", category: "service", activity: 1.0, autoApproveCohosts: true,
    meeting: M(1, 18, 0, 60, 2, "SU", "Room 316", "Project Planning Night"),
    related: ["bsu", "lia", "veterans", "educators", "premed"],
    short: "Monthly service projects around Ogden — show up once or every time.",
    about: "We make volunteering easy. Every month we partner with Ogden organizations on a project, from trail cleanups to food pantry packing, and we co-host service events with any club that asks.",
    does: ["Monthly service projects", "Food pantry and care kit drives", "Co-hosted service days with other clubs"],
  },

  // ─── Independent ────────────────────────────────────────────────────────────
  {
    key: "anime", slug: "anime-club", name: "Anime Club", type: "REGISTERED", scope: "INDEPENDENT", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 68, color: "#e11d48", category: "games", activity: 0.9,
    meeting: M(5, 18, 0, 150, 1, "LI", "Room 307", "Screening Night"),
    related: ["chess", "isa", "writing"],
    short: "Friday screenings, cosplay workshops and convention trips.",
    about: "Anime Club meets Friday nights to watch, debate and snack. We also run cosplay workshops and carpool to FanX in Salt Lake.",
    does: ["Friday screening nights", "Cosplay and sketch workshops", "Convention trips"],
  },
  {
    key: "chess", slug: "chess-club", name: "Chess Club", type: "REGISTERED", scope: "INDEPENDENT", status: "APPROVED", life: "active",
    founded: [2023, 1], size: 26, color: "#404040", category: "games", activity: 0.75,
    meeting: M(2, 19, 0, 120, 1, "SU", "Room 321", "Club Night"),
    related: ["anime", "math"],
    short: "Casual games, blitz tournaments and lessons for beginners.",
    about: "All levels welcome — we'll teach you the rules. Tuesday nights are casual play with a monthly rated blitz tournament.",
    does: ["Casual play and lessons", "Monthly blitz tournaments", "Simul exhibitions"],
  },

  // ─── Sports ─────────────────────────────────────────────────────────────────
  {
    key: "climbing", slug: "wildcat-climbing-club", name: "Wildcat Climbing Club", type: "REGISTERED", scope: "SPORTS", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 56, joinPolicy: "APPROVAL", color: "#65a30d", category: "sports", activity: 1.0,
    meeting: M(4, 19, 0, 120, 1, "SC", "Climbing Wall", "Wall Night"),
    related: ["ski", "ultimate", "pickleball"],
    short: "Wall nights, outdoor trips and belay certification.",
    about: "From first-timers to crushers, we climb together on the Stromberg wall every Thursday and head into Ogden's canyons when the weather's good.",
    does: ["Thursday wall nights", "Outdoor trips in Ogden Canyon and beyond", "Belay certification clinics"],
    join: "Open to all. An officer approves new members once your Campus Rec climbing waiver is on file.",
  },
  {
    key: "ultimate", slug: "ultimate-frisbee", name: "Ultimate Frisbee", type: "REGISTERED", scope: "SPORTS", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 34, color: "#ca8a04", category: "sports", activity: 0.85,
    meeting: M(3, 17, 0, 90, 1, "ST", "Practice Field", "Practice"),
    related: ["climbing", "pickleball", "ski"],
    short: "Pickup, practice and tournaments — no experience needed.",
    about: "Weber State Ultimate plays pickup and travels to tournaments around the Mountain West. New players learn fast.",
    does: ["Practices twice a week", "Weekend tournaments", "Hat tournament fundraiser"],
  },
  {
    key: "ski", slug: "ski-snowboard-club", name: "Ski & Snowboard Club", type: "REGISTERED", scope: "SPORTS", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 84, color: "#0ea5e9", category: "sports", activity: 0.9,
    meeting: M(3, 19, 0, 60, 2, "SU", "Wildcat Theater", "Club Meeting"),
    related: ["climbing", "ultimate"],
    short: "Discount passes, carpools to Snowbasin and Powder Mountain, and the season-opener party.",
    about: "Ogden has two ski resorts in its backyard — we make sure Wildcats use them. We organize carpools, pass discounts, lessons for beginners and a ski-film premiere every fall.",
    does: ["Carpools to Snowbasin and Powder Mountain", "Beginner lesson days", "Gear swap", "Season-opener film night"],
  },

  // ─── Pilot clubs (created this term) ────────────────────────────────────────
  {
    key: "datasci", slug: "data-science-society", name: "Data Science Society", type: "AFFILIATE", scope: "COLLEGE", college: "cos",
    department: "Mathematics", focusMajor: "Data Science", status: "APPROVED", life: "pilot", size: 14, color: "#4f46e5", category: "tech", activity: 0.8,
    meeting: M(4, 17, 0, 60, 2, "TY", "Room 336"),
    related: ["ailab", "acm", "math"],
    short: "Kaggle nights, visualization workshops and real datasets from campus.",
    about: "A brand-new club for anyone who likes finding stories in data. We work through Kaggle problems together and partner with campus offices on real datasets.",
    does: ["Kaggle nights", "Visualization workshops", "Campus data projects"],
  },
  {
    key: "firstgen", slug: "first-gen-wildcats", name: "First-Gen Wildcats", type: "REGISTERED", scope: "UNIVERSITY", status: "APPROVED", life: "pilot",
    size: 12, color: "#9d174d", category: "culture", activity: 0.8,
    meeting: M(2, 12, 0, 60, 2, "SSC", "Room 260", "First-Gen Lunch"),
    related: ["lia", "bsu", "service"],
    short: "For first-generation college students — figuring it out together.",
    about: "New this year: a space for students who are the first in their family to go to college. We share what we've learned about financial aid, registration, internships and imposter syndrome.",
    does: ["Biweekly lunches", "Financial aid and registration help", "Faculty who were first-gen share their stories"],
  },
  {
    key: "pickleball", slug: "pickleball-club", name: "Pickleball Club", type: "REGISTERED", scope: "SPORTS", status: "APPROVED", life: "pilot",
    size: 15, color: "#84cc16", category: "sports", activity: 0.85,
    meeting: M(5, 15, 0, 120, 1, "SC", "Court 3", "Open Play"),
    related: ["climbing", "ultimate"],
    short: "Open play every Friday — paddles provided.",
    about: "Pickleball Club started this fall so Wildcats could stop fighting for courts. Paddles and balls are provided; just show up.",
    does: ["Friday open play", "Ladder league", "Beginner clinics"],
  },

  // ─── Founding stage ─────────────────────────────────────────────────────────
  {
    key: "beekeeping", slug: "wildcat-beekeeping-society", name: "Wildcat Beekeeping Society", type: "REGISTERED", scope: "COLLEGE", college: "cos",
    focusMajor: "Botany", status: "DRAFT", life: "draft", size: 0, color: "#eab308", category: "science", activity: 0,
    meeting: M(3, 16, 0, 60, 2, "TY", "Room 225"),
    related: [],
    short: "",
    about: "We want to keep a couple of hives on campus, learn beekeeping from local experts and",
    does: [],
  },
  {
    key: "boardgames", slug: "board-game-guild", name: "Board Game Guild", type: "REGISTERED", scope: "INDEPENDENT", status: "SUBMITTED", life: "submitted",
    size: 0, color: "#7c2d12", category: "games", activity: 0,
    meeting: M(4, 19, 0, 180, 1, "SU", "Room 321", "Game Night"),
    related: ["chess", "anime"],
    short: "Weekly game nights with a shared library of 80+ board games.",
    about: "Board Game Guild hosts relaxed weekly game nights in the Shepherd Union with a lending library of modern board games, from quick party games to four-hour strategy epics.",
    does: ["Thursday game nights", "Learn-to-play sessions", "A shared game library members can borrow from"],
  },
  {
    key: "aviation", slug: "aviation-club", name: "Aviation Club", type: "SPONSORED", scope: "COLLEGE", college: "east",
    requestedDepartmentName: "Aviation Technology", status: "CHANGES_REQUESTED", life: "changes", size: 0, color: "#0c4a6e", category: "tech", activity: 0,
    meeting: M(3, 18, 0, 60, 2, "D2", "Room 110"),
    related: ["motorsports", "robotics"],
    short: "Flight sims, airport tours and ground school study groups.",
    about: "For future pilots, mechanics and anyone who looks up when a plane goes over. We plan to run flight-sim nights, tour Ogden-Hinckley Airport and form ground-school study groups.",
    does: ["Flight simulator nights", "Airport and hangar tours", "Ground school study groups"],
  },
  {
    key: "poker", slug: "campus-poker-league", name: "Campus Poker League", type: "REGISTERED", scope: "INDEPENDENT", status: "REJECTED", life: "rejected",
    founded: [2026, 2], size: 0, color: "#991b1b", category: "games", activity: 0,
    meeting: M(5, 20, 0, 180, 1, "SU", "Room 321"),
    related: [],
    short: "Weekly Texas hold'em tournaments with buy-ins and prizes.",
    about: "A league for students who love poker, with weekly tournaments, buy-ins and a season-end prize pool.",
    does: ["Weekly tournaments", "Season leaderboard and prize pool"],
    rejectedNote: "Thanks for the work you put into this. We can't approve a club built around buy-ins and cash prizes — that's gambling under university policy and Utah law. If you'd like to run a strategy games club without money involved, we'd be glad to review a new submission.",
  },
  {
    key: "photo", slug: "photography-collective", name: "Photography Collective", type: "AFFILIATE", scope: "COLLEGE", college: "arts",
    department: "Visual Art & Design", focusMajor: "Photography", status: "RETIRED", life: "retired", founded: [2022, 9], size: 0, color: "#57534e", category: "arts", activity: 0.6,
    meeting: M(3, 17, 30, 90, 2, "KA", "Room 120", "Photo Walk Planning"),
    related: ["ceramics", "theatre"],
    retired: { at: [2025, 4, 30], reason: "Our founding officers graduated and nobody stepped up to lead. The darkroom group now meets as part of Visual Art & Design's open studio." },
    short: "Photo walks, darkroom nights and critique sessions.",
    about: "We shot film and digital around Ogden, shared darkroom time and held critique nights.",
    does: ["Photo walks", "Darkroom nights", "Critique sessions"],
  },
  {
    key: "rugby", slug: "wildcat-rugby-club", name: "Wildcat Rugby Club", type: "REGISTERED", scope: "SPORTS", status: "RETIRED", life: "retired", founded: [2022, 9],
    size: 0, color: "#7f1d1d", category: "sports", activity: 0.6,
    meeting: M(2, 17, 0, 90, 1, "ST", "Practice Field", "Practice"),
    related: ["ultimate"],
    retired: { at: [2024, 12, 20], reason: "We couldn't field a full side after losing our coach and insurance sponsor. Members joined the Ogden city rugby club instead." },
    short: "Club rugby for Wildcats.",
    about: "Club rugby team that practiced on the Stewart Stadium practice field and played regional club sides.",
    does: ["Practice twice a week", "Regional matches"],
  },
];

export const clubByKey = (key: string) => {
  const c = CLUBS.find((x) => x.key === key);
  if (!c) throw new Error(`Unknown club key ${key}`);
  return c;
};
