import type { PolicyPlacement, PolicyStatus } from "@prisma/client";

/**
 * Sample university policies. Every body opens with the same notice so nobody
 * mistakes them for Weber State's official policy text.
 */

export const SAMPLE_NOTICE = "Sample policy for user testing — replace with the official Weber State policy.";
const notice = `<p><strong>${SAMPLE_NOTICE}</strong></p>`;

export type PolicyDef = {
  slug: string;
  title: string;
  summary: string;
  placements: PolicyPlacement[];
  status: PolicyStatus;
  version: number;
  bodyHtml: string | null;
  /** Shown from an uploaded PDF instead of the editor. */
  pdf?: { name: string; blocks: { heading?: string; text?: string; bullets?: string[] }[] };
  daysAgo: number;
};

export const POLICIES: PolicyDef[] = [
  {
    slug: "review-integrity",
    title: "Review Integrity",
    summary: "Reviews must reflect your own experience. Review bombing — organizing people to post bad reviews with malicious intent — isn't allowed.",
    placements: ["REVIEWS"],
    status: "PUBLISHED",
    version: 2,
    daysAgo: 420,
    bodyHtml: `${notice}<h2>Why reviews exist</h2><p>Club reviews help students find clubs that fit them and help clubs improve. They only work if they're honest.</p><h2>Who can review</h2><ul><li>Students who have attended at least three of the club's events (the number is set by WSUSA and is the same for every club).</li><li>One review per person per club. You can edit or delete your own review at any time.</li></ul><h2>Review bombing</h2><p><strong>Review bombing</strong> means organizing or encouraging people to post negative reviews of a club with malicious intent — to damage its reputation rather than describe a real experience. It is not allowed, whether it happens on the platform, in group chats or on social media.</p><ul><li>When three or more ratings of 2★ or lower arrive within 48 hours, WSUSA staff are alerted automatically.</li><li>Administrators may hide reviews that are part of review bombing, that attack a named person, or that contain harassment.</li><li>Students who organize review bombing may be referred to the Dean of Students under the Student Code of Conduct.</li></ul><h2>Flagging a review</h2><p>If you think a review breaks this policy, use <em>Flag</em> on the review. Flags go to WSUSA administrators only.</p>`,
  },
  {
    slug: "anonymous-reporting",
    title: "Anonymous Reporting",
    summary: "Report a policy violation by a club — with your name or anonymously. Anonymous reports are seen only by university administrators handling reports.",
    placements: ["COMPLAINTS"],
    status: "PUBLISHED",
    version: 1,
    daysAgo: 400,
    bodyHtml: `${notice}<h2>What you can report</h2><p>Hazing, harassment, discrimination, misuse of club funds, safety problems at events, or any other violation of university policy connected to a club.</p><h2>Anonymous reports</h2><ul><li>If you choose to stay anonymous, <strong>no reporter identity is stored at all</strong>. You get a case code instead — keep it to check your report's status.</li><li>Anonymous reports are never shared outside the university administrators who handle reports and the proper authorities required by WSU policy and law.</li><li>Every time an administrator opens an anonymous report they must acknowledge this notice, and the access is logged.</li><li>Anonymous reports never appear in notifications, the activity log, exports or the AI assistant.</li></ul><h2>If someone is in danger</h2><p>Call 911 or Weber State University Police. This form is not monitored around the clock.</p>`,
  },
  {
    slug: "club-registration",
    title: "Club Registration & Recognition",
    summary: "How a student club becomes recognized by WSUSA: types, advisors, constitutions and the review process.",
    placements: ["CLUB_CREATION"],
    status: "PUBLISHED",
    version: 3,
    daysAgo: 380,
    bodyHtml: `${notice}<h2>Club types</h2><ul><li><strong>Sponsored</strong> — supported by an academic department, which must be named on the club profile.</li><li><strong>Affiliate</strong> — connected to a department or national organization.</li><li><strong>Registered</strong> — any group of students with a shared purpose; funded through WSUSA.</li></ul><h2>Requirements</h2><ol><li>A complete club profile.</li><li>A Weber State faculty or staff advisor who has accepted the invitation.</li><li>A constitution and bylaws, from the Constitution Builder or a custom document approved by WSUSA.</li></ol><h2>Review</h2><p>WSUSA reviews submissions within about ten business days. Reviewers may approve the club, request changes or decline it with an explanation.</p><h2>Staying active</h2><p>Clubs are considered active when they hold at least two events each semester and have at least eight registered members. New clubs have a pilot period through their first full semester.</p>`,
  },
  {
    slug: "officer-eligibility-and-training",
    title: "Officer Eligibility & Training",
    summary: "Officers, vice presidents and presidents must be enrolled students in good standing and complete officer training and the officer policy test each year.",
    placements: ["OFFICER_ROLES"],
    status: "PUBLISHED",
    version: 2,
    daysAgo: 410,
    bodyHtml: `${notice}<h2>Who can hold a role</h2><ul><li>Officers, vice presidents and presidents must be currently enrolled Weber State students.</li><li>Faculty and staff serve as advisors, not officers.</li></ul><h2>Required each academic year</h2><ol><li><strong>Club Officer Training</strong> — attend one session and check in at the door.</li><li><strong>Club Officer Policy Test</strong> — pass with 80% or higher.</li></ol><p>New officers have <strong>30 days</strong> to pass the test and <strong>45 days</strong> to attend training, counted from the later of taking the role, the club's approval or the start of the academic year.</p><h2>If a deadline passes</h2><p>Your title stays, but your officer permissions on Wildcat Clubs pause until the requirement is complete. They come back as soon as you finish.</p>`,
  },
  {
    slug: "event-safety",
    title: "Event Safety",
    summary: "Plan events with a location, an emergency plan and the right approvals — especially for travel and off-campus activities.",
    placements: ["EVENTS"],
    status: "PUBLISHED",
    version: 1,
    daysAgo: 395,
    bodyHtml: `${notice}<h2>Every event</h2><ul><li>List the event in the Events Builder with its real location, so attendees and WSUSA know where you are.</li><li>Know the nearest exits and AED, and have someone responsible for calling for help.</li><li>Use QR check-in so there's an accurate count of who attended.</li></ul><h2>Off-campus and travel</h2><ul><li>Tell your advisor before any trip and share the itinerary.</li><li>Drivers must be approved through Campus Recreation or use university fleet vehicles.</li><li>Outdoor activities (climbing, skiing, water) need signed waivers on file.</li></ul><h2>Alcohol</h2><p>Club funds may not be used for alcohol, and alcohol is not allowed at club events on campus.</p>`,
  },
  {
    slug: "funding-and-purchasing",
    title: "Funding & Purchasing",
    summary: "What WSUSA and departments fund, how to request funds before you buy, and how invoices and receipts work.",
    placements: ["FUNDING"],
    status: "PUBLISHED",
    version: 2,
    daysAgo: 390,
    bodyHtml: `${notice}<h2>Funding sources</h2><ul><li><strong>WSUSA</strong> — the default for Registered clubs.</li><li><strong>Department</strong> — the default for Sponsored and Affiliate clubs.</li><li><strong>College</strong> and <strong>University</strong> funds for specific programs.</li></ul><h2>Request before you buy</h2><ol><li>Add costs to your events in the Events Builder, or general costs in the Budget tool.</li><li>Submit a funding request from the Budget tool at least two weeks before the purchase.</li><li>After approval, WSUSA creates an invoice and processes payment in the university's financial system.</li></ol><h2>Not eligible</h2><ul><li>Alcohol, gift cards for officers, personal entertainment, and gifts to individuals.</li><li>Purchases made before the request was approved.</li></ul><p>Keep receipts and submit them within 30 days of purchase.</p>`,
  },
  {
    slug: "participant-waiver-and-release",
    title: "Participant Waiver and Release",
    summary: "Each academic year, club members accept the risks of club activities, release the university from claims, consent to emergency care and allow photos of club activities.",
    placements: ["MEMBERSHIP", "EVENTS"],
    status: "PUBLISHED",
    version: 1,
    daysAgo: 120,
    bodyHtml: `${notice}<h2>What you're agreeing to</h2><p>Club activities — social, educational, recreational and athletic, sometimes with travel — carry some risk of injury, illness or damage to property. By signing, you confirm that you understand those risks and choose to take part.</p><ul><li><strong>Release.</strong> You release the State of Utah and Weber State University, and their employees and volunteers, from claims arising from your participation.</li><li><strong>Emergency care.</strong> You consent to emergency treatment if a physician decides it's necessary.</li><li><strong>Photos.</strong> The university may use photos or video of club activities that include you, without payment.</li></ul><h2>Who can sign</h2><p>You must be 18 or older. Students under 18 need a parent or guardian to sign the guardian version; contact WSUSA.</p><h2>How long it lasts</h2><p>One academic year, for every club you belong to. You sign once, not once per club.</p>`,
  },
  {
    slug: "hazing-prohibition",
    title: "Hazing Prohibition",
    summary: "Hazing of any kind — as a condition of joining or staying in a club — is prohibited, even if the person agrees to it.",
    placements: ["MEMBERSHIP", "GENERAL"],
    status: "PUBLISHED",
    version: 1,
    daysAgo: 430,
    bodyHtml: `${notice}<h2>What hazing is</h2><p>Any action or situation that endangers, humiliates or degrades a person as a condition of joining, keeping membership in, or getting a role or privilege in a club — regardless of the person's willingness to participate.</p><h2>Examples</h2><ul><li>Forced or pressured drinking or eating</li><li>Sleep deprivation, exposure to cold, or extreme physical activity</li><li>Humiliating tasks, costumes or public stunts</li><li>Requiring new members to run errands or do chores for others</li></ul><h2>What happens</h2><p>Clubs that haze may be suspended or retired, and individuals referred under the Student Code of Conduct and Utah law. Report hazing through <em>Report a concern</em> — anonymously if you prefer.</p>`,
  },
  {
    slug: "non-discrimination",
    title: "Non-Discrimination in Clubs",
    summary: "Recognized clubs are open to all students and may not discriminate in membership or leadership.",
    placements: ["MEMBERSHIP", "CLUB_CREATION"],
    status: "PUBLISHED",
    version: 1,
    daysAgo: 430,
    bodyHtml: `${notice}<h2>Open membership</h2><p>Recognized clubs may not deny membership, leadership or participation on the basis of race, color, ethnic or national origin, religion, sex, sexual orientation, gender identity, age, disability, veteran status or any other characteristic protected by law or university policy.</p><h2>Membership gates</h2><ul><li>Clubs may require approval to join for practical reasons (shop safety training, waivers, limited space) — the reason must be stated on the club page and applied to everyone equally.</li><li>Leaders must give a reason when declining a join request.</li></ul><h2>Concerns</h2><p>If you were turned away unfairly, report it through <em>Report a concern</em>.</p>`,
  },
  {
    slug: "files-and-messaging-acceptable-use",
    title: "Files & Messaging Acceptable Use",
    summary: "Use club files and chats respectfully: no harassment, no sharing others' private information, and nothing that breaks copyright or university policy.",
    placements: ["FILES", "MESSAGING"],
    status: "PUBLISHED",
    version: 1,
    daysAgo: 300,
    bodyHtml: `${notice}<h2>Messaging</h2><ul><li>Be respectful. Harassment, threats and slurs are not tolerated in club chats or direct messages.</li><li>Don't share someone else's private information or screenshots of private conversations without permission.</li><li>Leaders may remove messages that break this policy; serious cases go to WSUSA.</li></ul><h2>Files</h2><ul><li>Upload only files the club has the right to share.</li><li>Keep officer-only files (finances, member contact lists) in folders limited to leaders.</li><li>Club files belong to the club, not individual officers — leave them in place when you hand off a role.</li></ul>`,
  },
  {
    slug: "travel-and-off-campus-activities",
    title: "Travel & Off-Campus Activities",
    summary: "DRAFT — rules for overnight trips, mileage and university vehicles.",
    placements: ["EVENTS"],
    status: "DRAFT",
    version: 1,
    daysAgo: 6,
    bodyHtml: `${notice}<h2>Draft</h2><p>WSUSA is drafting a travel policy covering overnight trips, mileage reimbursement and university vehicles. This draft isn't published yet.</p><ul><li>Itineraries submitted 14 days before departure</li><li>Advisor or approved chaperone on overnight trips</li></ul>`,
  },
  {
    slug: "student-code-of-conduct-summary",
    title: "Student Code of Conduct (Summary)",
    summary: "A one-page summary of the Student Code of Conduct as it applies to clubs. The full code is maintained by the Dean of Students.",
    placements: ["GENERAL"],
    status: "PUBLISHED",
    version: 1,
    daysAgo: 360,
    bodyHtml: null,
    pdf: {
      name: "Student Code of Conduct - summary (sample).pdf",
      blocks: [
        { text: SAMPLE_NOTICE },
        { heading: "Purpose", text: "The Student Code of Conduct describes the standards of behavior expected of Weber State students and the process the Dean of Students follows when they aren't met. Clubs and their members are expected to follow it at every club activity, on or off campus." },
        { heading: "Conduct that applies to clubs", bullets: ["Hazing, harassment and discrimination", "Misuse of university or club funds", "Alcohol and drugs at club events", "Endangering the health or safety of others", "Retaliation against someone who reports a concern"] },
        { heading: "Process", text: "Reports are reviewed by the Dean of Students. Clubs may face educational sanctions, probation, suspension or loss of recognition; individuals may face sanctions under the Code." },
        { heading: "Questions", text: "Contact WSUSA Clubs & Organizations in the Shepherd Union." },
      ],
    },
  },
];
