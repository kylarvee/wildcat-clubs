import type { ClubCategory, ClubScope, ClubStatus, ClubType, EventKind, JoinPolicy, SuccessionMethod } from "@prisma/client";
import directoryJson from "./wsu-directory.json";
import { BUILDINGS, COLLEGE_BUILDINGS, type CollegeKey } from "./reference";
import { createRng } from "../lib/rng";

/**
 * Every club in the mock database.
 *
 * Approved and retired clubs are Weber State's real clubs (wsu-directory.json,
 * the public club list): real names, purpose statements and contact emails.
 * Everything about their members and history is invented. Two kinds:
 *
 * - STORY clubs carry the persona walkthroughs in PERSONAS.md. Each keeps a
 *   stable `key` (other steps call ctx.club("robotics")) and its story's
 *   shape: size, gate, roles, elections, co-hosts, live events.
 * - DIRECTORY clubs are the rest of the list. Their activity follows the
 *   real roster: clubs with members get about that many, officers in the
 *   seats the directory shows, a meeting series and light history; clubs
 *   with nobody on the roster are dormant.
 *
 * Founding-stage (draft, submitted, changes requested) and rejected clubs are
 * new clubs that aren't on the list, so they stay fictional, and so do the
 * college ambassador orgs (admins create those on the platform).
 */

/** Which text banks (event ideas, chat, titles) a club draws from. */
export type Topic =
  | "tech" | "business" | "health" | "science" | "socsci" | "education" | "arts" | "culture" | "service" | "sports" | "games" | "ambassadors"
  | "faith" | "advocacy" | "greek" | "honor" | "media" | "music" | "dance" | "spirit" | "film" | "general";

export type Life =
  | "active" | "inactive" | "pilot" | "ambassadors" | "draft" | "submitted" | "changes" | "rejected" | "retired"
  /** Directory club with 1–7 people on its roster: meets, but too small to count as active. */
  | "small"
  /** Directory club with nobody on its roster: approved, but nothing this year or last. */
  | "dormant";

/** Clubs that aren't running now: they keep their history but get no new activity. */
export const isQuiet = (life: Life) => life === "inactive" || life === "dormant";

export type Meeting = { dow: number; time: [number, number]; duration: number; interval: 1 | 2; building: string; room: string; title?: string; kind?: EventKind };

export type DirEntry = { dseId: number; name: string; description: string; email: string | null; hasLogo: boolean; members: number; officers: Partial<Record<"president" | "vice_president" | "other_officer" | "advisor", number>> };

export type ClubDef = {
  key: string;
  slug: string;
  name: string;
  /** The real club this is (null for fictional founding-stage clubs and ambassador orgs). */
  dir: DirEntry | null;
  /** Carries a persona walkthrough (hand-written below) rather than following the directory's roster. */
  story: boolean;
  category: ClubCategory;
  topic: Topic;
  contactEmail: string | null;
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
  /** ACTIVE student members today (approved clubs). */
  size: number;
  joinPolicy?: JoinPolicy;
  succession?: SuccessionMethod;
  autoApproveCohosts?: boolean;
  color: string;
  /** Event and attendance intensity, ~0.3 (quiet) to 1.2 (very active). */
  activity: number;
  meeting: Meeting;
  related: string[];
  /** Shown on cards (200 characters at most). */
  short: string;
  /** Plain-text purpose, used in constitutions. */
  about: string;
  /** The club page's About. */
  aboutHtml: string;
  /** Fictional clubs only: what they plan to do and who can join. */
  does: string[];
  join?: string;
  /** Inactive and dormant clubs stopped meeting after this term. */
  lastActiveTerm?: string;
  retired?: { at: [number, number, number]; reason: string };
  rejectedNote?: string;
  /** Directory clubs: how many people hold each seat today (from the directory's officer counts). */
  seatPlan?: Record<string, number>;
  /** Directory clubs: current advisors. */
  advisors?: number;
};

// ─── The real club list ─────────────────────────────────────────────────────

export const DIRECTORY: DirEntry[] = (directoryJson as unknown as { clubs: DirEntry[] }).clubs;
const byName = new Map(DIRECTORY.map((e) => [e.name, e]));
const dirEntry = (name: string) => {
  const e = byName.get(name);
  if (!e) throw new Error(`Not in wsu-directory.json: ${name}`);
  return e;
};

/** Same rule as lib/domain/clubs slugify (server-only there, so replicated). */
export function slugify(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "club"
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const BULLET = /^\s*(?:[•▪◦·]|-|–|o(?=\s|[A-Z][a-z])|\(?[0-9]{1,2}[.)]|\(?[A-Za-z][.)]|[ivx]{1,4}[.)])\s*/;
const clean = (s: string) => s.replace(//g, "•").replace(/\t+/g, " ").replace(/ {2,}/g, " ").trim();

type Block = { kind: "p" | "li"; text: string };

/** The directory's purpose statement as paragraphs and list items (hard line wraps joined back up). */
function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let gap = false;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = clean(raw);
    if (!line) {
      gap = true;
      continue;
    }
    const prev = blocks[blocks.length - 1];
    const bulleted = BULLET.test(line) && line.replace(BULLET, "").length > 2;
    // "B Encourage …" inside a lettered list whose author dropped the period.
    const letter = !bulleted && prev?.kind === "li" && /^[A-Z]\s+[A-Z][a-z]/.test(line);
    if (bulleted || letter) blocks.push({ kind: "li", text: bulleted ? line.replace(BULLET, "") : line.slice(2) });
    else if (prev && !gap && !/[.:;!?)*]$/.test(prev.text)) prev.text += ` ${line}`; // a wrapped line
    else blocks.push({ kind: "p", text: line });
    gap = false;
  }
  return blocks.filter((b) => b.text);
}

export function descriptionToHtml(text: string): string {
  let html = "";
  let list: string[] = [];
  const flush = () => {
    if (list.length) html += `<ul>${list.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    list = [];
  };
  for (const b of parseBlocks(text)) {
    if (b.kind === "li") list.push(b.text);
    else {
      flush();
      html += `<p>${esc(b.text)}</p>`;
    }
  }
  flush();
  return html;
}

/** Plain text (for constitutions and PDFs, which only take Latin-1). */
export function descriptionToText(text: string): string {
  return parseBlocks(text)
    .map((b) => (b.kind === "li" ? `- ${b.text}` : b.text))
    .join(" ")
    .replace(/[•]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** A card-length summary: the first real sentence of the purpose statement (past any "The purposes are:" intro). */
export function shortFrom(text: string): string {
  const blocks = parseBlocks(text).filter((b) => !/^\*.*\*$/.test(b.text));
  const sentence = (b: Block | undefined) => (b?.text ?? "").split(/(?<=[.!?])\s+(?=[A-Z]|[a-z][.)]\s)/)[0];
  // Skip bare intros ("The purposes of this club are:") and stray headings ("Community").
  const intro = (s: string) => /:\s*$/.test(s) && (s.length < 60 || /\b(are|is|follows|following|purposes?|be|include[sd]?|to)\s*:\s*$/i.test(s));
  let i = 0;
  while (i < blocks.length - 1 && (intro(sentence(blocks[i])) || blocks[i].text.length < 25)) i++;
  let pick = sentence(blocks[i]).replace(/:\s*$/, ".").replace(/[;,]\s*(?:and|or)?\s*$/, ".").replace(/^(?:to|and)\s+/i, "");
  pick = pick.charAt(0).toUpperCase() + pick.slice(1);
  if (!/[.!?)]$/.test(pick)) pick += ".";
  if (pick.length <= 180) return pick;
  const cut = pick.slice(0, 177);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/** For clubs whose directory entry has no purpose statement: say only what the name and category tell us. */
function neutral(name: string, category: ClubCategory) {
  const what =
    category === "HONOR_SOCIETY" ? "an honor society chapter" :
    category === "FSL" ? "a Greek-letter organization" :
    category === "RELIGIOUS" ? "a faith-based student organization" :
    "a student organization";
  const short = `${name} is ${what} at Weber State University.`;
  return { short, about: short, aboutHtml: `<p>${esc(short)}</p><p>The club hasn't written a description yet.</p>` };
}

function realText(e: DirEntry, category: ClubCategory) {
  if (!e.description.trim()) return neutral(e.name, category);
  return { short: shortFrom(e.description), about: descriptionToText(e.description), aboutHtml: descriptionToHtml(e.description) };
}

// ─── Category, type, scope and topic for every real club ────────────────────

const CAT = { AC: "ACADEMIC", CU: "CULTURAL", FSL: "FSL", HS: "HONOR_SOCIETY", SA: "SERVICE_ADVOCACY", SL: "STUDENT_LIFE", RE: "RELIGIOUS" } as const satisfies Record<string, ClubCategory>;
type Cat = keyof typeof CAT;
/** S = sponsored by a department, R = registered (independent), A = affiliate (FSL and club sports). */
type T = "S" | "R" | "A";
/** A college (scope COLLEGE), U = university-wide, I = independent, SP = sports. */
type Where = CollegeKey | "U" | "I" | "SP";
type Spec = [cat: Cat, type: T, where: Where, dept: string | null, topic: Topic, major?: string];

const SPECS: Record<string, Spec> = {
  "ACC Construction Competition Awareness Club": ["AC", "S", "east", "Construction Management", "tech", "Construction Management"],
  "Actuary Club": ["AC", "S", "cos", "Mathematics", "science", "Applied Mathematics"],
  "Adobe Club": ["AC", "R", "U", null, "tech"],
  "African and Caribbean Student Union (ACSU)": ["CU", "R", "U", null, "culture"],
  "African Drum Society": ["CU", "R", "I", null, "music"],
  "AIBD Student Chapter (Building Design)": ["AC", "R", "east", null, "tech"],
  "Air Force ROTC at Weber State": ["AC", "R", "U", null, "service"],
  "Allegro!": ["SL", "R", "I", null, "music"],
  "Alternative Student Alliance (ASA)": ["CU", "R", "U", null, "culture"],
  "American Association of University Women (AAUW)": ["SA", "R", "U", null, "advocacy"],
  "American Cancer Society": ["SA", "R", "U", null, "service"],
  "American Conservation Coalition": ["SA", "R", "U", null, "advocacy"],
  "American Democracy Project (ADP)": ["SA", "R", "sbs", null, "socsci", "Political Science"],
  "American Institute of Aeronautics and Astronautics": ["AC", "S", "east", "Mechanical Engineering", "tech", "Mechanical Engineering"],
  "American Institute of Graphic Arts (AIGA) WSU Chapter": ["AC", "S", "arts", "Visual Art & Design", "arts", "Graphic Design"],
  "American Red Cross Club": ["SA", "R", "U", null, "service"],
  "American Sign Language Club (ASL Club)": ["CU", "R", "U", null, "culture"],
  "American Society of Heating, Refrigerating and Air-Conditioning Engineers (ASHRAE)": ["AC", "S", "east", "Engineering Technology", "tech", "Mechanical Engineering Technology"],
  "American Society of Mechanical Engineers (ASME)": ["AC", "S", "east", "Mechanical Engineering", "tech", "Mechanical Engineering"],
  "American Society of Microbiology Student Chapter @ WSU / Microbiology Club": ["AC", "S", "cos", "Microbiology", "science", "Microbiology"],
  "American Welding Society (AWS)": ["AC", "S", "east", "Manufacturing & Systems Engineering", "tech", "Manufacturing Engineering"],
  "Animal Unanimity": ["SA", "R", "I", null, "advocacy"],
  "Anthropology Club": ["AC", "S", "sbs", "Anthropology", "socsci", "Anthropology"],
  "Anything for a Friend": ["SA", "R", "I", null, "service"],
  "Applied AI Lab": ["AC", "S", "gsbe", "Information Systems & Technologies", "tech", "Information Systems & Technologies"],
  "Army ROTC Club at Weber State": ["AC", "S", "sbs", "Military Science", "service"],
  "Art and Culture through Movement and Music (ACTMM)": ["CU", "R", "I", null, "music"],
  "Art Guild": ["AC", "S", "arts", "Visual Art & Design", "arts", "Art"],
  "Asian Student Involvement Association (ASIA)": ["CU", "R", "U", null, "culture"],
  "Associated Actors and Technician": ["AC", "S", "arts", "Performing Arts", "arts", "Theatre Arts"],
  "Associated Artists of the Theatre (AAT)": ["AC", "S", "arts", "Performing Arts", "arts", "Theatre Arts"],
  "Associated Builder and Contractors Club (ABC)": ["AC", "S", "east", "Construction Management", "tech", "Construction Management"],
  "Associated General Contractors of America Club (AGC)": ["AC", "S", "east", "Construction Management", "tech", "Construction Management"],
  "Association of Environmental & Engineering Geologists (AEG)": ["AC", "S", "cos", "Earth & Environmental Sciences", "science", "Geology"],
  "ASTRA": ["SL", "R", "I", null, "general"],
  "Athletes Intervarsity": ["RE", "R", "U", null, "faith"],
  "Axis Bible Study": ["RE", "R", "U", null, "faith"],
  "Ballroom and Hip Hop Club": ["SL", "R", "I", null, "dance"],
  "Ballroom Dance Club at WSU": ["SL", "R", "I", null, "dance"],
  "Best Buddies Chapter at WSU": ["SA", "R", "U", null, "service"],
  "Beta Alpha Psi": ["HS", "S", "gsbe", "School of Accounting & Taxation", "business", "Accounting"],
  "Big Band Swing Club at Weber State": ["SL", "R", "I", null, "music"],
  "Big Brothers, Big Sisters Club at WSU": ["SA", "R", "U", null, "service"],
  "BITS: Management Information Systems Students": ["AC", "S", "gsbe", "Information Systems & Technologies", "tech", "Information Systems & Technologies"],
  "Black Student Union (BSU)": ["CU", "R", "U", null, "culture"],
  "Board Game Club": ["SL", "R", "I", null, "games"],
  "Botany Club": ["AC", "S", "cos", "Botany", "science", "Botany"],
  "Bridge to Business": ["AC", "R", "gsbe", null, "business"],
  "Casual Gaming Club": ["SL", "R", "I", null, "games"],
  "Cat Club": ["SL", "R", "I", null, "general"],
  "Chemistry and Biochemistry Club": ["AC", "S", "cos", "Chemistry & Biochemistry", "science", "Chemistry"],
  "Chess Club": ["SL", "R", "I", null, "games"],
  "Child & Family Studies Student Association (CFSSA)": ["AC", "S", "edu", "Child & Family Studies", "education", "Family Studies"],
  "Chinese Student Association": ["CU", "R", "U", null, "culture"],
  "Christians United for Israel at WSU": ["RE", "R", "U", null, "faith"],
  "Citizens' Climate Lobby (CCL)": ["SA", "R", "U", null, "advocacy"],
  "Clash Royale Club": ["SL", "R", "I", null, "games"],
  "College Democrats at Weber State": ["SA", "R", "U", null, "advocacy"],
  "College Republicans at Weber State": ["SA", "R", "U", null, "advocacy"],
  "Colleges Against Cancer": ["SA", "R", "U", null, "service"],
  "Comedy Club at WSU": ["SL", "R", "I", null, "arts"],
  "Construction Management Club (CMT)": ["AC", "S", "east", "Construction Management", "tech", "Construction Management"],
  "Cooking Club at Weber State": ["SL", "R", "I", null, "general"],
  "Cornhole Club": ["SL", "A", "SP", null, "sports"],
  "Country Dancing Club": ["SL", "R", "I", null, "dance"],
  "Crime Scene Investigation (CSI) Club": ["AC", "S", "sbs", "Criminal Justice", "socsci", "Criminal Justice"],
  "Cyber Security Club (CSC)": ["AC", "S", "east", "School of Computing", "tech", "Cybersecurity"],
  "Data Analytics Club": ["AC", "S", "cos", "Mathematics", "tech", "Data Science"],
  "Delta Chi Nu": ["FSL", "A", "U", null, "greek"],
  "Disabilities Club": ["SA", "R", "U", null, "advocacy"],
  "Educators Rising": ["AC", "S", "edu", "Teacher Education", "education", "Elementary Education"],
  "Electroneurodiagnostics (END) Club": ["AC", "R", "health", null, "health"],
  "Engineering Honor Society / Tau Beta Pi": ["HS", "R", "east", null, "honor"],
  "Environmental Ambassadors": ["SA", "R", "U", null, "service"],
  "Envision Pre-Optometry Club": ["AC", "R", "cos", null, "health"],
  "European Student Club": ["CU", "R", "U", null, "culture"],
  "Exercise & Nutrition Sciences Club (ENS Club)": ["AC", "S", "edu", "Kinesiology", "health", "Exercise Science"],
  "Facilities Management (FM) Club at WSU": ["AC", "R", "east", null, "tech"],
  "FANBOYS": ["SL", "R", "I", null, "games"],
  "Fellowship of Christian Athletes (FCA)": ["RE", "R", "U", null, "faith"],
  "Feminists United Network (FUN)": ["SA", "R", "U", null, "advocacy"],
  "Fight the New Drug at Weber State": ["SA", "R", "U", null, "advocacy"],
  "Filipino Club": ["CU", "R", "U", null, "culture"],
  "Financial Foundations": ["AC", "R", "gsbe", null, "business"],
  "First Generation Club at WSU": ["CU", "R", "U", null, "culture"],
  "First Nations Society": ["CU", "R", "U", null, "culture"],
  "Food Recovery Network (FRN)": ["SA", "R", "U", null, "service"],
  "Foreign Language and International Student Partnership (FLISP)": ["CU", "R", "U", null, "culture"],
  "Freedom Riders": ["SL", "R", "I", null, "general"],
  "French Club": ["CU", "S", "arts", "Foreign Languages", "culture", "French"],
  "Freshman/Sophomore Business Club": ["AC", "R", "gsbe", null, "business"],
  "Friends and Flowers at Weber State": ["SA", "R", "U", null, "service"],
  "FUEL Campus Ministries": ["RE", "R", "U", null, "faith"],
  "Fusion Winter Guard": ["SL", "R", "I", null, "dance"],
  "Future Healthcare Leaders Association (Future Health Leaders Association - FHLA)": ["AC", "S", "health", "Health Administrative Services", "health", "Health Administration"],
  "Garden Club": ["SA", "R", "U", null, "service"],
  "GEAR UP Alumni Chapter": ["SL", "R", "U", null, "general"],
  "Gen UN": ["SA", "R", "U", null, "advocacy"],
  "Gender and Sexuality Alliance (GSA)": ["CU", "R", "U", null, "culture"],
  "Geography Club / GTU / Geography Environment and Sustainability Club": ["AC", "S", "sbs", "Geography", "socsci", "Geography"],
  "Geology/Geosciences Club": ["AC", "S", "cos", "Earth & Environmental Sciences", "science", "Geology"],
  "Golden Key Honour Society WSU Chapter": ["HS", "R", "U", null, "honor"],
  "Graduate Athletic Training Student Organization (GATSO)": ["AC", "S", "edu", "Kinesiology", "health", "Exercise Science"],
  "Hammock Club at WSU": ["SL", "R", "I", null, "general"],
  "Health Promotion and Wellness Club": ["AC", "S", "edu", "Health Promotion", "health", "Public Health"],
  "Health Scholar Club": ["AC", "R", "health", null, "health"],
  "Health Sciences Club": ["AC", "S", "health", "Health Administrative Services", "health", "Health Sciences"],
  "Hiking and Outdoors Club": ["SL", "R", "SP", null, "sports"],
  "Hispanic Area Council (HAC)": ["CU", "R", "U", null, "culture"],
  "History Club at WSU": ["AC", "S", "sbs", "History", "socsci", "History"],
  "Honors Student Advisory Board": ["AC", "R", "U", null, "general"],
  "Hope Alliance": ["SA", "R", "U", null, "service"],
  "Hope Squad at Weber State": ["SA", "R", "U", null, "advocacy"],
  "HOSA - Future Health Professionals": ["AC", "R", "health", null, "health"],
  "Human Rights Club": ["SA", "R", "U", null, "advocacy"],
  "IGNITE National Weber State University Chapter": ["SA", "R", "U", null, "advocacy"],
  "Incredibly Strange Movie Night (ISMN)": ["SL", "R", "I", null, "film"],
  "Independent Color Guard at WSU": ["SL", "R", "I", null, "dance"],
  "Indivisible at Weber State": ["SA", "R", "U", null, "advocacy"],
  "Indoor Drumline at WSU": ["SL", "R", "I", null, "music"],
  "Innovators Club": ["AC", "R", "U", null, "business"],
  "Institute of Electrical and Electronics Engineers (IEEE)": ["AC", "S", "east", "Electrical & Computer Engineering", "tech", "Electrical Engineering"],
  "Interior Design Chapter": ["AC", "R", "U", null, "arts"],
  "International Students Committee (ISC)": ["CU", "R", "U", null, "culture"],
  "Intervarsity Christian Fellowship": ["RE", "R", "U", null, "faith"],
  "Japan Club": ["CU", "S", "arts", "Foreign Languages", "culture", "Japanese"],
  "Japanese Cultural Association": ["CU", "R", "U", null, "culture"],
  "Kappa Omega Eta": ["FSL", "A", "U", null, "greek"],
  "Korean Club": ["CU", "R", "U", null, "culture"],
  "KWCR Wildcat Radio": ["AC", "S", "arts", "Communication", "media", "Communication"],
  "Latinos in Action (LIA) Club": ["CU", "R", "U", null, "culture"],
  "Latter-day Saint Student Association (LDSSA)": ["RE", "R", "U", null, "faith"],
  "Leukemia & Lymphoma Society (LLS on Campus)": ["SA", "R", "U", null, "service"],
  "Lions Club at Weber State": ["SA", "R", "U", null, "service"],
  "Magic Club": ["SL", "R", "I", null, "games"],
  "Mariachi Club": ["CU", "R", "I", null, "music"],
  "Marketing Association at WSU": ["AC", "S", "gsbe", "Business Administration", "business", "Marketing"],
  "Marksmanship Club": ["SL", "A", "SP", null, "sports"],
  "Math Factor Club": ["AC", "S", "cos", "Mathematics", "science", "Mathematics"],
  "Medical Laboratory Sciences (MLS) Club at WSU": ["AC", "S", "health", "Medical Laboratory Sciences", "health", "Medical Laboratory Science"],
  "Medieval History Club at WSU": ["SL", "R", "I", null, "socsci"],
  "Men of Color (MOC)": ["CU", "R", "U", null, "culture"],
  "Metaphor Undergraduate Literary Journal": ["AC", "S", "arts", "English Language & Literature", "arts", "Creative Writing"],
  "Microbiology Book Club": ["AC", "S", "cos", "Microbiology", "science", "Microbiology"],
  "Military-Affiliated Club": ["CU", "R", "U", null, "service"],
  "Model United Nations Organization": ["AC", "R", "sbs", null, "socsci", "Political Science"],
  "More Accessibility in Science Club (MAS)": ["AC", "R", "cos", null, "science"],
  "Movimiento Estudantil Chicanx de Aztlan (MEChA)": ["CU", "R", "U", null, "culture"],
  "Music Club": ["SL", "R", "I", null, "music"],
  "Music Student Advisory Council (MSAC)": ["AC", "S", "arts", "Music", "music", "Music"],
  "Music Teachers National Association (MTNA) / Treblemakers": ["AC", "S", "arts", "Music", "music", "Music Education"],
  "Muslim Student Association (MSA)": ["RE", "R", "U", null, "faith"],
  "NAACP Student Chapter at Weber State": ["SA", "R", "U", null, "advocacy"],
  "National Association of Hispanic Journalists": ["AC", "S", "arts", "Communication", "media", "Communication"],
  "National Science Teachers Association, Student Chapter at Weber State University": ["AC", "S", "edu", "Teacher Education", "education"],
  "National Society of Collegiate Scholars at WSU (NSCS)": ["HS", "R", "U", null, "honor"],
  "National Student Nurses Association (NSNA) Ogden Campus": ["AC", "S", "health", "Annie Taylor Dee School of Nursing", "health", "Nursing"],
  "Native American Student Association (NASA)": ["CU", "R", "U", null, "culture"],
  "Nepalese Student Association (NSA)": ["CU", "R", "U", null, "culture"],
  "Nontraditional Student Association at Weber State": ["CU", "R", "U", null, "general"],
  "Nu Rho Psi / Neuroscience Club": ["HS", "S", "sbs", "Psychology", "science", "Neuroscience"],
  "Nurture the Creative Mind": ["SL", "R", "I", null, "arts"],
  "Ogden Utah Young Single Adult Stake": ["RE", "R", "U", null, "faith"],
  "Omicron Delta Kappa": ["HS", "R", "U", null, "honor"],
  "Paleontology Club": ["AC", "S", "cos", "Earth & Environmental Sciences", "science", "Geology"],
  "Phi Beta Lambda": ["AC", "R", "gsbe", null, "business"],
  "Phi Gamma Lambda": ["FSL", "A", "U", null, "greek"],
  "Philosophy Club": ["AC", "S", "sbs", "Political Science & Philosophy", "socsci", "Philosophy"],
  "Photographic Society": ["AC", "S", "arts", "Visual Art & Design", "arts", "Photography"],
  "Physical Education (PE) & Sport Coaching Club": ["AC", "S", "edu", "Kinesiology", "education", "Physical Education"],
  "Physician Assistants (PA) Student Society": ["AC", "R", "health", null, "health"],
  "Pi Phi Alpha": ["FSL", "A", "U", null, "greek"],
  "Pi Sigma Alpha": ["HS", "S", "sbs", "Political Science & Philosophy", "honor", "Political Science"],
  "Pokémon League Headquarters: Weber State Region": ["SL", "R", "I", null, "games"],
  "Portuguese Club": ["CU", "R", "U", null, "culture"],
  "Pre-Dental Club": ["AC", "R", "cos", null, "health"],
  "Pre-Healthcare Club": ["AC", "S", "edu", "Kinesiology", "health", "Exercise Science"],
  "Pre-Law Association at WSU": ["AC", "R", "U", null, "socsci"],
  "Pre-Med Club": ["AC", "R", "cos", null, "health"],
  "Pre-Med Mentorship Club": ["AC", "R", "cos", null, "health"],
  "Pre-Occupational Therapy Student Association": ["AC", "R", "health", null, "health"],
  "Pre-Pharmacy Club": ["AC", "R", "cos", null, "health"],
  "Pre-Physical Therapy Club": ["AC", "R", "edu", null, "health"],
  "Pre-Physicians Assistant (Pre-PA) Club": ["AC", "R", "health", null, "health"],
  "Pre-SOMA": ["AC", "R", "cos", null, "health"],
  "Pre-Vet Club": ["AC", "R", "cos", null, "science"],
  "Professional Sales Student Association (PSSA)": ["AC", "S", "gsbe", "Business Administration", "business", "Professional Sales"],
  "Project Runway at Weber State": ["SL", "R", "I", null, "arts"],
  "Psi Chi Honors Club / Psi Cho (Psychology Club)": ["HS", "S", "sbs", "Psychology", "socsci", "Psychology"],
  "Psi Phi Psi": ["FSL", "A", "U", null, "greek"],
  "Public Relations Student Society of America (PRSSA) / Ogden Peak Communications": ["AC", "S", "arts", "Communication", "media", "Communication"],
  "Ratio Christi": ["RE", "R", "U", null, "faith"],
  "RC Wrecker Bots Club": ["AC", "S", "east", "Electrical & Computer Engineering", "tech", "Electrical Engineering"],
  "Redemption College Ministry": ["RE", "R", "U", null, "faith"],
  "Represent Us at Weber State University": ["SA", "R", "U", null, "advocacy"],
  "Research Club at WSU": ["AC", "R", "U", null, "science"],
  "RISE Campus Ministries": ["RE", "R", "U", null, "faith"],
  "Rotaract Club of Ogden": ["SA", "R", "U", null, "service"],
  "Saudi Arabia Club": ["CU", "R", "U", null, "culture"],
  "Scary Politics": ["SA", "R", "U", null, "advocacy"],
  "Secular Students at Weber State": ["SL", "R", "U", null, "socsci"],
  "Semper Veritas": ["SL", "R", "I", null, "general"],
  "Sigma Delta Pi Hispanic Honor Society": ["HS", "S", "arts", "Foreign Languages", "honor", "Spanish"],
  "Sigma Gamma Epsilon: Etta Gamma Chapter (SGE) (Geology Honor Society)": ["HS", "S", "cos", "Earth & Environmental Sciences", "honor", "Geology"],
  "Sigma Tau Delta": ["HS", "S", "arts", "English Language & Literature", "honor", "English"],
  "Social Advocacy Council (SAC)": ["SA", "R", "U", null, "advocacy"],
  "Social Work Club and One Campus Chapter": ["AC", "S", "sbs", "Social Work & Gerontology", "socsci", "Social Work"],
  "Societa Italiana (Italian Club)": ["CU", "R", "U", null, "culture"],
  "Society for Human Resource Management (SHRM)": ["AC", "S", "gsbe", "Business Administration", "business", "Human Resource Management"],
  "Society for the Advancement of Material and Process Engineering (SAMPE)": ["AC", "S", "east", "Manufacturing & Systems Engineering", "tech", "Manufacturing Engineering"],
  "Society of Automotive Professionals": ["AC", "S", "east", "Automotive Technology", "tech", "Automotive Technology"],
  "Society of Hispanic Engineers (SHPE)": ["AC", "R", "east", null, "tech"],
  "Society of Manufacturing Engineers SME": ["AC", "S", "east", "Manufacturing & Systems Engineering", "tech", "Manufacturing Engineering"],
  "Society of Physics Students": ["AC", "S", "cos", "Physics & Astronomy", "science", "Physics"],
  "Society of Women Engineers (SWE)": ["AC", "S", "east", "Mechanical Engineering", "tech", "Mechanical Engineering"],
  "Sociology Club": ["AC", "S", "sbs", "Sociology", "socsci", "Sociology"],
  "Spanish Club": ["CU", "S", "arts", "Foreign Languages", "culture", "Spanish"],
  "Spectrum Club": ["SL", "R", "U", null, "general"],
  "Spiritual Sciences": ["RE", "R", "I", null, "faith"],
  "STAND at WSU": ["SA", "R", "U", null, "advocacy"],
  "Student Alumni Association": ["SL", "R", "U", null, "general"],
  "Student American Dental Hygienists Association (SADHA)": ["AC", "S", "health", "Dental Hygiene", "health", "Dental Hygiene"],
  "Student Athlete Advisory Committee (SAAC)": ["SL", "R", "U", null, "spirit"],
  "Student Council for Exceptional Children (CEC/SCEC)": ["AC", "S", "edu", "Teacher Education", "education", "Special Education"],
  "Student Economic Association (SEA)": ["AC", "S", "gsbe", "Economics", "business", "Economics"],
  "Student National Association of Teachers of Singing (SNATS) at WSU": ["AC", "S", "arts", "Music", "music", "Music"],
  "Students Against Trafficking": ["SA", "R", "U", null, "advocacy"],
  "Students for Ethical Government": ["SA", "R", "U", null, "advocacy"],
  "Students for Life at Weber State": ["SA", "R", "U", null, "advocacy"],
  "Students in Free Enterprise (SIFE)": ["AC", "R", "gsbe", null, "business"],
  "Students United for Reproductive Freedom (SURF)": ["SA", "R", "U", null, "advocacy"],
  "Supply Chain Catalysts (SC Cats) / Student Association of Supply Chain Management (SASCM)": ["AC", "S", "gsbe", "Business Administration", "business", "Supply Chain Management"],
  "SWIFT (Secular Weber Inquirers and Free Thinkers)": ["SL", "R", "U", null, "socsci"],
  "Swing Dance/ Social Dance Club": ["SL", "R", "I", null, "dance"],
  "Synthetic Biology Club": ["AC", "R", "cos", null, "science"],
  "Task Force Wildcat": ["SL", "R", "U", null, "general"],
  "The Blox Club (Minecraft & Roblox Club)": ["SL", "R", "I", null, "games"],
  "The Computing Society at Weber State (CSWS) (Formerly known as: Association for Computing Machinery)": ["AC", "S", "east", "School of Computing", "tech", "Computer Science"],
  "The HAM Radio Club": ["SL", "R", "I", null, "tech"],
  "The Improv Club at Weber State": ["SL", "R", "I", null, "arts"],
  "The League of Women Voters at Weber State": ["SA", "R", "U", null, "advocacy"],
  "The Literacy Association at Weber State": ["AC", "S", "edu", "Teacher Education", "education", "Elementary Education"],
  "The National Society of Leadership and Success (NSLS)": ["HS", "R", "U", null, "honor"],
  "The Ohana Association (TOA)": ["CU", "R", "U", null, "culture"],
  "The Pop-up Gallery at Weber State (Ogden Gallery of Contemporary Arts)": ["AC", "S", "arts", "Visual Art & Design", "arts", "Art"],
  "The PRESS": ["SL", "R", "I", null, "arts"],
  "The Scientista Foundation Chapter at Weber State": ["AC", "R", "cos", null, "science"],
  "The Signpost": ["AC", "S", "arts", "Communication", "media", "Communication"],
  "The Study Abroad Club (SAC)": ["SL", "R", "U", null, "culture"],
  "The Ubiquitous Voice Society, Student Chapter, Weber State University (UVS)": ["SL", "R", "I", null, "general"],
  "The Wild": ["SL", "R", "SP", null, "spirit"],
  "The Wildlife Society (TWS) at Weber State University": ["AC", "S", "cos", "Zoology", "science", "Zoology"],
  "Tomorrow's Educators Advocating for Mathematics and Science (TEAMS)": ["AC", "S", "edu", "Teacher Education", "education"],
  "Turning Point USA  (TPUSA)": ["SA", "R", "U", null, "advocacy"],
  "United Nations Association (UNA)": ["SA", "R", "U", null, "advocacy"],
  "USGBC Student Group at WSU": ["AC", "R", "east", null, "tech"],
  "Utah Education Technology Consortium (Utah Technology Education Coalition)": ["AC", "S", "edu", "Teacher Education", "education"],
  "UV Crew": ["SA", "R", "U", null, "advocacy"],
  "Veg & Animal Rights Club": ["SA", "R", "U", null, "advocacy"],
  "Vegetarian Club": ["SL", "R", "I", null, "general"],
  "Venture Capital/Private Equity Club (VC/PE Club)": ["AC", "S", "gsbe", "Finance", "business", "Finance"],
  "VOX Initiative": ["SL", "R", "U", null, "general"],
  "Waldo's Rocketry Club": ["SL", "R", "I", null, "tech"],
  "Weber Association of Marketing (WAM) / Marketing Club": ["AC", "S", "gsbe", "Business Administration", "business", "Marketing"],
  "Weber Entrepreneurs Association (WEA)": ["AC", "R", "gsbe", null, "business"],
  "Weber Film Society": ["SL", "R", "I", null, "film"],
  "Weber Racing": ["AC", "S", "east", "Automotive Technology", "tech", "Automotive Technology"],
  "Weber State Ballet Folklorico": ["CU", "R", "U", null, "dance"],
  "Weber State Debate": ["AC", "S", "arts", "Communication", "socsci", "Communication"],
  "Weber State News (Studio 76)": ["AC", "S", "arts", "Communication", "media", "Communication"],
  "Wildcat Catholics": ["RE", "R", "U", null, "faith"],
  "Wildcat Investors": ["AC", "R", "gsbe", null, "business", "Finance"],
  "Wildcat Printmaking Club": ["AC", "S", "arts", "Visual Art & Design", "arts", "Art"],
  "Wildcat Scholars": ["AC", "R", "U", null, "general"],
  "Wildcat Service Club": ["SA", "R", "U", null, "service"],
  "Wildcat Yo-Yo & Juggle Club": ["SL", "R", "I", null, "games"],
  "Wildcats Care Club": ["SA", "R", "U", null, "service"],
  "Wildcats of the Coast (WCOTC)": ["SL", "R", "I", null, "games"],
  "Women and Gender Studies Club at WSU": ["AC", "R", "U", null, "socsci"],
  "Women in Construction at WSU": ["AC", "S", "east", "Construction Management", "tech", "Construction Management"],
  "Writers Ink": ["SL", "R", "I", null, "arts"],
  "Writing About Faith": ["RE", "R", "I", null, "faith"],
  "WSU German Club / German Foreign Language Club": ["CU", "S", "arts", "Foreign Languages", "culture"],
  "WSU Letters Collective": ["SL", "R", "I", null, "arts"],
  "Young Americans for Freedom (YAF)": ["SA", "R", "U", null, "advocacy"],
  "Young Americans for Liberty": ["SA", "R", "U", null, "advocacy"],
  "Young Democratic Socialists of America (YDSA) at WSU": ["SA", "R", "U", null, "advocacy"],
  "Young Greens": ["SA", "R", "U", null, "advocacy"],
  "Young Life College": ["RE", "R", "U", null, "faith"],
  "Zeta Gamma Eta": ["FSL", "A", "U", null, "greek"],
  "Zi Ye Mao (Chinese Language and Culture Club)": ["CU", "R", "U", null, "culture"],
  "Zoology Club": ["AC", "S", "cos", "Zoology", "science", "Zoology"],
};

for (const e of DIRECTORY) if (!SPECS[e.name]) throw new Error(`No category spec for directory club: ${e.name}`);
for (const name of Object.keys(SPECS)) if (!byName.has(name)) throw new Error(`Spec for a club that isn't in the directory: ${name}`);

const TYPE: Record<T, ClubType> = { S: "SPONSORED", R: "REGISTERED", A: "AFFILIATE" };
const SCOPE = (w: Where): ClubScope => (w === "U" ? "UNIVERSITY" : w === "I" ? "INDEPENDENT" : w === "SP" ? "SPORTS" : "COLLEGE");

const M = (dow: number, h: number, m: number, duration: number, interval: 1 | 2, building: string, room: string, title?: string, kind?: EventKind): Meeting => ({
  dow, time: [h, m], duration, interval, building, room, title, kind,
});

// ─── Story clubs ─────────────────────────────────────────────────────────────

/** Hand-written parts of a story club; the real club fills in the rest. */
type StoryDef = Omit<ClubDef, "slug" | "name" | "dir" | "story" | "category" | "topic" | "contactEmail" | "short" | "about" | "aboutHtml" | "does"> & {
  /** The real club (name in wsu-directory.json) this story runs in. */
  real: string;
  topic: Topic;
};

const STORY: StoryDef[] = [
  // ─── Goddard School of Business & Economics ────────────────────────────────
  {
    key: "ailab", real: "Applied AI Lab", type: "SPONSORED", scope: "COLLEGE", college: "gsbe",
    department: "Information Systems & Technologies", focusMajor: "Information Systems & Technologies", status: "APPROVED", life: "active",
    founded: [2023, 9], size: 64, succession: "MEMBER_VOTE", color: "#4b2e83", topic: "tech", activity: 1.05,
    meeting: M(3, 18, 0, 90, 1, "WB", "Room 210", "Lab Night"),
    related: ["acm", "datasci", "fic", "entre"],
  },
  {
    key: "fic", real: "Wildcat Investors", type: "REGISTERED", scope: "COLLEGE", college: "gsbe",
    focusMajor: "Finance", status: "APPROVED", life: "active", founded: [2022, 9], size: 48, color: "#0f766e", topic: "business", activity: 0.9,
    meeting: M(2, 17, 30, 60, 1, "WB", "Room 108"),
    related: ["accounting", "entre", "marketing", "ailab"],
  },
  {
    key: "accounting", real: "Beta Alpha Psi", type: "SPONSORED", scope: "COLLEGE", college: "gsbe",
    department: "School of Accounting & Taxation", focusMajor: "Accounting", status: "APPROVED", life: "active", founded: [2022, 9], size: 42,
    color: "#1e3a8a", topic: "business", activity: 0.85,
    meeting: M(4, 12, 0, 60, 2, "WB", "Room 205", "Lunch & Learn"),
    related: ["fic", "marketing", "entre"],
  },
  {
    key: "marketing", real: "Weber Association of Marketing (WAM) / Marketing Club", type: "SPONSORED", scope: "COLLEGE", college: "gsbe",
    department: "Business Administration", focusMajor: "Marketing", status: "APPROVED", life: "active", founded: [2023, 1], size: 36,
    color: "#be123c", topic: "business", activity: 0.8,
    meeting: M(1, 17, 30, 60, 2, "WB", "Room 218"),
    related: ["entre", "accounting", "fic"],
  },
  {
    key: "entre", real: "Weber Entrepreneurs Association (WEA)", type: "REGISTERED", scope: "COLLEGE", college: "gsbe",
    focusMajor: "Business Administration", status: "APPROVED", life: "active", founded: [2024, 1], size: 30, color: "#b45309", topic: "business", activity: 0.75,
    meeting: M(3, 12, 0, 60, 2, "WB", "Room 108", "Founders' Lunch"),
    related: ["marketing", "fic", "ailab"],
  },

  // ─── Engineering, Applied Science & Technology ──────────────────────────────
  {
    key: "robotics", real: "RC Wrecker Bots Club", type: "SPONSORED", scope: "COLLEGE", college: "east",
    department: "Electrical & Computer Engineering", focusMajor: "Electrical Engineering", status: "APPROVED", life: "active", founded: [2022, 9], size: 90,
    joinPolicy: "APPROVAL", color: "#1d4ed8", topic: "tech", activity: 1.2,
    meeting: M(2, 18, 0, 120, 1, "NB", "Room 150 (Makerspace)", "Build Night"),
    related: ["acm", "swe", "motorsports", "cyber"],
  },
  {
    key: "swe", real: "Society of Women Engineers (SWE)", type: "SPONSORED", scope: "COLLEGE", college: "east",
    department: "Mechanical Engineering", focusMajor: "Mechanical Engineering", status: "APPROVED", life: "active", founded: [2022, 10], size: 44,
    succession: "LEADERSHIP_VOTE", color: "#7c3aed", topic: "tech", activity: 0.95,
    meeting: M(4, 17, 30, 60, 2, "NB", "Room 220"),
    related: ["robotics", "acm", "cyber"],
  },
  {
    key: "acm", real: "The Computing Society at Weber State (CSWS) (Formerly known as: Association for Computing Machinery)", type: "SPONSORED", scope: "COLLEGE", college: "east",
    department: "School of Computing", focusMajor: "Computer Science", status: "APPROVED", life: "active", founded: [2022, 9], size: 72, color: "#0e7490", topic: "tech", activity: 1.0,
    meeting: M(1, 18, 30, 90, 1, "NB", "Room 308", "Hack Night"),
    related: ["robotics", "cyber", "ailab", "datasci", "swe"],
  },
  {
    key: "cyber", real: "Cyber Security Club (CSC)", type: "SPONSORED", scope: "COLLEGE", college: "east",
    department: "School of Computing", focusMajor: "Cybersecurity", status: "APPROVED", life: "active", founded: [2023, 1], size: 38, joinPolicy: "APPROVAL", color: "#15803d", topic: "tech", activity: 0.9,
    meeting: M(3, 18, 30, 90, 1, "NB", "Room 210", "Lab Night"),
    related: ["acm", "robotics", "swe"],
  },
  {
    key: "motorsports", real: "Weber Racing", type: "SPONSORED", scope: "COLLEGE", college: "east",
    department: "Automotive Technology", focusMajor: "Automotive Technology", status: "APPROVED", life: "active", founded: [2023, 9], size: 34, joinPolicy: "APPROVAL",
    color: "#c2410c", topic: "tech", activity: 0.85,
    meeting: M(4, 18, 0, 120, 1, "D3", "Room 106", "Shop Night"),
    related: ["robotics", "swe"],
  },

  // ─── College of Science ─────────────────────────────────────────────────────
  {
    key: "premed", real: "Pre-Med Club", type: "REGISTERED", scope: "COLLEGE", college: "cos",
    focusOther: "Pre-health professions", status: "APPROVED", life: "active", founded: [2022, 9], size: 104, color: "#be185d", topic: "health", activity: 1.0,
    meeting: M(1, 17, 0, 60, 1, "TY", "Room 150"),
    related: ["chem", "nursing", "psych", "dental"],
  },
  {
    key: "chem", real: "Chemistry and Biochemistry Club", type: "SPONSORED", scope: "COLLEGE", college: "cos",
    department: "Chemistry & Biochemistry", focusMajor: "Chemistry", status: "APPROVED", life: "active", founded: [2022, 10], size: 26, color: "#0891b2", topic: "science", activity: 0.75,
    meeting: M(4, 12, 0, 50, 2, "TY", "Room 225"),
    related: ["premed", "astro", "datasci"],
  },
  {
    key: "astro", real: "Society of Physics Students", type: "SPONSORED", scope: "COLLEGE", college: "cos",
    department: "Physics & Astronomy", focusMajor: "Physics", status: "APPROVED", life: "inactive", founded: [2022, 9], size: 7, color: "#1e293b", topic: "science", activity: 0.35,
    meeting: M(4, 19, 30, 90, 2, "LL", "Ott Planetarium", "Star Night"),
    related: ["chem", "math"],
    lastActiveTerm: "Spring 2025",
  },
  {
    key: "math", real: "Actuary Club", type: "SPONSORED", scope: "COLLEGE", college: "cos",
    department: "Mathematics", focusMajor: "Applied Mathematics", status: "APPROVED", life: "inactive", founded: [2023, 1], size: 8, color: "#475569", topic: "science", activity: 0.35,
    meeting: M(3, 15, 30, 60, 2, "TY", "Room 316", "Exam Study Session"),
    related: ["astro", "datasci", "acm"],
    lastActiveTerm: "Fall 2025",
  },

  // ─── Social & Behavioral Sciences ───────────────────────────────────────────
  {
    key: "psych", real: "Psi Chi Honors Club / Psi Cho (Psychology Club)", type: "SPONSORED", scope: "COLLEGE", college: "sbs",
    department: "Psychology", focusMajor: "Psychology", status: "APPROVED", life: "active", founded: [2022, 9], size: 58, succession: "MEMBER_VOTE",
    color: "#9333ea", topic: "socsci", activity: 0.9,
    meeting: M(3, 17, 0, 60, 1, "SS", "Room 238"),
    related: ["premed", "polisci", "cj"],
  },
  {
    key: "polisci", real: "American Democracy Project (ADP)", type: "REGISTERED", scope: "COLLEGE", college: "sbs",
    focusMajor: "Political Science", status: "APPROVED", life: "active", founded: [2022, 9], size: 40, color: "#b91c1c", topic: "socsci", activity: 0.85,
    meeting: M(2, 12, 0, 60, 1, "SS", "Room 130", "Brown Bag Discussion"),
    related: ["psych", "cj", "modelun"],
  },
  {
    key: "cj", real: "Crime Scene Investigation (CSI) Club", type: "SPONSORED", scope: "COLLEGE", college: "sbs",
    department: "Criminal Justice", focusMajor: "Criminal Justice", status: "APPROVED", life: "active", founded: [2023, 1], size: 32, color: "#334155", topic: "socsci", activity: 0.75,
    meeting: M(2, 17, 0, 60, 2, "SS", "Room 341"),
    related: ["polisci", "psych"],
  },
  {
    key: "modelun", real: "Model United Nations Organization", type: "REGISTERED", scope: "COLLEGE", college: "sbs",
    focusMajor: "Political Science", status: "APPROVED", life: "inactive", founded: [2022, 10], size: 6, color: "#2563eb", topic: "socsci", activity: 0.3,
    meeting: M(4, 16, 0, 60, 2, "SS", "Room 130"),
    related: ["polisci"],
    lastActiveTerm: "Spring 2025",
  },

  // ─── Moyes College of Education ─────────────────────────────────────────────
  {
    key: "educators", real: "Educators Rising", type: "SPONSORED", scope: "COLLEGE", college: "edu",
    department: "Teacher Education", focusMajor: "Elementary Education", status: "APPROVED", life: "active", founded: [2023, 9], size: 34, color: "#16a34a", topic: "education", activity: 0.75,
    meeting: M(3, 16, 30, 60, 2, "ED", "Room 210"),
    related: ["exsci", "service"],
  },
  {
    key: "exsci", real: "Exercise & Nutrition Sciences Club (ENS Club)", type: "SPONSORED", scope: "COLLEGE", college: "edu",
    department: "Kinesiology", focusMajor: "Exercise Science", status: "APPROVED", life: "active", founded: [2023, 1], size: 28, color: "#ea580c", topic: "health", activity: 0.7,
    meeting: M(2, 12, 0, 60, 2, "SG", "Room 202"),
    related: ["educators", "nursing", "ultimate"],
  },

  // ─── Dumke College of Health Professions ────────────────────────────────────
  {
    key: "nursing", real: "National Student Nurses Association (NSNA) Ogden Campus", type: "SPONSORED", scope: "COLLEGE", college: "health",
    department: "Annie Taylor Dee School of Nursing", focusMajor: "Nursing", status: "APPROVED", life: "active", founded: [2022, 9], size: 76, joinPolicy: "APPROVAL",
    color: "#0d9488", topic: "health", activity: 0.9,
    meeting: M(4, 12, 0, 60, 2, "MH", "Room 101"),
    related: ["premed", "dental", "exsci"],
  },
  {
    key: "dental", real: "Student American Dental Hygienists Association (SADHA)", type: "SPONSORED", scope: "COLLEGE", college: "health",
    department: "Dental Hygiene", focusMajor: "Dental Hygiene", status: "APPROVED", life: "active", founded: [2023, 9], size: 24, color: "#0284c7", topic: "health", activity: 0.65,
    meeting: M(2, 12, 0, 50, 2, "MH", "Room 214"),
    related: ["nursing", "premed"],
  },

  // ─── Lindquist College of Arts & Humanities ─────────────────────────────────
  {
    key: "theatre", real: "Associated Artists of the Theatre (AAT)", type: "SPONSORED", scope: "COLLEGE", college: "arts",
    department: "Performing Arts", focusMajor: "Theatre Arts", status: "APPROVED", life: "active", founded: [2022, 9], size: 46, joinPolicy: "APPROVAL",
    color: "#a21caf", topic: "arts", activity: 0.9,
    meeting: M(1, 19, 0, 120, 1, "BC", "Eccles Theater rehearsal hall", "Company Night"),
    related: ["writing", "ceramics", "pride"],
  },
  {
    key: "writing", real: "Metaphor Undergraduate Literary Journal", type: "SPONSORED", scope: "COLLEGE", college: "arts",
    department: "English Language & Literature", focusMajor: "Creative Writing", status: "APPROVED", life: "active", founded: [2023, 1], size: 27, color: "#78350f", topic: "arts", activity: 0.7,
    meeting: M(4, 18, 0, 90, 2, "EH", "Room 229", "Editorial Meeting"),
    related: ["theatre", "anime"],
  },
  {
    key: "ceramics", real: "Art Guild", type: "SPONSORED", scope: "COLLEGE", college: "arts",
    department: "Visual Art & Design", focusMajor: "Art", status: "APPROVED", life: "inactive", founded: [2023, 1], size: 7, color: "#92400e", topic: "arts", activity: 0.35,
    meeting: M(5, 14, 0, 120, 2, "KA", "Ceramics Studio 160", "Open Studio"),
    related: ["theatre", "writing"],
    lastActiveTerm: "Fall 2025",
  },

  // ─── University-wide ────────────────────────────────────────────────────────
  {
    key: "bsu", real: "Black Student Union (BSU)", type: "REGISTERED", scope: "UNIVERSITY", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 52, color: "#111827", topic: "culture", activity: 0.9,
    meeting: M(3, 18, 0, 75, 1, "SU", "Room 404A"),
    related: ["lia", "isa", "pride", "firstgen", "service"],
  },
  {
    key: "lia", real: "Latinos in Action (LIA) Club", type: "REGISTERED", scope: "UNIVERSITY", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 64, color: "#c2410c", topic: "culture", activity: 0.95,
    meeting: M(2, 18, 0, 75, 1, "SU", "Room 316"),
    related: ["bsu", "firstgen", "isa", "service"],
  },
  {
    key: "pride", real: "Gender and Sexuality Alliance (GSA)", type: "REGISTERED", scope: "UNIVERSITY", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 48, color: "#db2777", topic: "culture", activity: 0.85,
    meeting: M(4, 18, 30, 75, 1, "SU", "Room 321"),
    related: ["bsu", "theatre", "service"],
  },
  {
    key: "veterans", real: "Military-Affiliated Club", type: "REGISTERED", scope: "UNIVERSITY", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 28, color: "#3f6212", topic: "service", activity: 0.7,
    meeting: M(5, 12, 0, 60, 2, "SSC", "Room 140"),
    related: ["service", "cj"],
  },
  {
    key: "isa", real: "International Students Committee (ISC)", type: "REGISTERED", scope: "UNIVERSITY", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 80, color: "#0369a1", topic: "culture", activity: 0.95,
    meeting: M(5, 16, 0, 90, 2, "SU", "Room 404B", "Coffee Hour"),
    related: ["bsu", "lia", "service", "anime"],
  },
  {
    key: "service", real: "Wildcat Service Club", type: "REGISTERED", scope: "UNIVERSITY", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 70, color: "#059669", topic: "service", activity: 1.0, autoApproveCohosts: true,
    meeting: M(1, 18, 0, 60, 2, "SU", "Room 316", "Project Planning Night"),
    related: ["bsu", "lia", "veterans", "educators", "premed"],
  },

  // ─── Independent ────────────────────────────────────────────────────────────
  {
    key: "anime", real: "Incredibly Strange Movie Night (ISMN)", type: "REGISTERED", scope: "INDEPENDENT", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 68, color: "#e11d48", topic: "film", activity: 0.9,
    meeting: M(5, 18, 0, 150, 1, "LI", "Room 307", "Screening Night"),
    related: ["chess", "isa", "writing"],
  },
  {
    key: "chess", real: "Chess Club", type: "REGISTERED", scope: "INDEPENDENT", status: "APPROVED", life: "active",
    founded: [2023, 1], size: 26, color: "#404040", topic: "games", activity: 0.75,
    meeting: M(2, 19, 0, 120, 1, "SU", "Room 321", "Club Night"),
    related: ["anime", "math"],
  },

  // ─── Sports & recreation ────────────────────────────────────────────────────
  {
    key: "climbing", real: "Hiking and Outdoors Club", type: "REGISTERED", scope: "SPORTS", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 56, joinPolicy: "APPROVAL", color: "#65a30d", topic: "sports", activity: 1.0,
    meeting: M(4, 19, 0, 90, 1, "SC", "Room 110", "Trip Planning Night"),
    related: ["ski", "ultimate", "pickleball"],
  },
  {
    key: "ultimate", real: "Cornhole Club", type: "AFFILIATE", scope: "SPORTS", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 34, color: "#ca8a04", topic: "sports", activity: 0.85,
    meeting: M(3, 17, 0, 90, 1, "SC", "Court 3", "League Night", "PRACTICE"),
    related: ["climbing", "pickleball", "ski"],
  },
  {
    key: "ski", real: "The Wild", type: "REGISTERED", scope: "SPORTS", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 84, color: "#0ea5e9", topic: "spirit", activity: 0.9,
    meeting: M(3, 19, 0, 60, 2, "SU", "Wildcat Theater", "Club Meeting"),
    related: ["climbing", "ultimate"],
  },

  // ─── Pilot clubs (created this term) ────────────────────────────────────────
  {
    key: "datasci", real: "Data Analytics Club", type: "SPONSORED", scope: "COLLEGE", college: "cos",
    department: "Mathematics", focusMajor: "Data Science", status: "APPROVED", life: "pilot", size: 14, color: "#4f46e5", topic: "tech", activity: 0.8,
    meeting: M(4, 17, 0, 60, 2, "TY", "Room 336"),
    related: ["ailab", "acm", "math"],
  },
  {
    key: "firstgen", real: "First Generation Club at WSU", type: "REGISTERED", scope: "UNIVERSITY", status: "APPROVED", life: "pilot",
    size: 12, color: "#9d174d", topic: "culture", activity: 0.8,
    meeting: M(2, 12, 0, 60, 2, "SSC", "Room 260", "First-Gen Lunch"),
    related: ["lia", "bsu", "service"],
  },
  {
    key: "pickleball", real: "Swing Dance/ Social Dance Club", type: "REGISTERED", scope: "INDEPENDENT", status: "APPROVED", life: "pilot",
    size: 15, color: "#84cc16", topic: "dance", activity: 0.85,
    meeting: M(5, 19, 0, 120, 1, "SG", "Main Gym", "Social Dance Night", "PRACTICE"),
    related: ["climbing", "ultimate"],
  },

  // ─── Retired ────────────────────────────────────────────────────────────────
  {
    key: "photo", real: "Photographic Society", type: "SPONSORED", scope: "COLLEGE", college: "arts",
    department: "Visual Art & Design", focusMajor: "Photography", status: "RETIRED", life: "retired", founded: [2022, 9], size: 0, color: "#57534e", topic: "arts", activity: 0.6,
    meeting: M(3, 17, 30, 90, 2, "KA", "Room 120", "Photo Walk Planning"),
    related: ["ceramics", "theatre"],
    retired: { at: [2025, 4, 30], reason: "Our founding officers graduated and nobody stepped up to lead, so we're closing the club for now." },
  },
  {
    key: "rugby", real: "Ballroom and Hip Hop Club", type: "REGISTERED", scope: "INDEPENDENT", status: "RETIRED", life: "retired", founded: [2022, 9],
    size: 0, color: "#7f1d1d", topic: "dance", activity: 0.6,
    meeting: M(2, 17, 0, 90, 1, "SG", "Main Gym", "Practice", "PRACTICE"),
    related: ["pickleball"],
    retired: { at: [2024, 12, 20], reason: "Too few members to keep regular practices going after our founding officers graduated." },
  },
];

/**
 * Fictional clubs: ambassador orgs (platform structures), clubs that aren't
 * approved, and two approved DEMO clubs that carry the incident stories
 * (reports, review bombing, a hidden review, removals) so nothing negative is
 * invented about a real club.
 */
export const DEMO_CLUB_KEYS = ["paintball", "discgolf"] as const;
const FICTIONAL: (Omit<ClubDef, "slug" | "dir" | "story" | "contactEmail" | "aboutHtml"> & { slug?: string })[] = [
  {
    key: "paintball", name: "Wildcat Paintball Club", category: "STUDENT_LIFE", type: "AFFILIATE", scope: "SPORTS", status: "APPROVED", life: "active",
    founded: [2022, 10], size: 38, joinPolicy: "APPROVAL", color: "#9a3412", topic: "sports", activity: 0.95,
    meeting: M(4, 18, 0, 90, 1, "SC", "Room 110", "Team Meeting"),
    related: ["discgolf"],
    short: "Weekend games at local fields, gear for beginners and a spring scenario game. (Fictional demo club.)",
    about: "Wildcat Paintball Club is a fictional club in the mock data. Members plan weekend games at fields around Ogden, share gear with beginners and run a spring scenario game.",
    does: ["Weekend games at local fields", "Loaner gear for first-timers", "Safety and field-rules briefings", "A spring scenario game"],
    join: "Open to all. An officer approves new members once your field waiver is on file.",
  },
  {
    key: "discgolf", name: "Ogden Valley Disc Golf Club", category: "STUDENT_LIFE", type: "AFFILIATE", scope: "SPORTS", status: "APPROVED", life: "active",
    founded: [2022, 9], size: 44, color: "#3f6212", topic: "sports", activity: 0.9,
    meeting: M(2, 17, 0, 90, 1, "SU", "Room 316", "Weekly Round Planning"),
    related: ["paintball"],
    short: "Weekly rounds, discs to borrow and doubles leagues on courses around Ogden. (Fictional demo club.)",
    about: "Ogden Valley Disc Golf Club is a fictional club in the mock data. Members play weekly rounds on courses around Ogden, run a doubles league and lend discs to beginners.",
    does: ["Weekly rounds", "Fall and spring doubles leagues", "A disc library for beginners"],
  },
  {
    key: "gsbe-amb", name: "Goddard School Ambassadors", category: "ACADEMIC", type: "COLLEGE_AMBASSADORS", scope: "COLLEGE", college: "gsbe",
    status: "APPROVED", life: "ambassadors", founded: [2023, 8], size: 16, color: "#312e81", topic: "ambassadors", activity: 0.7,
    meeting: M(1, 12, 0, 60, 2, "WB", "Room 205", "Ambassador Huddle"),
    related: ["accounting", "marketing", "fic", "entre", "ailab"],
    short: "The Goddard School's student ambassadors — connecting business clubs with the college.",
    about: "Goddard School Ambassadors represent the business school at recruiting events and act as the link between the college and its clubs. Club Representative Ambassadors sit in on each business club so news, needs and opportunities move both ways.",
    does: ["Club representatives embedded in every Goddard School club", "Marketing help for business clubs", "College-wide events and recruiting days"],
    join: "Ambassadors apply each spring; club members can talk to their club's ambassador any time.",
  },
  {
    key: "east-amb", name: "EAST Ambassadors", category: "ACADEMIC", type: "COLLEGE_AMBASSADORS", scope: "COLLEGE", college: "east",
    status: "APPROVED", life: "ambassadors", founded: [2024, 8], size: 14, color: "#1e40af", topic: "ambassadors", activity: 0.7,
    meeting: M(5, 12, 0, 60, 2, "NB", "Room 210", "Ambassador Huddle"),
    related: ["robotics", "swe", "acm", "cyber", "motorsports"],
    short: "EAST's student ambassadors — tours, outreach and a voice for engineering clubs.",
    about: "EAST Ambassadors give tours, staff college events and place a Club Representative Ambassador in each EAST club so clubs always have a direct line to the college.",
    does: ["Club representatives in EAST clubs", "Prospective-student tours of Noorda", "Inter-club coordination so engineering clubs don't double-book"],
    join: "Ambassadors apply each spring.",
  },
  {
    key: "beekeeping", name: "Wildcat Beekeeping Society", category: "STUDENT_LIFE", type: "REGISTERED", scope: "COLLEGE", college: "cos",
    focusMajor: "Botany", status: "DRAFT", life: "draft", size: 0, color: "#eab308", topic: "science", activity: 0,
    meeting: M(3, 16, 0, 60, 2, "TY", "Room 225"),
    related: [],
    short: "",
    about: "We want to keep a couple of hives on campus, learn beekeeping from local experts and",
    does: [],
  },
  {
    key: "boardgames", name: "Wildcat Puzzle Society", category: "STUDENT_LIFE", type: "REGISTERED", scope: "INDEPENDENT", status: "SUBMITTED", life: "submitted",
    size: 0, color: "#7c2d12", topic: "games", activity: 0,
    meeting: M(4, 19, 0, 120, 1, "SU", "Room 321", "Puzzle Night"),
    related: ["chess", "anime"],
    short: "Weekly puzzle nights, a jigsaw lending shelf and a campus-wide puzzle hunt every spring.",
    about: "Wildcat Puzzle Society meets weekly in the Shepherd Union to solve crosswords, logic puzzles and jigsaws together, keeps a lending shelf of puzzles members can borrow, and plans a campus-wide puzzle hunt each spring.",
    does: ["Thursday puzzle nights", "A jigsaw and puzzle-book lending shelf", "The spring Wildcat Puzzle Hunt"],
  },
  {
    key: "aviation", name: "Aviation Club", category: "ACADEMIC", type: "SPONSORED", scope: "COLLEGE", college: "east",
    requestedDepartmentName: "Aviation Technology", status: "CHANGES_REQUESTED", life: "changes", size: 0, color: "#0c4a6e", topic: "tech", activity: 0,
    meeting: M(3, 18, 0, 60, 2, "D2", "Room 110"),
    related: ["motorsports", "robotics"],
    short: "Flight sims, airport tours and ground school study groups.",
    about: "For future pilots, mechanics and anyone who looks up when a plane goes over. We plan to run flight-sim nights, tour Ogden-Hinckley Airport and form ground-school study groups.",
    does: ["Flight simulator nights", "Airport and hangar tours", "Ground school study groups"],
  },
  {
    key: "poker", name: "Campus Poker League", category: "STUDENT_LIFE", type: "REGISTERED", scope: "INDEPENDENT", status: "REJECTED", life: "rejected",
    founded: [2026, 2], size: 0, color: "#991b1b", topic: "games", activity: 0,
    meeting: M(5, 20, 0, 180, 1, "SU", "Room 321"),
    related: [],
    short: "Weekly Texas hold'em tournaments with buy-ins and prizes.",
    about: "A league for students who love poker, with weekly tournaments, buy-ins and a season-end prize pool.",
    does: ["Weekly tournaments", "Season leaderboard and prize pool"],
    rejectedNote: "Thanks for the work you put into this. We can't approve a club built around buy-ins and cash prizes — that's gambling under university policy and Utah law. If you'd like to run a strategy games club without money involved, we'd be glad to review a new submission.",
  },
];

// ─── Directory clubs (everything else on the list) ──────────────────────────

const PALETTE = ["#4b2e83", "#0f766e", "#1d4ed8", "#be123c", "#b45309", "#15803d", "#7c3aed", "#0e7490", "#9333ea", "#c2410c", "#334155", "#0369a1", "#a21caf", "#65a30d", "#db2777", "#ca8a04", "#1e3a8a", "#059669", "#78350f", "#e11d48"];
const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

const PLAIN_ROOM = /^Room /;
const SPORTS_ROOMS: Record<string, string[]> = { SC: ["Court 3", "Room 110"], SG: ["Main Gym", "Room 202"], SU: ["Room 316", "Room 321"] };
const TOPIC_MEETING: Partial<Record<Topic, { title: string; kind?: EventKind; duration?: number; time?: [number, number] }>> = {
  faith: { title: "Weekly Gathering", time: [19, 0] },
  greek: { title: "Chapter Meeting", time: [19, 0] },
  honor: { title: "Chapter Meeting" },
  games: { title: "Game Night", duration: 150, time: [19, 0] },
  music: { title: "Rehearsal", kind: "PRACTICE", duration: 90 },
  dance: { title: "Practice", kind: "PRACTICE", duration: 90, time: [19, 0] },
  sports: { title: "Practice", kind: "PRACTICE", duration: 90 },
  spirit: { title: "Game Day Planning" },
  media: { title: "Staff Meeting" },
  service: { title: "Planning Meeting" },
};
const DEPT_BUILDING: Record<string, string> = { Music: "BC", "Performing Arts": "BC", "Visual Art & Design": "KA", "Automotive Technology": "D3", "Physics & Astronomy": "LL", Kinesiology: "SG" };

function meetingFor(name: string, where: Where, dept: string | null, topic: Topic, life: Life, r: ReturnType<typeof createRng>): Meeting {
  const pool = where === "SP" ? COLLEGE_BUILDINGS.sports : where === "U" || where === "I" ? COLLEGE_BUILDINGS.university : COLLEGE_BUILDINGS[where];
  const building = (dept && DEPT_BUILDING[dept]) ?? r.pick(pool);
  const b = BUILDINGS.find((x) => x.code === building)!;
  const rooms = where === "SP" && SPORTS_ROOMS[building] ? SPORTS_ROOMS[building] : b.rooms.filter((x) => PLAIN_ROOM.test(x));
  const t = TOPIC_MEETING[topic];
  const time: [number, number] = t?.time ?? r.pick([[12, 0], [12, 0], [16, 30], [17, 0], [17, 30], [18, 0], [18, 30]] as [number, number][]);
  return M(r.int(1, 4), time[0], time[1], t?.duration ?? r.pick([50, 60, 60, 75]), life === "active" && r.chance(0.3) ? 1 : 2, building, r.pick(rooms.length ? rooms : b.rooms), t?.title, t?.kind);
}

const OFFICER_SEATS = ["Treasurer", "Secretary", "Events Coordinator", "Communications Officer", "Membership Officer", "Events Coordinator"];

/** Seats held today, from the directory's counts (two VPs at most; extra VPs and other officers fill officer seats). */
function seatPlanFor(o: DirEntry["officers"]): Record<string, number> {
  const plan: Record<string, number> = { President: Math.min(2, o.president ?? 0), "Vice President": Math.min(2, o.vice_president ?? 0) };
  let others = (o.other_officer ?? 0) + Math.max(0, (o.vice_president ?? 0) - 2);
  for (const seat of OFFICER_SEATS) {
    if (others <= 0) break;
    plan[seat] = (plan[seat] ?? 0) + 1;
    others--;
  }
  return plan;
}

function directoryDef(e: DirEntry, r: ReturnType<typeof createRng>): ClubDef {
  const [cat, t, where, dept, topic, major] = SPECS[e.name];
  const category = CAT[cat];
  const life: Life = e.members >= 8 ? "active" : e.members > 0 ? "small" : "dormant";
  // Founded on the platform between fall 2022 and fall 2025 (nobody's in a pilot period by accident);
  // dormant clubs went quiet after spring 2025 at the latest.
  const months = [9, 10, 11, 1, 2, 3];
  const latest = life === "dormant" ? 2024 : 2025;
  const y = r.int(2022, latest);
  let m = r.pick(months);
  if (y === 2022 && m < 9) m = r.pick([9, 10, 11]);
  if (y === latest && life === "dormant" && m >= 9) m = r.pick([1, 2, 3]);
  const founded: [number, number] = [y, m];
  const foundedTerm = m >= 8 ? `Fall ${y}` : `Spring ${y}`;
  let lastActiveTerm: string | undefined;
  if (life === "dormant") {
    const order = ["Fall 2022", "Spring 2023", "Fall 2023", "Spring 2024", "Fall 2024", "Spring 2025"];
    const from = Math.max(0, order.indexOf(foundedTerm));
    lastActiveTerm = order[r.int(Math.max(from, 3), 5)];
  }
  const text = realText(e, category);
  const pledge = /PLEDGE PROCESS REQUIRED|APPROVAL TO JOIN NEEDED/i.test(e.description) || cat === "FSL";
  return {
    key: slugify(e.name),
    slug: slugify(e.name),
    name: e.name,
    dir: e,
    story: false,
    category,
    topic,
    contactEmail: e.email,
    type: TYPE[t],
    scope: SCOPE(where),
    college: where.length > 2 ? (where as CollegeKey) : undefined,
    department: dept ?? undefined,
    focusMajor: major,
    status: "APPROVED",
    life,
    founded,
    size: life === "dormant" ? r.pick([0, 0, 1, 1, 2]) : e.members,
    joinPolicy: pledge ? "APPROVAL" : undefined,
    succession: cat === "FSL" || cat === "HS" ? r.pick(["LEADERSHIP_VOTE", "MEMBER_VOTE"] as SuccessionMethod[]) : r.chance(0.22) ? "MEMBER_VOTE" : undefined,
    color: PALETTE[hash(e.name) % PALETTE.length],
    activity: life === "active" ? r.float(0.55, 0.85) : life === "small" ? r.float(0.4, 0.6) : 0.35,
    meeting: meetingFor(e.name, where, dept, topic, life, r),
    related: [],
    ...text,
    does: [],
    lastActiveTerm,
    seatPlan: life === "dormant" ? {} : seatPlanFor(e.officers),
    advisors: life === "dormant" ? 0 : Math.min(2, e.officers.advisor ?? 0),
  };
}

function storyDef(s: StoryDef): ClubDef {
  const e = dirEntry(s.real);
  const category = CAT[SPECS[s.real][0]];
  const { real: _real, ...rest } = s;
  return { ...rest, slug: slugify(e.name), name: e.name, dir: e, story: true, category, contactEmail: e.email, ...realText(e, category), does: [] };
}

function fictionalDef(f: (typeof FICTIONAL)[number]): ClubDef {
  return { ...f, slug: f.slug ?? slugify(f.name), dir: null, story: true, contactEmail: null, aboutHtml: `<p>${esc(f.about)}</p>` };
}

function buildClubDefs(): ClubDef[] {
  const r = createRng(29202610); // its own stream: club definitions don't shift the seed's main sequence
  const story = STORY.map(storyDef);
  const used = new Set(story.map((d) => d.dir!.name));
  const rest = DIRECTORY.filter((e) => !used.has(e.name)).map((e) => directoryDef(e, r));
  const fictional = FICTIONAL.map(fictionalDef);
  const all = [...story.slice(0, -2), ...rest, ...fictional, ...story.slice(-2)];

  // Related clubs for directory clubs that meet: others in the same college, or sharing a topic.
  const meets = rest.filter((d) => d.life !== "dormant");
  for (const d of meets) {
    const near = meets.filter((x) => x !== d && (d.college ? x.college === d.college : x.topic === d.topic));
    d.related = r.sample(near, Math.min(near.length, 3)).map((x) => x.key);
  }

  const slugs = new Set<string>();
  for (const d of all) {
    if (slugs.has(d.slug)) throw new Error(`Duplicate club slug ${d.slug}`);
    slugs.add(d.slug);
  }
  // Fictional clubs must not borrow a real club's name.
  const realNames = DIRECTORY.map((e) => e.name.toLowerCase());
  for (const f of fictional) {
    const n = f.name.toLowerCase();
    if (realNames.some((x) => x === n || x.includes(n) || n.includes(x))) throw new Error(`Fictional club ${f.name} collides with a real club`);
  }
  return all;
}

export const CLUBS: ClubDef[] = buildClubDefs();

export const clubByKey = (key: string) => {
  const c = CLUBS.find((x) => x.key === key);
  if (!c) throw new Error(`Unknown club key ${key}`);
  return c;
};
