import { describe, expect, it } from "vitest";
import { defaultDraftData, draftProblems, normalizeDraftData, SECTIONS, SUCCESSION_OPTIONS, successionOf, joinPolicyOf } from "@/lib/constitution/templates";
import { docToHtml, hasMissing, renderDoc } from "@/lib/constitution/render";
import { renderConstitutionPdf } from "@/lib/constitution/pdf";

const facts = { name: "Weber State Chess Club", type: "REGISTERED" as const, departmentName: null, collegeName: null };

describe("constitution templates", () => {
  it("default draft is complete and adoptable", () => {
    const data = defaultDraftData();
    expect(draftProblems(data)).toEqual([]);
    const c = renderDoc("constitution", data, facts);
    const b = renderDoc("bylaws", data, facts);
    expect(hasMissing(c)).toBe(false);
    expect(hasMissing(b)).toBe(false);
    expect(c.articles.length).toBe(SECTIONS.constitution.filter((s) => s.core || s.defaultOn).length);
    expect(c.articles[0].title).toBe("Name");
    expect(c.title).toBe("Constitution of Weber State Chess Club");
  });

  it("every modular section renders without errors", () => {
    const data = defaultDraftData();
    data.modules.constitution = SECTIONS.constitution.filter((s) => !s.core).map((s) => s.id);
    data.modules.bylaws = SECTIONS.bylaws.filter((s) => !s.core).map((s) => s.id);
    for (const method of ["ADVISOR_PRESIDENT", "NEXT_IN_LINE", "SELF_SELECT", "MEMBER_VOTE"]) {
      data.fields.successionMethod = method;
      for (const type of ["SPONSORED", "AFFILIATE", "REGISTERED"] as const) {
        const html = docToHtml(renderDoc("constitution", data, { ...facts, type, departmentName: "Department of Physics" })) + docToHtml(renderDoc("bylaws", data, facts));
        expect(html).not.toContain("undefined");
        expect(html).not.toContain("[object");
      }
    }
  });

  it("flags missing required fields and marks them in the text", () => {
    const data = defaultDraftData();
    data.fields.purpose = "  ";
    expect(draftProblems(data).map((p) => p.sectionId)).toContain("purpose");
    expect(hasMissing(renderDoc("constitution", data, facts))).toBe(true);
  });

  it("normalizes stored data and reads the auto-implemented settings", () => {
    const data = normalizeDraftData({ modules: { constitution: ["dues", "nope", "name"] }, fields: { joinPolicy: "APPROVAL", successionMethod: "BOGUS", purpose: "To build robots." } });
    expect(data.modules.constitution).toEqual(["dues"]);
    expect(joinPolicyOf(data)).toBe("APPROVAL");
    expect(successionOf(data)).toBe("ADVISOR_PRESIDENT");
    expect(renderDoc("constitution", data, facts).articles[1].blocks[0]).toEqual({ type: "p", text: "The Club exists to build robots." });
  });

  it("offers the four ways to fill a seat, with Advisor & President as the recommended default", () => {
    expect(SUCCESSION_OPTIONS.map((o) => o.value)).toEqual(["ADVISOR_PRESIDENT", "NEXT_IN_LINE", "SELF_SELECT", "MEMBER_VOTE"]);
    expect(SUCCESSION_OPTIONS[0].label).toContain("recommended");
    expect(successionOf(defaultDraftData())).toBe("ADVISOR_PRESIDENT");
  });

  it("reads older drafts' succession values the way existing clubs were moved over", () => {
    expect(successionOf(normalizeDraftData({ fields: { successionMethod: "SENIORITY" } }))).toBe("ADVISOR_PRESIDENT");
    expect(successionOf(normalizeDraftData({ fields: { successionMethod: "LEADERSHIP_VOTE" } }))).toBe("SELF_SELECT");
    expect(successionOf(normalizeDraftData({ fields: { successionMethod: "NEXT_IN_LINE" } }))).toBe("NEXT_IN_LINE");
  });

  it("names one primary method in the bylaws and leaves the others to the President and advisor", () => {
    for (const method of ["ADVISOR_PRESIDENT", "NEXT_IN_LINE", "SELF_SELECT", "MEMBER_VOTE"] as const) {
      const data = defaultDraftData({ successionMethod: method });
      const section = renderDoc("bylaws", data, facts).articles.find((a) => a.title === "Succession Method")!;
      const text = section.blocks.map((b) => (b.type === "p" ? b.text : b.items.join(" "))).join(" ");
      const name = SUCCESSION_OPTIONS.find((o) => o.value === method)!.label.replace(" (recommended)", "");
      expect(text).toContain(`The Club's primary method is ${name}.`);
      expect(text).toContain("The President and the advisor may instead use one of these other methods for a particular seat, at their discretion");
      const others = section.blocks.find((b) => b.type === "list");
      expect(others?.type === "list" ? others.items.length : 0).toBe(3);
    }
  });

  it("renders a PDF", async () => {
    const data = defaultDraftData();
    const pdf = await renderConstitutionPdf(renderDoc("bylaws", data, facts), { adoptedOn: new Date("2026-10-16T18:00:00Z"), version: 2 });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
    // PDF_OUT=dir writes samples for eyeballing the layout.
    if (process.env.PDF_OUT) {
      const { writeFile } = await import("node:fs/promises");
      const all = { ...data, modules: { constitution: SECTIONS.constitution.filter((s) => !s.core).map((s) => s.id), bylaws: SECTIONS.bylaws.filter((s) => !s.core).map((s) => s.id) } };
      await writeFile(`${process.env.PDF_OUT}/constitution.pdf`, await renderConstitutionPdf(renderDoc("constitution", all, { ...facts, type: "SPONSORED", departmentName: "Department of Computer Science", collegeName: "College of Engineering, Applied Science & Technology" }), { adoptedOn: new Date(), version: 1 }));
      await writeFile(`${process.env.PDF_OUT}/bylaws-draft.pdf`, await renderConstitutionPdf(renderDoc("bylaws", all, facts)));
    }
  }, 30000);
});
