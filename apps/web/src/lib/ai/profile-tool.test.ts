import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * update_my_profile: updateProfile replaces every field, so the tool must
 * start from the saved profile and change only what was asked — and the card
 * must show exactly those changes.
 */

const MAJORS = [
  { id: "m-cs", name: "Computer Science" },
  { id: "m-math", name: "Mathematics" },
];
let saved: unknown[] = [];
let user: Record<string, unknown> = {};

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: async () => structuredClone(user) },
    major: {
      findMany: async ({ where }: { where: { name: { contains: string } } }) => MAJORS.filter((m) => m.name.toLowerCase().includes(where.name.contains.toLowerCase())),
    },
  },
}));
vi.mock("@/lib/domain/profiles", () => ({
  updateProfile: async (_actor: unknown, input: unknown) => {
    saved.push(input);
    return { id: "u1", handle: "sam", name: "Sam Rivera" };
  },
}));

import { findTool, validateCall } from "@/lib/ai/tools";
import type { Prepared, WriteTool } from "@/lib/ai/tool-kit";

const student = { id: "u1", email: "sam@mail.weber.edu", name: "Sam Rivera", handle: "sam", kind: "STUDENT", platformRole: "USER", status: "ACTIVE", avatarColor: "#000", avatarUrl: null } as never;
const staff = { ...(student as object), kind: "FACULTY_STAFF" } as never;
const alumni = { ...(student as object), status: "ALUMNI" } as never;

async function prepare(actor: never, input: unknown): Promise<Prepared> {
  const checked = validateCall("update_my_profile", input);
  if (!checked.ok) throw new Error(checked.error);
  return (findTool("update_my_profile") as WriteTool).prepare({ actor, now: new Date() }, checked.input as never);
}

beforeEach(() => {
  saved = [];
  user = {
    name: "Sam Rivera",
    handle: "sam",
    pronouns: "they/them",
    headline: "Old headline",
    aboutHtml: "<p>Hi, <strong>I build robots</strong>.</p>",
    jobTitle: null,
    classYear: 2027,
    linkedinUrl: "https://www.linkedin.com/in/sam",
    avatarUrl: "/api/files/photo1",
    majors: [{ majorId: "m-cs", isMinor: false, major: { name: "Computer Science" } }],
  };
});

describe("update_my_profile", () => {
  it("changes only the fields asked for and keeps the rest as saved", async () => {
    const p = await prepare(student, { headline: "CS junior who builds robots" });
    expect(p.card.details[0]).toBe("Headline: “Old headline” → “CS junior who builds robots”.");
    expect(p.card.details).toHaveLength(2);
    expect(p.card.preview).toBeUndefined();
    const done = await p.execute();
    expect(saved).toEqual([
      {
        name: "Sam Rivera",
        avatarUrl: "/api/files/photo1",
        pronouns: "they/them",
        headline: "CS junior who builds robots",
        aboutHtml: "<p>Hi, <strong>I build robots</strong>.</p>",
        linkedinUrl: "https://www.linkedin.com/in/sam",
        jobTitle: null,
        classYear: 2027,
        majors: [{ majorId: "m-cs", isMinor: false }],
      },
    ]);
    expect(done.href).toBe("/u/sam");
  });

  it("replaces majors with names from the list, clears with empty values, and previews a new About", async () => {
    const p = await prepare(student, { majors: [{ name: "computer science" }, { name: "Mathematics", minor: true }], pronouns: "", about: "Robotics, chess and coffee.\n\nAsk me about Wildcat Robotics." });
    expect(p.card.details).toContain("Majors and minors: “Computer Science (major)” → “Computer Science (major), Mathematics (minor)”.");
    expect(p.card.details).toContain("Pronouns: cleared (was “they/them”).");
    expect(p.card.preview?.text).toBe("Robotics, chess and coffee.\n\nAsk me about Wildcat Robotics.");
    await p.execute();
    expect(saved[0]).toMatchObject({
      pronouns: null,
      aboutHtml: "<p>Robotics, chess and coffee.</p><p>Ask me about Wildcat Robotics.</p>",
      majors: [
        { majorId: "m-cs", isMinor: false },
        { majorId: "m-math", isMinor: true },
      ],
    });
  });

  it("refuses unknown majors, no-op changes, wrong-account fields and alumni", async () => {
    await expect(prepare(student, { majors: [{ name: "Underwater Basket Weaving" }] })).rejects.toThrow(/doesn't match one major/);
    await expect(prepare(student, { majors: [{ name: "c" }] })).rejects.toThrow(/doesn't match one major/);
    await expect(prepare(student, { headline: "Old headline", majors: [{ name: "Computer Science" }] })).rejects.toThrow(/nothing to change/);
    await expect(prepare(staff, { class_year: 2027 })).rejects.toThrow(/student accounts/);
    await expect(prepare(student, { job_title: "Professor" })).rejects.toThrow(/faculty and staff/);
    await expect(prepare(alumni, { headline: "New" })).rejects.toThrow(/retired/);
    expect(saved).toEqual([]);
  });
});
