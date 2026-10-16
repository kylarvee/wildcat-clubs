import type { ClubType, JoinPolicy, SuccessionMethod } from "@prisma/client";

/**
 * The default Constitution and Bylaws for Weber State clubs, written to match
 * how Wildcat Clubs actually runs a club (org chart, attendance tool, funding
 * tool, secret ballots, constitution builder). Pure data + text functions so
 * the builder's live preview (client), the PDF renderer and the domain layer
 * all produce the exact same words.
 *
 * CORE sections are always included; MODULAR sections are opt-in. Field values
 * are shared across both documents (the constitution's Elections article reads
 * the bylaws' succession choice), keyed by field id.
 */

export type DocKind = "constitution" | "bylaws";

export type ChoiceOption = { value: string; label: string; description?: string };

export type FieldDef = {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "choice";
  default: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  options?: ChoiceOption[];
  min?: number;
  max?: number;
};

export type Block = { type: "p"; text: string } | { type: "list"; items: string[] };

/** What the documents need to know about the club they're adopted for. */
export type ClubFacts = {
  name: string | null;
  type: ClubType | null;
  departmentName: string | null;
  collegeName: string | null;
};

export type RenderContext = {
  /** A field's value, or a ⟦placeholder⟧ when it's required and empty. */
  v: (id: string) => string;
  /** A field's raw (possibly empty) value. */
  raw: (id: string) => string;
  /** One non-empty line per item from a textarea field. */
  lines: (id: string) => string[];
  has: (sectionId: string) => boolean;
  facts: ClubFacts;
  clubName: string;
};

type BodyItem = Block | string | null | false | undefined;

export type SectionDef = {
  id: string;
  title: string;
  core: boolean;
  /** One line shown in the builder under the section title. */
  summary: string;
  fields: FieldDef[];
  /** Selected by default when a new draft starts (modular sections only). */
  defaultOn?: boolean;
  body: (c: RenderContext) => BodyItem[];
};

/** Wraps a missing value so previews can highlight it and PDFs can bracket it. */
export const MISSING_OPEN = "⟦";
export const MISSING_CLOSE = "⟧";
export const missing = (label: string) => `${MISSING_OPEN}${label}${MISSING_CLOSE}`;

const list = (items: string[]): Block | null => (items.length ? { type: "list", items } : null);

/**
 * Lets a fill-in finish a sentence: "To bring together…." → "bring together…".
 * Lowercases a leading capital only when it looks like sentence case (so
 * "Weber State students…" and "WSUSA funding" keep their capitals).
 */
function clause(text: string) {
  const t = text.trim().replace(/[.\s]+$/, "").replace(/^to\s+/i, "");
  const [first = "", second = ""] = t.split(/\s+/);
  const sentenceCase = /^[A-Z][a-z'’-]*$/.test(first) && !/^[A-Z]/.test(second);
  return sentenceCase ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

/** "Computer Science" → "the Computer Science department"; "Department of Physics" → "the Department of Physics". */
function departmentPhrase(name: string) {
  const n = name.trim().replace(/^the /i, "");
  return /^(department|school|division|program|office)\b/i.test(n) || /\b(department|school|program)$/i.test(n) ? `the ${n}` : `the ${n} department`;
}

const TYPE_LABEL: Record<ClubType, string> = {
  SPONSORED: "Sponsored",
  AFFILIATE: "Affiliate",
  REGISTERED: "Registered",
  COLLEGE_AMBASSADORS: "College Ambassadors",
};

// ─── Shared choice lists ─────────────────────────────────────────────────────

export const SUCCESSION_OPTIONS: (ChoiceOption & { value: SuccessionMethod })[] = [
  { value: "SENIORITY", label: "Seniority (default)", description: "The President names their successor and hands off the role in the org chart." },
  { value: "MEMBER_VOTE", label: "Member vote", description: "Active members elect the President and Vice President by secret ballot in Wildcat Clubs." },
  { value: "LEADERSHIP_VOTE", label: "Leadership vote", description: "Current leaders vote for the next leaders — never for themselves." },
];

export const JOIN_OPTIONS: (ChoiceOption & { value: JoinPolicy })[] = [
  { value: "OPEN", label: "Open membership", description: "Students become members as soon as they register or check in at an event." },
  { value: "APPROVAL", label: "Leader approval", description: "Join requests wait until a leader with the Members permission approves them." },
];

const MEMBER_VOTE_OPTIONS: ChoiceOption[] = [
  { value: "TWO_THIRDS_MEMBERS", label: "Two-thirds of active members voting" },
  { value: "MAJORITY_MEMBERS", label: "A majority of active members voting" },
  { value: "TWO_THIRDS_LEADERS", label: "Two-thirds of the leaders" },
];

const optionLabel = (options: ChoiceOption[], value: string) => (options.find((o) => o.value === value)?.label ?? value).replace(/ \(default\)$/, "");
const voteText = (value: string) => optionLabel(MEMBER_VOTE_OPTIONS, value).replace(/^A /, "a ").replace(/^Two/, "two");

export function successionLabel(method: string) {
  return optionLabel(SUCCESSION_OPTIONS, method);
}

// ─── Constitution ────────────────────────────────────────────────────────────

const CONSTITUTION: SectionDef[] = [
  {
    id: "name",
    title: "Name",
    core: true,
    summary: "Your club's official name (taken from its Wildcat Clubs profile) and any short name.",
    fields: [{ id: "abbreviation", label: "Short name or abbreviation (optional)", type: "text", default: "", placeholder: "e.g. WSU ACM" }],
    body: (c) => [
      `The name of this organization is ${c.clubName}${c.raw("abbreviation") ? `, also known as ${c.raw("abbreviation")}` : ""} (the “Club”).`,
      "The Club is a student organization at Weber State University (“WSU”) in Ogden, Utah. Its official roster, leadership and records are kept in Wildcat Clubs, WSU's club platform.",
    ],
  },
  {
    id: "purpose",
    title: "Purpose",
    core: true,
    summary: "Why the club exists and what it sets out to do.",
    fields: [
      {
        id: "purpose",
        label: "The club exists to…",
        type: "textarea",
        required: true,
        default: "bring together Weber State students who share this interest, help members learn and grow through regular meetings, events and projects, and give back to the WSU and Ogden communities",
        hint: "Finish the sentence. Keep it to one or two sentences.",
      },
      { id: "goals", label: "Specific goals (optional, one per line)", type: "textarea", default: "", placeholder: "Host a workshop each month\nCompete in the regional conference" },
    ],
    body: (c) => [
      `The Club exists to ${c.raw("purpose") ? clause(c.raw("purpose")) : c.v("purpose")}.`,
      c.lines("goals").length ? "In support of this purpose, the Club will:" : null,
      list(c.lines("goals")),
      "The Club's activities support WSU's educational mission and are open to the campus community as described in this Constitution.",
    ],
  },
  {
    id: "recognition",
    title: "Recognition & Affiliation",
    core: true,
    summary: "How WSUSA recognizes the club, its type, and its commitment to WSU policy.",
    fields: [
      {
        id: "affiliateOrg",
        label: "Outside or national organization (optional)",
        type: "text",
        default: "",
        hint: "Affiliate clubs: the national chapter or outside organization you're connected to, if any.",
      },
    ],
    body: (c) => {
      const t = c.facts.type;
      const dept = c.facts.departmentName;
      const typeLine = `The Club is recognized by the Weber State University Student Association (“WSUSA”) as ${t ? `${t === "AFFILIATE" ? "an" : "a"} ${TYPE_LABEL[t]}` : `a ${missing("club type")}`} club.`;
      let detail: string | null = null;
      if (t === "SPONSORED") {
        detail = `The Club is sponsored by ${dept ? departmentPhrase(dept) : missing("sponsoring department")}${c.facts.collegeName ? ` in the ${c.facts.collegeName.replace(/^the /i, "")}` : ""}. The department supports the Club's academic purpose, and the Club's advisor normally comes from the department.`;
      } else if (t === "AFFILIATE") {
        const partners = [dept ? departmentPhrase(dept) : null, c.raw("affiliateOrg")].filter(Boolean).join(" and ");
        detail = `The Club is affiliated with ${partners || missing("department or outside organization")}. Where a partner organization's rules differ from WSU or WSUSA policy, WSU and WSUSA policy controls.`;
      } else if (t === "REGISTERED") {
        detail = "The Club is an independent student club registered with WSUSA. It is not sponsored by an academic department.";
      }
      return [
        typeLine,
        detail,
        "The Club follows WSU policy, the WSU Student Code, WSUSA club rules, and all applicable state and federal law. Recognition gives the Club access to WSU facilities, funding and services; it does not make the Club an agent of WSU, and the Club may not speak for WSU or sign contracts on its behalf.",
        "The Club keeps its recognition current by keeping its profile, leaders, advisor, Constitution and Bylaws up to date in Wildcat Clubs and by staying active as WSUSA defines it.",
      ];
    },
  },
  {
    id: "membership",
    title: "Membership",
    core: true,
    summary: "Who can join, non-discrimination, and whether leaders approve join requests.",
    fields: [
      { id: "joinPolicy", label: "How students join", type: "choice", required: true, default: "OPEN", options: JOIN_OPTIONS, hint: "Wildcat Clubs applies this to your club's Register button when you adopt the documents." },
      { id: "membershipNotes", label: "Anything else about membership (optional)", type: "textarea", default: "" },
    ],
    body: (c) => [
      "Membership is open to all currently enrolled WSU students. The Club does not discriminate on the basis of race, color, ethnicity, national origin, religion, sex, sexual orientation, gender identity, age, disability, veteran status, genetic information, or any other status protected by law or WSU policy.",
      c.raw("joinPolicy") === "APPROVAL"
        ? "A student asks to join by registering for the Club in Wildcat Clubs or by checking in at a Club event. Leaders with the Members permission review each request in Wildcat Clubs and approve it unless there is a fair, stated reason not to. No request is ever denied on a basis listed above."
        : "A student becomes a member by registering for the Club in Wildcat Clubs or by checking in at a Club event. Membership takes effect right away.",
      "Faculty, staff, alumni and community members are welcome at Club events as guests. Only enrolled students may be members, vote, or hold student leadership roles.",
      "A member may leave the Club at any time in Wildcat Clubs. Members who graduate become alumni, and their history with the Club is kept.",
      c.raw("membershipNotes") || null,
    ],
  },
  {
    id: "dues",
    title: "Dues",
    core: false,
    summary: "Charge membership dues, with an optional hardship waiver.",
    fields: [
      { id: "duesAmount", label: "Dues", type: "text", required: true, default: "$10 per semester" },
      {
        id: "duesWaiver",
        label: "Hardship waivers",
        type: "choice",
        default: "YES",
        options: [
          { value: "YES", label: "Offer confidential waivers" },
          { value: "NO", label: "No waivers" },
        ],
      },
    ],
    body: (c) => [
      `The Club charges dues of ${c.v("duesAmount")}. The Treasurer records dues payments, and dues are used only for Club purposes.`,
      c.raw("duesWaiver") !== "NO" ? "A member who can't afford dues may ask the President or Treasurer for a waiver, which is granted confidentially." : null,
      "Paying dues is never required to attend a Club event paid for with WSUSA or department funds.",
    ],
  },
  {
    id: "honorary",
    title: "Honorary & Alumni Members",
    core: false,
    summary: "Recognize alumni and honorary (non-student) members.",
    fields: [],
    body: () => [
      "Members who graduate become alumni members. Alumni are welcome at Club events and keep their Club history, but they do not vote or hold student leadership roles.",
      "The leaders may name honorary members — faculty, staff, alumni or community members who have contributed to the Club — by majority vote of the leaders. Honorary members do not vote or hold leadership roles.",
    ],
  },
  {
    id: "leadership",
    title: "Leadership Structure",
    core: true,
    summary: "President (or co-presidents), Vice President, officers and the College Ambassador seat.",
    fields: [
      {
        id: "coPresidents",
        label: "Presidency",
        type: "choice",
        default: "YES",
        options: [
          { value: "YES", label: "Allow co-presidents" },
          { value: "NO", label: "One President" },
        ],
      },
      {
        id: "officers",
        label: "Officer seats (one per line)",
        type: "textarea",
        default: "Secretary\nTreasurer\nEvents Coordinator\nCommunications Officer\nMembership Officer",
        hint: "Start with the seats in your org chart. You can add or rename seats in the org chart later without amending.",
      },
      {
        id: "ambassadorSeat",
        label: "College Ambassador seat",
        type: "choice",
        default: "YES",
        options: [
          { value: "YES", label: "Include a College Ambassador seat" },
          { value: "NO", label: "No ambassador seat" },
        ],
      },
    ],
    body: (c) => [
      `The Club is led by ${c.raw("coPresidents") === "NO" ? "a President" : "a President (or two Co-Presidents)"}, a Vice President${c.lines("officers").length ? ", and the following officers" : ", and any officers named in the org chart"}. Together they are the Club's “leaders.”`,
      list(c.lines("officers")),
      "The President leads the Club, chairs its meetings, and is the primary contact for the advisor and WSUSA. The Vice President supports the President, coordinates the officers, and leads the Club when the President is unavailable.",
      "Each leadership seat, its responsibilities, and the Wildcat Clubs permissions it carries are recorded in the Club's org chart in Wildcat Clubs. The org chart is the official record of who holds each role. Leaders keep it current, and the Club may add, rename or remove officer seats there without amending this Constitution.",
      c.raw("ambassadorSeat") !== "NO"
        ? "The Club includes a College Ambassador seat. The College Ambassador is placed by the College Ambassadors organization of the Club's college, carries news and needs between the Club and the college, and holds only the permissions the Club grants."
        : null,
      "Every role a person holds is kept permanently in the Club's role history.",
    ],
  },
  {
    id: "committees",
    title: "Committees",
    core: false,
    summary: "Standing or temporary committees for club work.",
    fields: [{ id: "committeeList", label: "Standing committees (optional, one per line)", type: "textarea", default: "", placeholder: "Outreach Committee\nCompetition Committee" }],
    body: (c) => [
      "The President may create committees to carry out Club work and appoints each committee's chair.",
      c.lines("committeeList").length ? "The Club's standing committees are:" : null,
      list(c.lines("committeeList")),
      "Committees report to the leaders. A committee may not spend Club funds or speak for the Club without the leaders' approval.",
    ],
  },
  {
    id: "advisor",
    title: "Advisor",
    core: true,
    summary: "The club's WSU faculty or staff advisor and how the club works with them.",
    fields: [
      { id: "advisorMeetings", label: "Leaders meet with the advisor…", type: "text", required: true, default: "at least once each semester" },
      { id: "advisorReplaceDays", label: "Days to find a new advisor if one leaves", type: "number", required: true, default: "30", min: 1, max: 180 },
    ],
    body: (c) => [
      "The Club has at least one advisor who is a WSU faculty or staff member. Advisors are invited by name and @weber.edu email through Wildcat Clubs and become advisors when they accept.",
      "The advisor guides the Club's leaders, helps the Club follow WSU policy, reviews budgets and funding requests, and has full access to the Club's tools in Wildcat Clubs. Advisors do not vote in Club elections.",
      `The leaders meet with the advisor ${clause(c.v("advisorMeetings"))}.`,
      `If the Club loses its advisor, the leaders invite a new one within ${c.v("advisorReplaceDays")} days.`,
    ],
  },
  {
    id: "meetings",
    title: "Meetings & Attendance",
    core: true,
    summary: "How often the club meets, how attendance is recorded, and what makes a member active.",
    fields: [{ id: "meetingFrequency", label: "General meetings are held…", type: "text", required: true, default: "at least twice a month during fall and spring semesters" }],
    body: (c) => [
      `The Club holds general meetings ${clause(c.v("meetingFrequency"))}. Meetings and other events are scheduled in the Wildcat Clubs Events Builder and appear on the Club's calendar, which anyone at WSU may subscribe to.`,
      "Attendance at Club events is recorded through the Wildcat Clubs attendance tool: by scanning the event's QR code, checking in in the app, or being added by a leader with the Attendance permission. These are the Club's official attendance records.",
      "Whether a member is “active,” and whether the Club is active, is determined by the activity standards WSUSA sets in Wildcat Clubs, calculated from these attendance records. Rights this Constitution or the Bylaws reserve for active members use that definition.",
    ],
  },
  {
    id: "quorum",
    title: "Meeting Quorum",
    core: false,
    summary: "How many members must be present to conduct business at a meeting.",
    fields: [{ id: "meetingQuorum", label: "Quorum for business at a general meeting", type: "text", required: true, default: "one-third of active members" }],
    body: (c) => [
      `Business decided at a general meeting requires a quorum of ${c.v("meetingQuorum")}. Votes held in Wildcat Clubs follow the quorum rules in the Bylaws instead.`,
    ],
  },
  {
    id: "finances",
    title: "Finances",
    core: true,
    summary: "Funding sources, budgets and funding requests through the platform, and who approves spending.",
    fields: [
      {
        id: "fundingSources",
        label: "Where the club's money comes from",
        type: "textarea",
        required: true,
        default: "WSUSA club funding, department or college support, fundraising, sponsorships, and dues (if the Club charges them)",
      },
      {
        id: "spendingApproval",
        label: "Who approves spending",
        type: "choice",
        default: "PRES_TREAS",
        options: [
          { value: "PRES_TREAS", label: "The President and the Treasurer" },
          { value: "LEADERS", label: "A majority of the leaders" },
          { value: "PRES_ADVISOR", label: "The President and the advisor" },
        ],
      },
    ],
    body: (c) => [
      `The Club's funding may come from ${clause(c.v("fundingSources"))}.`,
      "The Club plans its budget and requests funding only through the Wildcat Clubs Funding & Budgeting tool; costs for a specific event are entered with that event in the Events Builder. Approved funds are spent according to WSU and WSUSA purchasing rules.",
      `Spending must be approved by ${{ PRES_TREAS: "the President and the Treasurer", LEADERS: "a majority of the leaders", PRES_ADVISOR: "the President and the advisor" }[c.raw("spendingApproval") as "PRES_TREAS"] ?? "the President and the Treasurer"} and must serve the Club's purpose. No member may profit personally from Club funds.`,
      "The Treasurer (or the President, if there is no Treasurer) keeps receipts and financial records in the Club's files and reports the Club's finances to the members and the advisor at least once each semester.",
    ],
  },
  {
    id: "sponsorships",
    title: "Sponsorships & Partnerships",
    core: false,
    summary: "Working with businesses and outside organizations.",
    fields: [],
    body: () => [
      "The Club may partner with businesses, nonprofits and other organizations whose values fit the Club's purpose. Each sponsorship or partnership needs the approval of the President and the advisor.",
      "Sponsorships follow WSU rules on gifts, contracts and the use of WSU's name and marks. The Club may not sign a contract on WSU's behalf. Written agreements are kept in the Club's files.",
    ],
  },
  {
    id: "travel",
    title: "Travel",
    core: false,
    summary: "Conferences, competitions and other club trips.",
    fields: [],
    body: () => [
      "Club travel follows WSU travel and risk-management policies. Trips are planned with the advisor and registered with WSU as its policies require before the Club commits funds.",
      "Every traveler completes the forms WSU requires. A leader is responsible for each trip, keeps a list of travelers and emergency contacts, and stays in touch with the advisor while traveling.",
      "Travel paid for with WSUSA or department funds follows the rules of that funding source.",
    ],
  },
  {
    id: "cohosted",
    title: "Co-hosted & Inter-club Events",
    core: false,
    summary: "Planning events with other WSU clubs.",
    fields: [],
    body: () => [
      "The Club may co-host events with other WSU clubs through the Wildcat Clubs Events Builder. A co-host request appears on the other club's calendar only after one of its leaders or its advisor approves it, unless that club has chosen to approve co-host requests automatically.",
      "Co-hosts share responsibility for the event, agree on costs before requesting funds, and record attendance through Wildcat Clubs so the event counts for every participating club.",
    ],
  },
  {
    id: "officerRequirements",
    title: "Officer Requirements",
    core: true,
    summary: "Eligibility for leaders and the university trainings and tests tied to their roles.",
    fields: [{ id: "minGpa", label: "Minimum cumulative GPA for leaders", type: "text", required: true, default: "2.0" }],
    body: (c) => [
      `Leaders must be currently enrolled WSU students in good academic and conduct standing, with a cumulative GPA of at least ${c.v("minGpa")} (or any higher minimum WSUSA sets).`,
      "Officers, Vice Presidents and Presidents complete the trainings and tests WSU and WSUSA assign to their roles in Wildcat Clubs within the time allowed. If a requirement becomes overdue, the leader keeps their title, but their Wildcat Clubs permissions pause until it is complete.",
    ],
  },
  {
    id: "elections",
    title: "Elections & Succession",
    core: true,
    summary: "Leaders are chosen by the succession method in the Bylaws.",
    fields: [],
    body: (c) => [
      `Leaders are chosen by the succession method set in the Bylaws (currently: ${successionLabel(c.raw("successionMethod") || "SENIORITY").toLowerCase()}).`,
      "Results take effect when they are recorded in the Club's org chart in Wildcat Clubs. Outgoing leaders hand off their responsibilities, files and accounts before leaving office.",
      "The Bylaws set terms of office, how vacancies are filled, and how votes are held.",
    ],
  },
  {
    id: "removalOfOfficers",
    title: "Removal of Officers",
    core: false,
    summary: "Grounds for removing a leader (the procedure is in the Bylaws).",
    fields: [],
    body: () => [
      "A leader may be removed for neglecting their duties, violating this Constitution, the Bylaws or WSU policy, or misusing Club funds or accounts. Removal follows the procedure in the Bylaws, and the leader always has a chance to respond before any vote.",
      "The advisor or WSUSA may also remove a leader who seriously violates WSU policy.",
    ],
  },
  {
    id: "conduct",
    title: "Code of Conduct",
    core: false,
    defaultOn: true,
    summary: "Expectations for how members treat each other.",
    fields: [],
    body: () => [
      "Members follow the WSU Student Code and treat everyone at Club activities with respect. Harassment, discrimination and hazing in any form are prohibited, as WSU policy and Utah law require.",
      "Alcohol, drugs and other regulated activities at Club events follow WSU policy.",
      "Leaders address conduct concerns promptly and fairly — usually with a conversation first, and for serious or repeated problems, removal from the Club. Anyone may report a concern to WSUSA or through the Wildcat Clubs report form, anonymously if they choose.",
    ],
  },
  {
    id: "conflictOfInterest",
    title: "Conflict of Interest",
    core: false,
    summary: "Disclosing and stepping back from personal interests.",
    fields: [],
    body: () => [
      "A leader with a personal or financial interest in a Club decision discloses it to the other leaders and does not vote on that decision.",
      "The Club does not buy from or contract with a business owned by a leader or their family without the advisor's written approval. Leaders do not accept gifts that could influence a Club decision.",
    ],
  },
  {
    id: "media",
    title: "Media & Branding",
    core: false,
    summary: "The club's name, logo, social accounts and photos.",
    fields: [],
    body: () => [
      "The Club's name and logo represent the Club and may be used only for Club business. Use of WSU's name, logos and marks follows WSU brand guidelines.",
      "Social media accounts and the Club's Google account belong to the Club, not to individuals. Leaders keep login details in a safe, shared place and hand them to their successors.",
      "The Club asks before posting photos where people can be identified and removes a photo when someone in it asks.",
    ],
  },
  {
    id: "records",
    title: "Records",
    core: true,
    summary: "Club files, role history and document versions are kept on the platform.",
    fields: [],
    body: () => [
      "The Club keeps its documents, minutes, financial records and media in its Wildcat Clubs files (mirrored to the Club's Google Drive when WSU turns that on). Files belong to the Club, not to individual members.",
      "The Club's role history — every role anyone has held, and when — is kept permanently in Wildcat Clubs and is never deleted. Past versions of this Constitution and the Bylaws are kept as well.",
      "Outgoing leaders move any Club documents into the Club's files and transfer Club accounts and passwords to their successors before leaving office.",
    ],
  },
  {
    id: "amendments",
    title: "Amendments",
    core: true,
    summary: "How the Constitution and Bylaws change, and when WSUSA approval is needed.",
    fields: [
      { id: "amendmentVote", label: "Amendments pass with…", type: "choice", default: "TWO_THIRDS_MEMBERS", options: MEMBER_VOTE_OPTIONS },
      { id: "noticeDays", label: "Days of notice before an amendment vote", type: "number", required: true, default: "7", min: 1, max: 60 },
    ],
    body: (c) => [
      `Any member may propose an amendment. Proposed amendments are shared with the members at least ${c.v("noticeDays")} days before the vote and pass when approved by ${voteText(c.raw("amendmentVote") || "TWO_THIRDS_MEMBERS")}. The Bylaws are amended the same way.`,
      "Amendments are made in the Wildcat Clubs Constitution Builder and take effect when the new version is adopted for the Club. A constitution or bylaws not made with the builder (a custom document) takes effect only after WSUSA approves it.",
      "WSUSA may require changes needed to comply with WSU policy.",
    ],
  },
  {
    id: "dissolution",
    title: "Retirement & Dissolution",
    core: true,
    summary: "How the club retires, what happens to its records and remaining funds.",
    fields: [
      {
        id: "dissolutionVote",
        label: "Retiring the club requires…",
        type: "choice",
        default: "TWO_THIRDS_MEMBERS",
        options: [
          { value: "TWO_THIRDS_MEMBERS", label: "Two-thirds of active members voting" },
          { value: "LEADERS_ADVISOR", label: "The leaders, with the advisor's agreement" },
        ],
      },
      { id: "remainingFunds", label: "Remaining funds are…", type: "text", required: true, default: "returned to the source they came from (WSUSA, the college or the department)" },
    ],
    body: (c) => [
      `The Club may be retired by ${c.raw("dissolutionVote") === "LEADERS_ADVISOR" ? "a decision of the leaders with the advisor's agreement" : "a vote of two-thirds of active members voting"}. The President or the advisor then retires the Club in Wildcat Clubs. WSUSA may also retire a club that is inactive or out of compliance with WSU policy.`,
      "When the Club retires, all leadership roles end, members become alumni, and future events are cancelled. The Club's records, files and role history are kept, and WSUSA may later reinstate the Club.",
      `Any remaining funds are ${clause(c.v("remainingFunds"))}. Club property is returned to WSU or donated as WSUSA directs.`,
    ],
  },
];

// ─── Bylaws ──────────────────────────────────────────────────────────────────

const SUCCESSION_TEXT: Record<SuccessionMethod, string[]> = {
  SENIORITY: [
    "The Club uses seniority succession. Before leaving office, the President names a successor — normally the Vice President or another experienced leader who is an active member — and hands off the role in the Club's org chart in Wildcat Clubs. The handoff takes effect when it is saved, and the outgoing President becomes a member or alumni.",
    "The President appoints the Vice President and officers in the org chart; the Vice President may appoint officers. Where the Constitution allows co-presidents, the President may also name a Co-President.",
    "If the President leaves without naming a successor, the Vice President becomes President. If there is no Vice President, the advisor appoints an interim President until the leaders name a permanent one.",
  ],
  MEMBER_VOTE: [
    "The Club uses member-vote succession. Active members elect the President and Vice President by secret ballot in the Wildcat Clubs elections tool.",
    "Any active member may be nominated, including by themselves, if they meet the leader requirements in the Constitution.",
    "The candidate with the most votes wins, subject to Voting Procedures. The result is applied in the Club's org chart in Wildcat Clubs. The newly elected President appoints officers unless the Club also holds elections for those seats.",
  ],
  LEADERSHIP_VOTE: [
    "The Club uses leadership-vote succession. The current leaders (President, Vice President and officers) elect the next President and Vice President by secret ballot in the Wildcat Clubs elections tool.",
    "Any active member may be nominated. Leaders never vote for themselves: a leader who is a candidate for a seat does not vote in that seat's election.",
    "The candidate with the most votes wins, subject to Voting Procedures, and the result is applied in the Club's org chart in Wildcat Clubs.",
  ],
};

const BYLAWS: SectionDef[] = [
  {
    id: "officerDuties",
    title: "Officer Duties",
    core: true,
    summary: "Duties come from each seat's responsibilities in the org chart.",
    fields: [{ id: "extraDuties", label: "Additional duties (optional, one per line)", type: "textarea", default: "" }],
    body: (c) => [
      "The duties of each leadership seat are the responsibilities listed for that seat in the Club's org chart in Wildcat Clubs. Leaders keep those responsibilities current; a change in the org chart updates these Bylaws without a separate vote.",
      "In addition, the President calls and chairs meetings, represents the Club to WSUSA and the advisor, and approves major plans. The Vice President assists the President and coordinates the officers. Each officer carries out their seat's duties using the Wildcat Clubs permissions granted to that seat.",
      c.lines("extraDuties").length ? "Leaders also:" : null,
      list(c.lines("extraDuties")),
    ],
  },
  {
    id: "succession",
    title: "Succession Method",
    core: true,
    summary: "How the club chooses its next leaders. Wildcat Clubs follows this choice.",
    fields: [
      {
        id: "successionMethod",
        label: "Succession method",
        type: "choice",
        required: true,
        default: "SENIORITY",
        options: SUCCESSION_OPTIONS,
        hint: "Wildcat Clubs applies this to your club when you adopt the documents.",
      },
    ],
    body: (c) => SUCCESSION_TEXT[(c.raw("successionMethod") as SuccessionMethod) in SUCCESSION_TEXT ? (c.raw("successionMethod") as SuccessionMethod) : "SENIORITY"],
  },
  {
    id: "terms",
    title: "Terms of Office",
    core: true,
    summary: "How long leaders serve and when new leaders take office.",
    fields: [
      {
        id: "termLength",
        label: "Leaders serve…",
        type: "choice",
        default: "ACADEMIC_YEAR",
        options: [
          { value: "ACADEMIC_YEAR", label: "One academic year" },
          { value: "SEMESTER", label: "One semester" },
          { value: "UNTIL_SUCCEEDED", label: "Until they step down or are succeeded" },
        ],
      },
      { id: "transitionMonth", label: "New leaders take office in (month)", type: "text", default: "April", hint: "Used for one-year and one-semester terms." },
    ],
    body: (c) => {
      const len = c.raw("termLength") || "ACADEMIC_YEAR";
      const month = c.raw("transitionMonth");
      return [
        len === "UNTIL_SUCCEEDED"
          ? "Leaders serve until they step down, graduate, or are succeeded under these Bylaws."
          : len === "SEMESTER"
            ? "Leaders serve one semester. New leaders take office at the start of each fall and spring semester, after a short transition with the outgoing leaders."
            : `Leaders serve one academic year. New leaders take office in ${month || "April"}, after a transition period with the outgoing leaders.`,
        "A leader may serve more than one term. A leader who graduates or stops being an enrolled student leaves office, and their role ends in Wildcat Clubs with the reason recorded.",
      ];
    },
  },
  {
    id: "vacancies",
    title: "Vacancies",
    core: true,
    summary: "Filling a seat when a leader leaves early.",
    fields: [{ id: "vacancyDays", label: "Days to fill an officer vacancy", type: "number", required: true, default: "14", min: 1, max: 90 }],
    body: (c) => [
      "If the President's seat is vacant, the Vice President serves as acting President until it is filled under Succession Method.",
      `If another seat is vacant, the President appoints a replacement in the org chart within ${c.v("vacancyDays")} days${c.raw("successionMethod") && c.raw("successionMethod") !== "SENIORITY" ? ", who serves until the next election" : ""}.`,
      "If both the President's and the Vice President's seats are vacant, the advisor appoints an interim President and lets WSUSA know.",
    ],
  },
  {
    id: "removal",
    title: "Removal",
    core: true,
    summary: "The fair process for removing a leader.",
    fields: [
      {
        id: "removalVote",
        label: "Removing a leader requires…",
        type: "choice",
        default: "TWO_THIRDS_LEADERS",
        options: [
          { value: "TWO_THIRDS_LEADERS", label: "Two-thirds of the other leaders" },
          { value: "TWO_THIRDS_MEMBERS", label: "Two-thirds of active members voting" },
          { value: "ADVISOR_LEADERS", label: "The advisor and a majority of the other leaders" },
        ],
      },
    ],
    body: (c) => [
      "A leader may be removed for neglecting their duties, violating the Constitution, these Bylaws or WSU policy, or misusing Club funds or accounts.",
      "Any member may raise a concern with the President or the advisor (or, if the concern is about the President, with the Vice President and the advisor). The leader receives the concern in writing and has at least seven days to respond before any vote.",
      `Removal requires ${{ TWO_THIRDS_LEADERS: "a vote of two-thirds of the other leaders", TWO_THIRDS_MEMBERS: "a vote of two-thirds of active members voting", ADVISOR_LEADERS: "the agreement of the advisor and a majority of the other leaders" }[c.raw("removalVote") as "TWO_THIRDS_LEADERS"] ?? "a vote of two-thirds of the other leaders"}, held by secret ballot in Wildcat Clubs where a vote is needed. The person being removed does not vote. Removal takes effect when it is recorded in the org chart, and the seat is then filled under Vacancies.`,
      "The advisor or WSUSA may remove a leader immediately for a serious violation of WSU policy.",
    ],
  },
  {
    id: "voting",
    title: "Voting Procedures",
    core: true,
    summary: "Secret ballots in the platform, quorum and ties.",
    fields: [
      { id: "quorumPercent", label: "Quorum (% of eligible voters who must vote)", type: "number", required: true, default: "25", min: 1, max: 100 },
      { id: "votingDays", label: "Days a vote stays open", type: "number", required: true, default: "3", min: 1, max: 30 },
      {
        id: "tieBreak",
        label: "Breaking a tie",
        type: "choice",
        default: "RUNOFF",
        options: [
          { value: "RUNOFF", label: "A runoff between the tied candidates" },
          { value: "ADVISOR", label: "The advisor casts the deciding vote" },
        ],
      },
    ],
    body: (c) => [
      "Club votes on leadership, removal and amendments are held in Wildcat Clubs by secret ballot. Each eligible voter casts one vote, and no one — including leaders and the advisor — can see how an individual voted.",
      `Eligible voters are active members${c.has("voteAttendance") ? " who meet the Attendance Requirement to Vote" : ""}, except where these Bylaws give a vote to the leaders.`,
      `A vote stays open for at least ${c.v("votingDays")} days and counts only if at least ${c.v("quorumPercent")}% of eligible voters take part. If a vote misses quorum, it is held once more, and the second vote needs no quorum.`,
      c.raw("tieBreak") === "ADVISOR"
        ? "If a vote ends in a tie, the advisor casts the deciding vote."
        : "If a vote ends in a tie, a runoff is held between the tied candidates. If the runoff also ties, the advisor decides.",
      "Results are announced to the members and applied in Wildcat Clubs.",
    ],
  },
  {
    id: "voteAttendance",
    title: "Attendance Requirement to Vote",
    core: false,
    summary: "Require a minimum number of events attended to vote.",
    fields: [{ id: "voteMinEvents", label: "Club events attended this semester to vote", type: "number", required: true, default: "2", min: 1, max: 20 }],
    body: (c) => [
      `To vote in Club elections and amendment votes, a member must have attended at least ${c.v("voteMinEvents")} Club events in the current semester, as shown in the Club's Wildcat Clubs attendance records. Eligibility is checked when the vote opens.`,
    ],
  },
  {
    id: "meetingsBylaw",
    title: "Meetings",
    core: true,
    summary: "Leadership meetings, agendas and minutes.",
    fields: [
      { id: "leaderMeetings", label: "Leaders meet…", type: "text", required: true, default: "at least once a month during the semester" },
      { id: "minutesBy", label: "Minutes are taken by…", type: "text", required: true, default: "the Secretary" },
    ],
    body: (c) => [
      `The leaders meet ${clause(c.v("leaderMeetings"))} to plan the Club's work. The President sets the agenda, and any member may ask for an item to be added.`,
      "General meetings are announced to members through Wildcat Clubs announcements and the Club calendar.",
      `Minutes of leadership and business meetings are taken by ${clause(c.v("minutesBy"))} and saved in the Club's files within one week.`,
      "Questions of procedure not covered here are decided by the President, guided by Robert's Rules of Order where helpful.",
    ],
  },
  {
    id: "duesAmounts",
    title: "Dues Amounts",
    core: false,
    summary: "The dues schedule and deadline.",
    fields: [
      { id: "duesSchedule", label: "Dues schedule (one per line)", type: "textarea", required: true, default: "General members: $10 per semester" },
      { id: "duesDeadline", label: "Dues are due by…", type: "text", required: true, default: "the fourth week of each semester" },
    ],
    body: (c) => [
      "Club dues are:",
      list(c.lines("duesSchedule")) ?? missing("dues schedule"),
      `Dues are due by ${clause(c.v("duesDeadline"))}. Members with unpaid dues stay members but may lose dues-funded benefits the leaders announce in advance.`,
    ],
  },
  {
    id: "committeeRules",
    title: "Committee Rules",
    core: false,
    summary: "How committees are formed, run and closed.",
    fields: [{ id: "committeeRules", label: "Additional committee rules (optional, one per line)", type: "textarea", default: "" }],
    body: (c) => [
      "Committee chairs are appointed by the President and confirmed by the leaders. Each committee keeps its notes in the Club's files and reports at leadership meetings.",
      "A committee ends when its work is done or when the leaders dissolve it.",
      list(c.lines("committeeRules")),
    ],
  },
  {
    id: "emergency",
    title: "Emergency Procedures",
    core: false,
    defaultOn: true,
    summary: "Safety at events and decisions that can't wait.",
    fields: [],
    body: () => [
      "In an emergency at a Club event, call 911 first, then notify WSU Police and the advisor.",
      "The leader running an event knows the nearest exits and the building's emergency procedures, and records attendance through Wildcat Clubs check-in so everyone can be accounted for.",
      "When a decision can't wait for a meeting or vote, the President and the advisor may act for the Club. They report the decision to the leaders within seven days, and it lapses at the next leadership meeting unless the leaders confirm it.",
    ],
  },
  {
    id: "transitionChecklist",
    title: "Officer Transition Checklist",
    core: false,
    defaultOn: true,
    summary: "What outgoing leaders hand over.",
    fields: [],
    body: () => [
      "Before leaving office, an outgoing leader:",
      {
        type: "list",
        items: [
          "Confirms their successor in the Club's org chart in Wildcat Clubs",
          "Walks their successor through the seat's responsibilities and open projects",
          "Moves their Club documents into the Club's files",
          "Transfers Club accounts and passwords, including the Club's Google account",
          "Treasurers: reconciles the budget, open funding requests and receipts",
          "Introduces their successor to the advisor and WSUSA contacts",
          "Makes sure their successor knows which trainings and tests their new role requires",
        ],
      },
    ],
  },
  {
    id: "electionCalendar",
    title: "Election Calendar",
    core: false,
    summary: "When each year's elections or hand-offs happen.",
    fields: [
      { id: "electionMonth", label: "Elections or hand-offs happen in (month)", type: "text", required: true, default: "March" },
      { id: "nominationDays", label: "Days nominations stay open", type: "number", required: true, default: "7", min: 1, max: 30 },
    ],
    body: (c) => [
      c.raw("successionMethod") === "MEMBER_VOTE" || c.raw("successionMethod") === "LEADERSHIP_VOTE"
        ? `Leadership elections are held each year in ${c.v("electionMonth")}, so new leaders are ready before the end of spring semester. Nominations stay open for at least ${c.v("nominationDays")} days before voting opens.`
        : `The President names their successor each year by ${c.v("electionMonth")}, so the new leaders are ready before the end of spring semester. Members may suggest candidates for at least ${c.v("nominationDays")} days before the choice is made.`,
      "The leaders announce the schedule to members through Wildcat Clubs at least two weeks in advance.",
    ],
  },
];

export const SECTIONS: Record<DocKind, SectionDef[]> = { constitution: CONSTITUTION, bylaws: BYLAWS };

export const DOC_LABEL: Record<DocKind, string> = { constitution: "Constitution", bylaws: "Bylaws" };

/** Every field across both documents, by id (ids are unique across documents). */
export const FIELDS: Map<string, FieldDef> = new Map([...CONSTITUTION, ...BYLAWS].flatMap((s) => s.fields.map((f) => [f.id, f] as const)));

// ─── Draft data ──────────────────────────────────────────────────────────────

/** What ConstitutionDraft.data holds. */
export type DraftData = {
  v: 1;
  modules: Record<DocKind, string[]>;
  fields: Record<string, string>;
  /** Which of the owner's clubs the preview (and PDF preview) shows. */
  previewClubId: string | null;
};

export const FIELD_MAX = { text: 200, textarea: 2000, number: 6, choice: 40 } as const;

export function defaultDraftData(seed: { joinPolicy?: JoinPolicy; successionMethod?: SuccessionMethod; purpose?: string | null; previewClubId?: string | null } = {}): DraftData {
  const fields: Record<string, string> = {};
  for (const [id, f] of FIELDS) fields[id] = f.default;
  if (seed.joinPolicy) fields.joinPolicy = seed.joinPolicy;
  if (seed.successionMethod) fields.successionMethod = seed.successionMethod;
  if (seed.purpose?.trim()) fields.purpose = seed.purpose.trim();
  return {
    v: 1,
    modules: {
      constitution: CONSTITUTION.filter((s) => !s.core && s.defaultOn).map((s) => s.id),
      bylaws: BYLAWS.filter((s) => !s.core && s.defaultOn).map((s) => s.id),
    },
    fields,
    previewClubId: seed.previewClubId ?? null,
  };
}

/**
 * Tolerant reader for stored JSON: unknown modules/fields are dropped, missing
 * fields fall back to defaults, over-long values are trimmed. Never throws.
 */
export function normalizeDraftData(raw: unknown): DraftData {
  const base = defaultDraftData();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<DraftData>;
  const modules = { ...base.modules };
  for (const kind of ["constitution", "bylaws"] as DocKind[]) {
    const ids = Array.isArray(r.modules?.[kind]) ? (r.modules![kind] as unknown[]) : null;
    if (ids) {
      const valid = new Set(SECTIONS[kind].filter((s) => !s.core).map((s) => s.id));
      modules[kind] = [...new Set(ids.filter((x): x is string => typeof x === "string" && valid.has(x)))];
    }
  }
  const fields = { ...base.fields };
  if (r.fields && typeof r.fields === "object") {
    for (const [id, val] of Object.entries(r.fields)) {
      const def = FIELDS.get(id);
      if (!def || typeof val !== "string") continue;
      if (def.type === "choice" && !def.options?.some((o) => o.value === val)) continue;
      fields[id] = val.slice(0, FIELD_MAX[def.type]);
    }
  }
  return { v: 1, modules, fields, previewClubId: typeof r.previewClubId === "string" ? r.previewClubId : null };
}

export function enabledSections(data: DraftData, kind: DocKind): SectionDef[] {
  const on = new Set(data.modules[kind]);
  return SECTIONS[kind].filter((s) => s.core || on.has(s.id));
}

export function successionOf(data: DraftData): SuccessionMethod {
  const v = data.fields.successionMethod;
  return v === "MEMBER_VOTE" || v === "LEADERSHIP_VOTE" ? v : "SENIORITY";
}

export function joinPolicyOf(data: DraftData): JoinPolicy {
  return data.fields.joinPolicy === "APPROVAL" ? "APPROVAL" : "OPEN";
}

export type DraftProblem = { doc: DocKind; sectionId: string; section: string; field: string; message: string };

/** Everything that must be fixed before the documents can be adopted. */
export function draftProblems(data: DraftData): DraftProblem[] {
  const out: DraftProblem[] = [];
  for (const doc of ["constitution", "bylaws"] as DocKind[]) {
    for (const s of enabledSections(data, doc)) {
      for (const f of s.fields) {
        const val = (data.fields[f.id] ?? "").trim();
        if (f.required && !val) {
          out.push({ doc, sectionId: s.id, section: s.title, field: f.label, message: `${s.title}: “${f.label}” is required.` });
        } else if (f.type === "number" && val) {
          const n = Number(val);
          if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
            out.push({ doc, sectionId: s.id, section: s.title, field: f.label, message: `${s.title}: “${f.label}” must be a number${f.min !== undefined && f.max !== undefined ? ` from ${f.min} to ${f.max}` : ""}.` });
          }
        }
      }
    }
  }
  return out;
}
