import type { FundingSource, FundingStatus, Prisma } from "@prisma/client";
import { COST_CATEGORIES } from "@/lib/events/labels";
import { sourceName, type SourceContext } from "@/lib/funding/labels";
import { lineCents } from "@/lib/funding/math";
import { INVOICE_DUE_DAYS } from "@/lib/funding/review";
import { fmtMoney } from "@/lib/time";
import type { ClubM, Ctx, Ev } from "../ctx";
import { isQuiet } from "../data/clubs";
import { addDays, addHours, minDate } from "../lib/dates";

/**
 * Budgets and funding. Event costs come from the Events Builder (event-linked
 * BudgetItems; recurring items multiply by the term's occurrences), general
 * costs from the Budget tool, and every category is one the cost pickers
 * offer (COST_CATEGORIES). Funding requests exist in every status, with
 * snapshot items and WSUSA's line-by-line decisions. As in lib/domain/funding,
 * an approval records the source that funded it and creates its invoice and
 * INVOICE task in the same step, and a line funded for less than it asked
 * stays free to ask another source for the rest.
 *
 * Stories: Wildcat Investors' Involvement Fair booth was partly approved (the
 * banner wasn't funded), so Oscar asked the college for the banner; the
 * Hiking and Outdoors Club's request is past WSUSA's review time; BSU's
 * invoice is past due. The "Funding follow-ups" job reminds WSUSA about those
 * two once each.
 */

type Category = (typeof COST_CATEGORIES)[number];
/** [description, category (from the pickers' list), quantity, unit cost in cents] */
type Line = [string, Category, number, number];

/** Events Builder cost lines (data/text.ts) by description; anything not listed is Supplies. */
const EVENT_COST_CATEGORY: Record<string, Category> = {
  Snacks: "Food & drink",
  Pizza: "Food & drink",
  Refreshments: "Food & drink",
  "Showcase snacks & drinks": "Food & drink",
  "Popcorn & drinks": "Food & drink",
  "Plated dinner": "Food & drink",
  "Pan dulce & cocoa": "Food & drink",
  "Lunch for build sprint": "Food & drink",
  Lunch: "Food & drink",
  "Ice cream social": "Food & drink",
  "Hot chocolate bar": "Food & drink",
  "Food & drinks": "Food & drink",
  Catering: "Food & drink",
  "Burgers & drinks": "Food & drink",
  Appetizers: "Food & drink",
  "Van rental": "Travel",
  "Lane rental": "Venue",
  "Sound system rental": "Equipment",
  "Projector rental": "Equipment",
  "Programs printing": "Printing & marketing",
  Printing: "Printing & marketing",
  Prizes: "Prizes & awards",
  "Prize gift cards": "Prizes & awards",
  "Certificates & cords": "Prizes & awards",
  "Instructor fee": "Speaker or honorarium",
  Photographer: "Speaker or honorarium",
  "Tournament fees": "Other",
  "Certification cards": "Other",
};

export function defaultSource(club: ClubM): FundingSource {
  if (club.type === "COLLEGE_AMBASSADORS") return "COLLEGE";
  if (club.type === "REGISTERED") return "WSUSA";
  return club.departmentId ? "DEPARTMENT" : "WSUSA";
}

type Item = Prisma.BudgetItemCreateManyInput & { id: string; occurrences: number; eventTitle: string | null };

type RequestOpts = {
  submittedDaysAgo?: number;
  decidedDaysAgo?: number;
  /** PARTIALLY_APPROVED: cents WSUSA approved for each of the request's own lines, in order (null = in full). */
  approve?: (number | null)[];
  /** The source the club expects (default: its usual one). */
  expects?: FundingSource;
  /** Approvals: the source that funded it (default: the one the club expects). */
  fundedBy?: FundingSource;
  /** Approvals: where the invoice stands (default PROCESSED). */
  invoice?: "OPEN" | "PROCESSED";
  note?: string;
  justification?: string;
  by?: string;
  useEventItems?: boolean;
  /** Cost lines already in the budget to ask for again (what an earlier request didn't fund). */
  again?: Item[];
};

export function buildFunding(ctx: Ctx) {
  const { rng, NOW } = ctx;
  const items: Item[] = [];
  const current = ctx.termFor(NOW);
  const next = ctx.terms.find((t) => t.startsOn > current.endsOn && t.countsForActivity)!;
  const budgetFrom = ctx.term("Spring 2025").startsOn;

  const treasurerOr = (club: ClubM, at: Date) => ctx.holderAt(club, "Treasurer", at) ?? ctx.leaderAt(club, at);
  const addItem = (club: ClubM, termId: string, description: string, category: Category, quantity: number, unitCents: number, opts: { ev?: Ev; perOccurrence?: boolean; at: Date; source?: FundingSource; by?: string }) => {
    const occ = opts.ev ? (opts.perOccurrence ? opts.ev.occurrences.filter((o) => o.status === "SCHEDULED").length : 1) : 1;
    const item: Item = {
      id: ctx.id(), clubId: club.id, eventId: opts.ev?.id ?? null, termId, description, category, quantity, unitCostCents: unitCents,
      perOccurrence: opts.ev ? Boolean(opts.perOccurrence) : false, fundingSource: opts.source ?? defaultSource(club),
      createdById: opts.by ?? treasurerOr(club, opts.at), createdAt: minDate(opts.at, NOW), occurrences: occ, eventTitle: opts.ev?.title ?? null,
    };
    items.push(item);
    return item;
  };

  // Event costs from the Events Builder.
  for (const club of ctx.clubs.filter((c) => c.approvedAt)) {
    for (const ev of club.events) {
      if (!ev.cost || !ev.termId || !ev.startsAt || ev.startsAt < budgetFrom) continue;
      const [desc, qty, dollars] = ev.cost;
      addItem(club, ev.termId, desc, EVENT_COST_CATEGORY[desc] ?? "Supplies", qty, Math.round(dollars * 100), { ev, at: ev.createdAt, by: ev.createdById });
    }
    // Meeting snacks on some clubs' current series (multiplied by occurrences).
    const series = club.events.find((e) => e.isSeries && e.termId === current.id);
    if (series && club.status === "APPROVED" && rng.chance(0.4)) {
      addItem(club, current.id, "Snacks for meetings", "Food & drink", 1, rng.pick([2000, 2500, 3500, 4500]), { ev: series, perOccurrence: true, at: series.createdAt });
    }
  }

  // General costs from the Budget tool.
  const general: Line[] = [
    ["Club T-shirts", "Printing & marketing", 40, 1250],
    ["Involvement Fair banner", "Printing & marketing", 1, 8500],
    ["Flyer printing", "Printing & marketing", 200, 15],
    ["Competition registration", "Other", 1, 45000],
    ["Conference registration", "Other", 4, 17500],
    ["Supplies bin restock", "Supplies", 1, 12000],
  ];
  for (const club of ctx.clubs.filter((c) => c.status === "APPROVED" && !isQuiet(c.def.life))) {
    for (const term of [current, next]) {
      for (const [desc, cat, q, u] of rng.sample(general, club.def.life === "small" ? rng.int(0, 1) : rng.int(0, 2))) {
        addItem(club, term.id, desc, cat, q, u, { at: term === current ? addDays(current.startsOn, rng.float(3, 30)) : addDays(NOW, -rng.float(1, 12)) });
      }
    }
  }

  // ─── Funding requests ──────────────────────────────────────────────────────
  const alex = ctx.p("alex").id;
  const rosa = ctx.refs["admin:rosa"];
  const jordan = ctx.refs["admin:jordan"];
  const departmentName = new Map([...ctx.departments].map(([name, d]) => [d.id, name]));
  const sources = (club: ClubM): SourceContext => ({
    department: club.departmentId ? { name: departmentName.get(club.departmentId) ?? "" } : null,
    college: club.collegeKey ? { name: ctx.colleges.get(club.collegeKey)?.name ?? "" } : null,
  });
  /** What approved requests granted for each cost line, per term (a line funded in part asks only for the rest). */
  const granted = new Map<string, number>();
  type InvoiceRow = { at: Date; row: Prisma.InvoiceCreateManyInput; processedAt: Date | null; task: Prisma.TaskCreateManyInput; clubId: string; fundedBy: string; decider: string };
  const invoiceRows: InvoiceRow[] = [];

  const request = (clubKey: string, termName: string, title: string, status: FundingStatus, lines: Line[], o: RequestOpts) => {
    const club = ctx.club(clubKey);
    const term = ctx.term(termName);
    const createdAt = o.submittedDaysAgo !== undefined ? addDays(NOW, -o.submittedDaysAgo - rng.float(1, 6)) : addDays(term.startsOn, rng.float(5, 20));
    const submittedAt = status === "DRAFT" ? null : o.submittedDaysAgo !== undefined ? addDays(NOW, -o.submittedDaysAgo) : addDays(createdAt, rng.float(1, 4));
    const by = o.by ?? treasurerOr(club, submittedAt ?? createdAt);
    const own = lines.map(([d, c, q, u]) => addItem(club, term.id, d, c, q, u, { at: createdAt, by }));
    const evItems = o.useEventItems ? items.filter((i) => i.clubId === club.id && i.termId === term.id && i.eventId && !own.includes(i)).slice(0, 3) : [];
    const chosen = [...own, ...evItems, ...(o.again ?? [])];
    const key = (i: Item) => `${term.id}:${i.id}`;
    // Snapshot totals: the line's cost, less what earlier approvals funded of it.
    const asked = chosen.map((i) => Math.max(0, lineCents(Number(i.quantity), i.unitCostCents) * i.occurrences - (granted.get(key(i)) ?? 0)));
    const requested = asked.reduce((s, c) => s + c, 0);
    const decided = ["APPROVED", "PARTIALLY_APPROVED", "DENIED", "WITHDRAWN"].includes(status);
    const decidedAt = decided ? (o.decidedDaysAgo !== undefined ? addDays(NOW, -o.decidedDaysAgo) : addDays(submittedAt!, rng.float(3, 12))) : null;
    const isApproval = status === "APPROVED" || status === "PARTIALLY_APPROVED";
    // WSUSA's decision line by line: null until decided, 0 = not funded.
    const lineApproved = chosen.map((i, k) => {
      if (status === "APPROVED") return asked[k];
      if (status === "PARTIALLY_APPROVED") return o.approve?.[own.indexOf(i)] ?? asked[k];
      return status === "DENIED" ? 0 : null;
    });
    if (status === "PARTIALLY_APPROVED" && !lineApproved.some((a, k) => (a ?? 0) < asked[k])) throw new Error(`Partly approved “${title}” needs a line approved for less than it asked (opts.approve).`);
    const approved = isApproval ? lineApproved.reduce<number>((s, a) => s + (a ?? 0), 0) : null;
    const expects = o.expects ?? defaultSource(club);
    const fundedSource = isApproval ? (o.fundedBy ?? expects) : null;
    const decider = decidedAt && status !== "WITHDRAWN" ? (decidedAt < new Date("2025-06-01T00:00:00Z") ? rng.pick([jordan, rosa]) : rng.pick([alex, rosa])) : null;
    const id = ctx.id();
    ctx.rows.fundingRequests.push({
      id, clubId: club.id, termId: term.id, title, justification: o.justification ?? null, fundingSource: expects, fundedSource,
      amountRequestedCents: requested, amountApprovedCents: approved, status, submittedById: by, submittedAt, decidedById: decider, decidedAt,
      decisionNote: o.note ?? (status === "APPROVED" ? "Approved as submitted. Keep receipts and send them to WSUSA within 30 days of purchase." : null),
      createdAt,
    });
    chosen.forEach((i, k) => {
      ctx.rows.fundingItems.push({
        id: ctx.id(), requestId: id, budgetItemId: i.id, description: i.description, eventTitle: i.eventTitle, quantity: Number(i.quantity),
        unitCostCents: i.unitCostCents, occurrences: i.occurrences, totalCents: asked[k], approvedCents: lineApproved[k],
      });
      if (isApproval) granted.set(key(i), (granted.get(key(i)) ?? 0) + (lineApproved[k] ?? 0));
    });

    const expected = sourceName(expects, sources(club));
    if (submittedAt) ctx.activity({ at: submittedAt, actorId: by, action: "funding.submitted", entityType: "fundingRequest", entityId: id, clubId: club.id, data: { title, cents: requested, source: expects } });
    if (status === "SUBMITTED") {
      // The approval task opens the moment the request is submitted (lib/funding/review reads its age).
      ctx.rows.tasks.push({
        id: ctx.id(), kind: "APPROVAL", title: `Funding request from ${club.name}: ${title}`,
        description: `${fmtMoney(requested)} for ${term.name}. The club expects it from ${expected}; record the source that funds it when you approve.`,
        assigneeType: "ADMINS", clubId: club.id, href: `/admin/funding/${id}`, status: "OPEN", sourceType: "funding", sourceId: id, createdById: by, createdAt: submittedAt!,
      });
    }
    if (decidedAt && submittedAt) {
      if (status !== "WITHDRAWN") {
        ctx.rows.tasks.push({
          id: ctx.id(), kind: "APPROVAL", title: `Funding request from ${club.name}: ${title}`, assigneeType: "ADMINS", clubId: club.id, href: `/admin/funding/${id}`,
          status: "DONE", sourceType: "funding", sourceId: id, createdById: by, createdAt: submittedAt, completedAt: decidedAt, completedById: decider,
        });
      }
      ctx.activity({ at: decidedAt, actorId: decider ?? by, action: `funding.${status.toLowerCase()}`, entityType: "fundingRequest", entityId: id, clubId: club.id, data: { title, requested, cents: approved ?? 0, source: fundedSource } });
    }
    if (isApproval && approved) {
      // Approving creates the invoice and its INVOICE task in the same step (lib/domain/funding).
      const at = decidedAt!;
      const processedAt = (o.invoice ?? "PROCESSED") === "PROCESSED" ? minDate(addDays(at, rng.float(2, 9)), addDays(NOW, -0.5)) : null;
      const invoiceId = ctx.id();
      const task: Prisma.TaskCreateManyInput = {
        id: ctx.id(), kind: "INVOICE", title: `Make sure funding for ${club.name} — ${title} goes through in the university finance system`, description: "",
        assigneeType: "ADMINS", clubId: club.id, href: `/admin/funding/${id}`, dueAt: addDays(at, INVOICE_DUE_DAYS), status: processedAt ? "DONE" : "OPEN", sourceType: "invoice", sourceId: invoiceId,
        createdById: decider, createdAt: at, completedAt: processedAt, completedById: processedAt ? decider : null,
      };
      ctx.rows.tasks.push(task);
      invoiceRows.push({
        at, processedAt, task, clubId: club.id, fundedBy: sourceName(fundedSource!, sources(club)), decider: decider!,
        row: { id: invoiceId, number: "", requestId: id, amountCents: approved, status: processedAt ? "PROCESSED" : "OPEN", createdById: decider!, createdAt: at, processedAt },
      });
    }
    return { id, own };
  };

  const oscar = ctx.p("oscar").id;
  const cur = current.name;
  const nxt = next.name;
  const prevTerms = ctx.terms.filter((t) => t.countsForActivity && t.startsOn >= ctx.term("Fall 2024").startsOn && t.endsOn < current.startsOn).map((t) => t.name);
  const lastSpring = prevTerms.filter((n) => n.startsWith("Spring")).at(-1)!;
  const lastFall = prevTerms.filter((n) => n.startsWith("Fall")).at(-1)!;

  // Oscar (Wildcat Investors): history, one partly approved request and the banner it didn't fund asked of the college, one submitted, one draft.
  request("fic", lastSpring, "Spring Stock Pitch Competition", "APPROVED", [["Prize gift cards", "Prizes & awards", 3, 5000], ["Judges' lunch", "Food & drink", 8, 1400]], {});
  const booth = request("fic", cur, "Involvement Fair booth", "PARTIALLY_APPROVED", [["Booth T-shirts", "Printing & marketing", 30, 1250], ["Booth giveaways (stickers and pens)", "Supplies", 1, 9000], ["Retractable club banner", "Printing & marketing", 1, 18500]], {
    submittedDaysAgo: 13.2, decidedDaysAgo: 7.1, by: oscar, approve: [null, null, 0], invoice: "OPEN",
    justification: "A booth at the Involvement Fair, where most of our new members find us: shirts for the six members staffing it, giveaways, and a banner we'd reuse at every event.",
    note: "Approved the T-shirts and giveaways. A banner lasts for years, so WSUSA doesn't fund one from a single event's request; the Goddard School funds club marketing, so ask them for it.",
  });
  ctx.refs.oscarPartial = booth.id;
  ctx.refs.oscarAskAgain = request("fic", cur, "Club banner", "SUBMITTED", [], {
    submittedDaysAgo: 1.6, by: oscar, expects: "COLLEGE", again: [booth.own[2]],
    justification: "WSUSA funded our Involvement Fair booth but not the banner (see “Involvement Fair booth”). It goes to every event we run, so we're asking the Goddard School, which funds club marketing.",
  }).id;
  ctx.refs.oscarSubmitted = request("fic", cur, "Fall speaker series", "SUBMITTED", [["Speaker thank-you gifts", "Speaker or honorarium", 3, 3500], ["Refreshments for speaker nights", "Food & drink", 3, 9000], ["Flyer printing", "Printing & marketing", 150, 15]], {
    submittedDaysAgo: 5.2, by: oscar, useEventItems: true,
    justification: "Three evening talks with Wasatch Front finance professionals. We expect 35–50 students at each based on last year's attendance.",
  }).id;
  ctx.refs.oscarDraft = request("fic", nxt, `${nxt} Stock Pitch Competition`, "DRAFT", [["Prize gift cards", "Prizes & awards", 3, 5000], ["Judges' lunch", "Food & drink", 8, 1400], ["Printed pitch books", "Printing & marketing", 30, 450]], {
    by: oscar, justification: "Annual competition — draft, still collecting quotes.",
  }).id;

  request("robotics", lastSpring, "Build season materials", "APPROVED", [["Aluminum stock and fasteners", "Supplies", 1, 68000], ["Motor controllers", "Equipment", 6, 8900]], {});
  ctx.refs.roboticsOpenInvoiceRequest = request("robotics", cur, "Combat robotics competition travel", "APPROVED", [["Van rental (2 vans, 4 days)", "Travel", 2, 48000], ["Hotel rooms", "Travel", 5, 32000], ["Robot shipping crate", "Supplies", 1, 26000]], {
    submittedDaysAgo: 16.1, decidedDaysAgo: 9.3, invoice: "OPEN", justification: "Eight members take two bots to an intercollegiate combat robotics competition.",
  }).id;
  request("premed", cur, "MCAT prep books for the lending library", "PARTIALLY_APPROVED", [["MCAT prep book sets", "Supplies", 12, 9500]], {
    submittedDaysAgo: 27.4, decidedDaysAgo: 20.2, approve: [57000],
    note: "Approved for six sets. WSUSA funds books for a shared lending library; please check them out through the club rather than giving them away.",
  });
  request("anime", cur, "Film festival passes", "DENIED", [["Festival day passes", "Other", 20, 9000]], {
    submittedDaysAgo: 22, decidedDaysAgo: 15.1, note: "Festival passes for members are personal entertainment, which WSUSA funding can't cover. A fundraiser or a club-run screening event would be a good alternative.",
  });
  request("swe", lastFall, "SWE national conference registration", "APPROVED", [["Conference registration", "Other", 4, 17500], ["Shared hotel rooms", "Travel", 2, 54000]], {
    fundedBy: "WSUSA", note: "Approved. WSUSA's conference travel fund covers this one, so it comes from WSUSA rather than the department. Keep receipts and send them to WSUSA within 30 days.",
  });
  ctx.refs.sweSubmitted = request("swe", cur, "Girls in STEM Robot Day supplies", "SUBMITTED", [["Mentor T-shirts", "Supplies", 20, 1100], ["Lunch for volunteers", "Food & drink", 30, 900]], { submittedDaysAgo: 3.2, useEventItems: true }).id;
  request("nursing", cur, "Pinning ceremony", "SUBMITTED", [["Venue setup", "Venue", 1, 35000], ["Programs printing", "Printing & marketing", 120, 75], ["Reception refreshments", "Food & drink", 1, 42000]], { submittedDaysAgo: 1.1 });
  // In WSUSA review longer than its review time (10 business days): an urgent row in the WSUSA queue.
  ctx.refs.lateReviewRequest = request("climbing", cur, "Avalanche awareness course", "SUBMITTED", [["Avalanche course instructor", "Speaker or honorarium", 1, 60000], ["Beacon and probe rentals", "Equipment", 12, 1500]], {
    submittedDaysAgo: 18.4,
    justification: "A one-day avalanche awareness course before the winter backcountry trips, open to every student who signs up. Twelve spots, with rental beacons for anyone who doesn't own one.",
  }).id;
  // Its invoice is past its due date (10 days after the approval): urgent in the WSUSA queue.
  ctx.refs.bsuOpenInvoiceRequest = request("bsu", cur, "Unity Week catering", "APPROVED", [["Catering", "Food & drink", 1, 40000], ["Decorations", "Supplies", 1, 9000]], { submittedDaysAgo: 19.3, decidedDaysAgo: 13.4, invoice: "OPEN" }).id;
  request("theatre", lastSpring, "Spring production rights & set materials", "APPROVED", [["Performance rights", "Other", 1, 65000], ["Lumber and paint", "Supplies", 1, 24000]], {
    fundedBy: "COLLEGE", note: "Approved. The college covers production rights for student productions, so this is funded by the college.",
  });
  request("theatre", cur, "Costume rentals", "WITHDRAWN", [["Costume rentals", "Supplies", 12, 4500]], { submittedDaysAgo: 18, decidedDaysAgo: 14, note: "Withdrawn by the club — costumes were donated." });
  request("acm", nxt, "Wildcat Hackathon 2027", "DRAFT", [["Hackathon meals", "Food & drink", 120, 1200], ["Prizes", "Prizes & awards", 3, 15000]], {});
  // A spread of decided requests across past terms (admin analytics).
  const history: { key: string; term: string; title: string; lines: Line[]; status: FundingStatus; approve?: (number | null)[]; note?: string }[] = [
    { key: "lia", term: "Fall 2024", title: "Día de los Muertos celebration", lines: [["Pan dulce & cocoa", "Food & drink", 1, 20000], ["Decorations", "Supplies", 1, 8000]], status: "APPROVED" },
    {
      key: "isa", term: "Fall 2024", title: "International Night", lines: [["Catering", "Food & drink", 1, 90000], ["Sound system rental", "Equipment", 1, 25000]], status: "PARTIALLY_APPROVED", approve: [null, 0],
      note: "Approved for catering; please use the Shepherd Union's sound system at no charge.",
    },
    { key: "service", term: "Spring 2025", title: "Care kit drive", lines: [["Care kit supplies", "Supplies", 150, 600]], status: "APPROVED" },
    {
      key: "ski", term: "Spring 2025", title: "Away game bus tickets", lines: [["Bus seats", "Travel", 15, 4500]], status: "DENIED",
      note: "Tickets for individual members to attend games aren't eligible. A club event open to every student is — resubmit it as one.",
    },
    { key: "climbing", term: "Fall 2025", title: "Wilderness first aid clinic", lines: [["Certification fees", "Other", 12, 2500]], status: "APPROVED" },
    { key: "psych", term: "Fall 2025", title: "Mental health awareness week", lines: [["Printing", "Printing & marketing", 300, 25], ["Refreshments", "Food & drink", 1, 15000]], status: "APPROVED" },
    { key: "accounting", term: "Spring 2026", title: "Meet the Firms night", lines: [["Refreshments", "Food & drink", 1, 22000]], status: "APPROVED" },
    { key: "marketing", term: "Fall 2025", title: "Agency tour transportation", lines: [["Van rental", "Travel", 1, 18000]], status: "APPROVED" },
    { key: "chess", term: "Spring 2026", title: "Tournament clocks", lines: [["Digital chess clocks", "Equipment", 8, 4200]], status: "APPROVED" },
    { key: "pride", term: "Spring 2026", title: "Drag bingo fundraiser supplies", lines: [["Bingo supplies & prizes", "Prizes & awards", 1, 16000]], status: "APPROVED" },
    { key: "acm", term: "Spring 2026", title: "Wildcat Hackathon 2026", lines: [["Hackathon meals", "Food & drink", 100, 1100], ["Prizes", "Prizes & awards", 3, 12000]], status: "APPROVED" },
  ];
  for (const h of history) {
    if (!ctx.terms.some((t) => t.name === h.term) || ctx.term(h.term).startsOn > NOW) continue;
    request(h.key, h.term, h.title, h.status, h.lines, { approve: h.approve, note: h.note });
  }

  // Invoice numbers in order of creation: WC-<year>-0001…
  invoiceRows.sort((a, b) => a.at.getTime() - b.at.getTime());
  const invoiceSeq = new Map<number, number>();
  for (const x of invoiceRows) {
    const y = x.at.getUTCFullYear();
    const n = (invoiceSeq.get(y) ?? 0) + 1;
    invoiceSeq.set(y, n);
    const number = `WC-${y}-${String(n).padStart(4, "0")}`;
    const cents = x.row.amountCents;
    x.row.number = number;
    x.task.description = `Invoice ${number} · ${fmtMoney(cents)}, funded by ${x.fundedBy}. Mark the invoice processed once the transfer shows up.`;
    ctx.rows.invoices.push(x.row);
    ctx.activity({ at: x.at, actorId: x.decider, action: "invoice.created", entityType: "invoice", entityId: x.row.id!, clubId: x.clubId, data: { number, cents, requestId: x.row.requestId } });
    if (x.processedAt) ctx.activity({ at: x.processedAt, actorId: x.decider, action: "invoice.processed", entityType: "invoice", entityId: x.row.id!, clubId: x.clubId, data: { number, cents } });
  }

  // Oscar's bell: the booth's partial approval and its invoice, as lib/domain/funding sends them.
  const boothRow = ctx.rows.fundingRequests.find((r) => r.id === booth.id)!;
  const boothInvoice = invoiceRows.find((x) => x.row.requestId === booth.id)!.row;
  const decidedAt = boothRow.decidedAt as Date;
  const boothHref = `/clubs/${ctx.club("fic").slug}/manage/budget/requests/${booth.id}`;
  ctx.rows.notifications.push(
    {
      id: ctx.id(), userId: oscar, kind: "funding.partially_approved", title: `Funding partly approved: ${boothRow.title}`,
      body: `WSUSA approved ${fmtMoney(boothRow.amountApprovedCents ?? 0)} of the ${fmtMoney(boothRow.amountRequestedCents ?? 0)} requested, funded by WSUSA. 1 line got less than asked; it's free again, so you can ask another source for the rest. ${boothRow.decisionNote}`,
      href: boothHref, createdAt: decidedAt, readAt: addHours(decidedAt, 3),
    },
    {
      id: ctx.id(), userId: oscar, kind: "invoice.created", title: `Invoice ${boothInvoice.number} is ready`,
      body: `It covers the ${fmtMoney(boothInvoice.amountCents)} approved for “${boothRow.title}”. WSUSA is sending it through the university finance system.`,
      href: boothHref, createdAt: decidedAt, readAt: addHours(decidedAt, 3),
    },
  );

  // For the printed persona summary (summary.ts).
  const submitted = ctx.rows.fundingRequests.filter((r) => r.status === "SUBMITTED").length;
  const open = invoiceRows.filter((x) => !x.processedAt).length;
  ctx.refs.oscarFunding = "budget items; Involvement Fair booth partly approved (banner not funded, now asked of the college as “Club banner”), Fall speaker series in WSUSA review, one DRAFT";
  ctx.refs.alexFunding = `${submitted} funding requests in review (1 past review time), ${open} open invoices (1 past due)`;

  ctx.rows.budgetItems.push(...items.map(({ occurrences: _o, eventTitle: _t, ...row }) => row));
}
