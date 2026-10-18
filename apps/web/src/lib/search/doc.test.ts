import { describe, expect, test } from "vitest";
import { buildClubDoc, MAX_PASSAGES, PASSAGE_CHARS, type ClubDocSource } from "@/lib/search/doc";

const source = (over: Partial<ClubDocSource> = {}): ClubDocSource => ({
  club: {
    id: "c1",
    slug: "wrecker-bots",
    name: "RC Wrecker Bots Club",
    type: "REGISTERED",
    category: "ACADEMIC",
    scope: "COLLEGE",
    shortDescription: "We build battle bots.",
    descriptionHtml: "<p>We build battle bots and teach <strong>soldering</strong>.</p>",
    focus: "Electrical Engineering",
    college: { name: "College of Engineering, Applied Science & Technology", shortName: "EAST" },
    department: "Electrical & Computer Engineering",
  },
  seats: ["President", "Build Captain"],
  events: [
    { id: "e1", title: "Girls in STEM Robot Day", descriptionHtml: "<p>Robots for local high schoolers.</p>", campusOnly: false },
    { id: "e2", title: "Officer budget night", descriptionHtml: "<p>Campus accounts only.</p>", campusOnly: true },
  ],
  announcements: [{ id: "a1", title: "Welding night moved", bodyHtml: "<p>Now in the makerspace.</p>" }],
  documents: [
    { id: "d1", kind: "CONSTITUTION", title: "Constitution", contentHtml: "<h2>Article I</h2><p>The club shall be called RC Wrecker Bots.</p>" },
    { id: "d2", kind: "OTHER", title: "Safety handbook", contentHtml: null },
  ],
  reviews: [{ id: "r1", body: "Best club for hands-on welding." }],
  files: ["Makerspace Safety Checklist.pdf"],
  ...over,
});

describe("what a club's search document holds", () => {
  test("each weight gets its fields", () => {
    const d = buildClubDoc(source());
    expect(d.public.a).toContain("RC Wrecker Bots Club");
    expect(d.public.b).toContain("Academic");
    expect(d.public.b).toContain("Electrical Engineering");
    expect(d.public.b).toContain("EAST");
    expect(d.public.b).toContain("We build battle bots.");
    expect(d.public.c).toContain("soldering");
    expect(d.public.c).toContain("Build Captain");
    expect(d.public.c).toContain("Girls in STEM Robot Day");
    expect(d.public.d).toContain("Welding night moved");
    expect(d.public.d).toContain("shall be called");
    expect(d.public.d).toContain("Safety handbook");
    expect(d.public.d).toContain("hands-on welding");
    expect(d.public.d).toContain("Makerspace Safety Checklist");
    expect(d.public.d).not.toContain(".pdf");
  });

  test("campus-only events stay out of the public document and are flagged in passages", () => {
    const d = buildClubDoc(source());
    expect(Object.values(d.public).join(" ")).not.toContain("Officer budget night");
    expect(d.campusC).toContain("Officer budget night");
    const p = d.passages.filter((x) => x.kind === "event");
    expect(p.find((x) => x.title === "Officer budget night")?.campusOnly).toBe(true);
    expect(p.find((x) => x.title === "Girls in STEM Robot Day")?.campusOnly).toBe(false);
    expect(d.passages.filter((x) => x.kind !== "event").every((x) => !x.campusOnly)).toBe(true);
  });

  test("every passage links to where its text lives", () => {
    const d = buildClubDoc(source());
    const href = (kind: string) => d.passages.find((p) => p.kind === kind)?.href;
    expect(href("event")).toBe("/events/e1");
    expect(href("announcement")).toBe("/clubs/wrecker-bots#announcements");
    expect(href("constitution")).toBe("/clubs/wrecker-bots#resources");
    expect(href("about")).toBe("/clubs/wrecker-bots#about");
    expect(href("review")).toBe("/clubs/wrecker-bots#reviews");
    expect(href("seats")).toBe("/clubs/wrecker-bots#org-chart");
  });

  test("passages are trimmed and capped", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `e${i}`, title: `Event ${i}`, descriptionHtml: `<p>${"long text ".repeat(150)}</p>`, campusOnly: false }));
    const d = buildClubDoc(source({ events: many }));
    expect(d.passages.length).toBeLessThanOrEqual(MAX_PASSAGES);
    expect(d.passages.every((p) => p.text.length <= PASSAGE_CHARS)).toBe(true);
    expect(d.passages.every((p) => !/[\u0000-\u001f]/.test(p.text + p.title))).toBe(true);
  });

  test("a series repeated every term counts once", () => {
    const repeat = { title: "General Meeting", descriptionHtml: "<p>Weekly.</p>", campusOnly: false };
    const d = buildClubDoc(source({ events: [{ id: "x1", ...repeat }, { id: "x2", ...repeat }] }));
    expect(d.public.c.match(/General Meeting/g)).toHaveLength(1);
    expect(d.passages.filter((p) => p.kind === "event")).toHaveLength(1);
  });

  test("an event with only a title is still a passage (its title is what matches)", () => {
    const d = buildClubDoc(source({ events: [{ id: "t", title: "Soldering 101", descriptionHtml: null, campusOnly: false }] }));
    expect(d.passages.find((p) => p.kind === "event")).toMatchObject({ title: "Soldering 101", text: "" });
  });
});
