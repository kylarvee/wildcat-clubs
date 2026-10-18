import type { FundingSource, FundingStatus, Prisma } from "@prisma/client";
import type { ClubM, Ctx, Ev } from "../ctx";
import { isQuiet } from "../data/clubs";
import { addDays, minDate } from "../lib/dates";

/**
 * Budgets and funding. Event costs come from the Events Builder (event-linked
 * BudgetItems; recurring items multiply by the term's occurrences), general
 * costs from the Budget tool. Funding requests exist in every status, with
 * snapshot items, invoices and the admin tasks that go with them.
 */

const CATEGORY: Record<string, string> = {
  Pizza: "Food", Snacks: "Food", Catering: "Food", Refreshments: "Food", Appetizers: "Food", Lunch: "Food", "Plated dinner": "Food",
};

export function defaultSource(club: ClubM): FundingSource {
  if (club.type === "COLLEGE_AMBASSADORS") return "COLLEGE";
  if (club.type === "REGISTERED") return "WSUSA";
  return club.departmentId ? "DEPARTMENT" : "WSUSA";
}

type Item = Prisma.BudgetItemCreateManyInput & { occurrences: number; eventTitle: string | null };

export function buildFunding(ctx: Ctx) {
  const { rng, NOW } = ctx;
  const items: Item[] = [];
  const current = ctx.termFor(NOW);
  const next = ctx.terms.find((t) => t.startsOn > current.endsOn && t.countsForActivity)!;
  const budgetFrom = ctx.term("Spring 2025").startsOn;

  const treasurerOr = (club: ClubM, at: Date) => ctx.holderAt(club, "Treasurer", at) ?? ctx.leaderAt(club, at);
  const addItem = (club: ClubM, termId: string, description: string, category: string, quantity: number, unitCents: number, opts: { ev?: Ev; perOccurrence?: boolean; at: Date; source?: FundingSource; by?: string }) => {
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
      addItem(club, ev.termId, desc, CATEGORY[desc] ?? "Supplies", qty, Math.round(dollars * 100), { ev, at: ev.createdAt, by: ev.createdById });
    }
    // Meeting snacks on some clubs' current series (multiplied by occurrences).
    const series = club.events.find((e) => e.isSeries && e.termId === current.id);
    if (series && club.status === "APPROVED" && rng.chance(0.4)) {
      addItem(club, current.id, "Snacks for meetings", "Food", 1, rng.pick([2000, 2500, 3500, 4500]), { ev: series, perOccurrence: true, at: series.createdAt });
    }
  }

  // General costs from the Budget tool.
  const general: [string, string, number, number][] = [
    ["Club T-shirts", "Apparel", 40, 1250],
    ["Involvement Fair banner", "Printing", 1, 8500],
    ["Flyer printing", "Printing", 200, 15],
    ["Competition registration", "Registration", 1, 45000],
    ["Conference registration", "Registration", 4, 17500],
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
  let invoiceSeq = new Map<number, number>();
  const invoiceRows: { at: Date; row: Prisma.InvoiceCreateManyInput; task: Prisma.TaskCreateManyInput; club: string }[] = [];

  const request = (
    clubKey: string,
    termName: string,
    title: string,
    status: FundingStatus,
    lines: [string, string, number, number][],
    o: { submittedDaysAgo?: number; decidedDaysAgo?: number; approvedShare?: number; invoice?: "OPEN" | "PROCESSED"; note?: string; justification?: string; by?: string; useEventItems?: boolean },
  ) => {
    const club = ctx.club(clubKey);
    const term = ctx.term(termName);
    const createdAt = o.submittedDaysAgo !== undefined ? addDays(NOW, -o.submittedDaysAgo - rng.float(1, 6)) : addDays(term.startsOn, rng.float(5, 20));
    const submittedAt = status === "DRAFT" ? null : o.submittedDaysAgo !== undefined ? addDays(NOW, -o.submittedDaysAgo) : addDays(createdAt, rng.float(1, 4));
    const by = o.by ?? treasurerOr(club, submittedAt ?? createdAt);
    const own = lines.map(([d, c, q, u]) => addItem(club, term.id, d, c, q, u, { at: createdAt, by }));
    const evItems = o.useEventItems ? items.filter((i) => i.clubId === club.id && i.termId === term.id && i.eventId && !own.includes(i)).slice(0, 3) : [];
    const chosen = [...own, ...evItems];
    const total = (i: Item) => Math.round(Number(i.quantity) * i.unitCostCents * i.occurrences);
    const requested = chosen.reduce((s, i) => s + total(i), 0);
    const decided = ["APPROVED", "PARTIALLY_APPROVED", "DENIED", "WITHDRAWN"].includes(status);
    const decidedAt = decided ? (o.decidedDaysAgo !== undefined ? addDays(NOW, -o.decidedDaysAgo) : addDays(submittedAt!, rng.float(3, 12))) : null;
    const approved = status === "APPROVED" ? requested : status === "PARTIALLY_APPROVED" ? Math.round((requested * (o.approvedShare ?? 0.6)) / 100) * 100 : null;
    const decider = decidedAt && status !== "WITHDRAWN" ? (decidedAt < new Date("2025-06-01T00:00:00Z") ? rng.pick([jordan, rosa]) : rng.pick([alex, rosa])) : null;
    const id = ctx.id();
    ctx.rows.fundingRequests.push({
      id, clubId: club.id, termId: term.id, title, justification: o.justification ?? null, fundingSource: defaultSource(club),
      amountRequestedCents: requested, amountApprovedCents: approved, status, submittedById: by, submittedAt, decidedById: decider, decidedAt,
      decisionNote: o.note ?? (status === "APPROVED" ? "Approved as submitted. Keep receipts and send them to WSUSA within 30 days of purchase." : null),
      createdAt,
    });
    for (const i of chosen) {
      ctx.rows.fundingItems.push({
        id: ctx.id(), requestId: id, budgetItemId: i.id as string, description: i.description, eventTitle: i.eventTitle, quantity: Number(i.quantity),
        unitCostCents: i.unitCostCents, occurrences: i.occurrences, totalCents: total(i),
      });
    }
    if (submittedAt) ctx.activity({ at: submittedAt, actorId: by, action: "funding.submitted", entityType: "fundingRequest", entityId: id, clubId: club.id, data: { title, cents: requested } });
    if (status === "SUBMITTED") {
      ctx.rows.tasks.push({
        id: ctx.id(), kind: "APPROVAL", title: `Funding request from ${club.name}: ${title}`, description: `${(requested / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} requested from ${defaultSource(club) === "WSUSA" ? "WSUSA" : "the department"}.`,
        assigneeType: "ADMINS", clubId: club.id, href: "/admin/funding", status: "OPEN", sourceType: "funding", sourceId: id, createdById: by, createdAt: submittedAt!,
      });
    }
    if (decidedAt && submittedAt && status !== "WITHDRAWN") {
      ctx.rows.tasks.push({
        id: ctx.id(), kind: "APPROVAL", title: `Funding request from ${club.name}: ${title}`, assigneeType: "ADMINS", clubId: club.id, href: "/admin/funding",
        status: "DONE", sourceType: "funding", sourceId: id, createdById: by, createdAt: submittedAt, completedAt: decidedAt, completedById: decider,
      });
      ctx.activity({ at: decidedAt, actorId: decider, action: `funding.${status.toLowerCase()}`, entityType: "fundingRequest", entityId: id, clubId: club.id, data: { cents: approved ?? 0 } });
    }
    if (o.invoice && approved) {
      const at = addDays(decidedAt!, 0.01);
      const processedAt = o.invoice === "PROCESSED" ? minDate(addDays(at, rng.float(2, 9)), addDays(NOW, -0.5)) : null;
      const invoiceId = ctx.id();
      const task: Prisma.TaskCreateManyInput = {
        id: ctx.id(), kind: "INVOICE", title: "", description: "Make sure the payment goes through in the university's financial system, then mark the invoice processed.",
        assigneeType: "ADMINS", clubId: club.id, href: "/admin/funding", dueAt: addDays(at, 10), status: processedAt ? "DONE" : "OPEN", sourceType: "invoice", sourceId: invoiceId,
        createdById: decider, createdAt: at, completedAt: processedAt, completedById: processedAt ? decider : null,
      };
      ctx.rows.tasks.push(task);
      invoiceRows.push({ at, row: { id: invoiceId, number: "", requestId: id, amountCents: approved, status: o.invoice, createdById: decider!, createdAt: at, processedAt }, task, club: club.name });
    }
    return id;
  };

  const oscar = ctx.p("oscar").id;
  const cur = current.name;
  const nxt = next.name;
  const prevTerms = ctx.terms.filter((t) => t.countsForActivity && t.startsOn >= ctx.term("Fall 2024").startsOn && t.endsOn < current.startsOn).map((t) => t.name);
  const lastSpring = prevTerms.filter((n) => n.startsWith("Spring")).at(-1)!;
  const lastFall = prevTerms.filter((n) => n.startsWith("Fall")).at(-1)!;

  // Oscar (Wildcat Investors): one submitted, one draft, plus history.
  request("fic", lastSpring, "Spring Stock Pitch Competition", "APPROVED", [["Prize gift cards", "Supplies", 3, 5000], ["Judges' lunch", "Food", 8, 1400]], { invoice: "PROCESSED" });
  ctx.refs.oscarSubmitted = request("fic", cur, "Fall speaker series", "SUBMITTED", [["Speaker thank-you gifts", "Supplies", 3, 3500], ["Refreshments for speaker nights", "Food", 3, 9000], ["Flyer printing", "Printing", 150, 15]], {
    submittedDaysAgo: 5.2, by: oscar, useEventItems: true,
    justification: "Three evening talks with Wasatch Front finance professionals. We expect 35–50 students at each based on last year's attendance.",
  });
  ctx.refs.oscarDraft = request("fic", nxt, `${nxt} Stock Pitch Competition`, "DRAFT", [["Prize gift cards", "Supplies", 3, 5000], ["Judges' lunch", "Food", 8, 1400], ["Printed pitch books", "Printing", 30, 450]], {
    by: oscar, justification: "Annual competition — draft, still collecting quotes.",
  });

  request("robotics", lastSpring, "Build season materials", "APPROVED", [["Aluminum stock and fasteners", "Supplies", 1, 68000], ["Motor controllers", "Equipment", 6, 8900]], { invoice: "PROCESSED" });
  ctx.refs.roboticsOpenInvoiceRequest = request("robotics", cur, "Combat robotics competition travel", "APPROVED", [["Van rental (2 vans, 4 days)", "Travel", 2, 48000], ["Hotel rooms", "Travel", 5, 32000], ["Robot shipping crate", "Supplies", 1, 26000]], {
    submittedDaysAgo: 16.1, decidedDaysAgo: 9.3, invoice: "OPEN", justification: "Eight members take two bots to an intercollegiate combat robotics competition.",
  });
  request("premed", cur, "MCAT prep books for the lending library", "PARTIALLY_APPROVED", [["MCAT prep book sets", "Supplies", 12, 9500]], {
    submittedDaysAgo: 27.4, decidedDaysAgo: 20.2, approvedShare: 0.5, invoice: "PROCESSED",
    note: "Approved for six sets. WSUSA funds books for a shared lending library; please check them out through the club rather than giving them away.",
  });
  request("anime", cur, "Film festival passes", "DENIED", [["Festival day passes", "Registration", 20, 9000]], {
    submittedDaysAgo: 22, decidedDaysAgo: 15.1, note: "Festival passes for members are personal entertainment, which WSUSA funding can't cover. A fundraiser or a club-run screening event would be a good alternative.",
  });
  request("swe", lastFall, "SWE national conference registration", "APPROVED", [["Conference registration", "Registration", 4, 17500], ["Shared hotel rooms", "Travel", 2, 54000]], { invoice: "PROCESSED" });
  ctx.refs.sweSubmitted = request("swe", cur, "Girls in STEM Robot Day supplies", "SUBMITTED", [["Mentor T-shirts", "Apparel", 20, 1100], ["Lunch for volunteers", "Food", 30, 900]], { submittedDaysAgo: 3.2, useEventItems: true });
  request("nursing", cur, "Pinning ceremony", "SUBMITTED", [["Venue setup", "Venue", 1, 35000], ["Programs printing", "Printing", 120, 75], ["Reception refreshments", "Food", 1, 42000]], { submittedDaysAgo: 1.1 });
  ctx.refs.bsuOpenInvoiceRequest = request("bsu", cur, "Unity Week catering", "APPROVED", [["Catering", "Food", 1, 40000], ["Decorations", "Supplies", 1, 9000]], { submittedDaysAgo: 8.3, decidedDaysAgo: 4.2, invoice: "OPEN" });
  request("theatre", lastSpring, "Spring production rights & set materials", "APPROVED", [["Performance rights", "Registration", 1, 65000], ["Lumber and paint", "Supplies", 1, 24000]], { invoice: "PROCESSED" });
  request("theatre", cur, "Costume rentals", "WITHDRAWN", [["Costume rentals", "Supplies", 12, 4500]], { submittedDaysAgo: 18, decidedDaysAgo: 14, note: "Withdrawn by the club — costumes were donated." });
  request("acm", nxt, "Wildcat Hackathon 2027", "DRAFT", [["Hackathon meals", "Food", 120, 1200], ["Prizes", "Supplies", 3, 15000]], {});
  // A spread of approved requests across past terms (admin analytics).
  const history: [string, string, string, [string, string, number, number][], FundingStatus][] = [
    ["lia", "Fall 2024", "Día de los Muertos celebration", [["Pan dulce & cocoa", "Food", 1, 20000], ["Decorations", "Supplies", 1, 8000]], "APPROVED"],
    ["isa", "Fall 2024", "International Night", [["Catering", "Food", 1, 90000], ["Sound system rental", "Equipment", 1, 25000]], "PARTIALLY_APPROVED"],
    ["service", "Spring 2025", "Care kit drive", [["Care kit supplies", "Supplies", 150, 600]], "APPROVED"],
    ["ski", "Spring 2025", "Away game bus tickets", [["Bus seats", "Travel", 15, 4500]], "DENIED"],
    ["climbing", "Fall 2025", "Wilderness first aid clinic", [["Certification fees", "Registration", 12, 2500]], "APPROVED"],
    ["psych", "Fall 2025", "Mental health awareness week", [["Printing", "Printing", 300, 25], ["Refreshments", "Food", 1, 15000]], "APPROVED"],
    ["accounting", "Spring 2026", "Meet the Firms night", [["Refreshments", "Food", 1, 22000]], "APPROVED"],
    ["marketing", "Fall 2025", "Agency tour transportation", [["Van rental", "Travel", 1, 18000]], "APPROVED"],
    ["chess", "Spring 2026", "Tournament clocks", [["Digital chess clocks", "Equipment", 8, 4200]], "APPROVED"],
    ["pride", "Spring 2026", "Drag bingo fundraiser supplies", [["Bingo supplies & prizes", "Supplies", 1, 16000]], "APPROVED"],
    ["acm", "Spring 2026", "Wildcat Hackathon 2026", [["Hackathon meals", "Food", 100, 1100], ["Prizes", "Supplies", 3, 12000]], "APPROVED"],
  ];
  for (const [key, term, title, lines, status] of history) {
    if (!ctx.terms.some((t) => t.name === term) || ctx.term(term).startsOn > NOW) continue;
    request(key, term, title, status, lines, {
      invoice: status === "APPROVED" || status === "PARTIALLY_APPROVED" ? "PROCESSED" : undefined,
      note: status === "DENIED" ? "Tickets for individual members to attend games aren't eligible. A club event open to every student is — resubmit it as one." : status === "PARTIALLY_APPROVED" ? "Approved for catering; please use the Shepherd Union's sound system at no charge." : undefined,
    });
  }

  // Invoice numbers in order of creation: WC-<year>-0001…
  invoiceRows.sort((a, b) => a.at.getTime() - b.at.getTime());
  invoiceSeq = new Map();
  for (const { at, row, task, club } of invoiceRows) {
    const y = at.getUTCFullYear();
    const n = (invoiceSeq.get(y) ?? 0) + 1;
    invoiceSeq.set(y, n);
    row.number = `WC-${y}-${String(n).padStart(4, "0")}`;
    task.title = `Process invoice ${row.number} for ${club}`;
    ctx.rows.invoices.push(row);
  }
  const open = invoiceRows.filter((x) => x.row.status === "OPEN").map((x) => x.row.number);
  ctx.refs.openInvoices = open.join(", ");

  ctx.rows.budgetItems.push(...items.map(({ occurrences: _o, eventTitle: _t, ...row }) => row));
}
