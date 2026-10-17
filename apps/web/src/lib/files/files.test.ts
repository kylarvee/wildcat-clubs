import { describe, expect, it } from "vitest";
import { audienceIncludes, canSee, resolveVisibility, type VisNode, type ViewerFacts } from "@/lib/files/visibility";
import { cleanName, nameProblem, splitExt, uniqueName } from "@/lib/files/names";
import { matchesAccept, sortRows, typeAheadIndex } from "@/lib/files/listing";
import { guessMime, servedType } from "@/lib/files/storage";

const tree: Record<string, VisNode> = {
  root: { parentId: null, visibility: "INHERIT" },
  officer: { parentId: null, visibility: "LEADERS" },
  notes: { parentId: "officer", visibility: "INHERIT" },
  deep: { parentId: "notes", visibility: "INHERIT" },
  open: { parentId: "officer", visibility: "PUBLIC" },
  loopA: { parentId: "loopB", visibility: "INHERIT" },
  loopB: { parentId: "loopA", visibility: "INHERIT" },
};
const lookup = (id: string) => tree[id];

const nobody: ViewerFacts = { userId: null, admin: false, member: false, leader: false };
const member: ViewerFacts = { userId: "m", admin: false, member: true, leader: false };
const leader: ViewerFacts = { userId: "l", admin: false, member: true, leader: true };
const outsider: ViewerFacts = { userId: "o", admin: false, member: false, leader: false };
const admin: ViewerFacts = { userId: "a", admin: true, member: false, leader: false };

describe("visibility", () => {
  it("resolves INHERIT through folders, defaulting to members at the top", () => {
    expect(resolveVisibility("root", lookup)).toBe("MEMBERS");
    expect(resolveVisibility("deep", lookup)).toBe("LEADERS");
    expect(resolveVisibility("open", lookup)).toBe("PUBLIC");
    expect(resolveVisibility("missing", lookup)).toBe("MEMBERS");
  });

  it("memoizes every folder on the way up and survives loops", () => {
    const memo = new Map();
    resolveVisibility("deep", lookup, memo);
    expect(memo.get("notes")).toBe("LEADERS");
    expect(resolveVisibility("loopA", lookup)).toBe("MEMBERS");
  });

  it("club audiences", () => {
    expect(audienceIncludes("PUBLIC", "club", nobody)).toBe(true);
    expect(audienceIncludes("MEMBERS", "club", nobody)).toBe(false);
    expect(audienceIncludes("MEMBERS", "club", member)).toBe(true);
    expect(audienceIncludes("MEMBERS", "club", outsider)).toBe(false);
    expect(audienceIncludes("LEADERS", "club", member)).toBe(false);
    expect(audienceIncludes("LEADERS", "club", leader)).toBe(true);
    expect(audienceIncludes("LEADERS", "club", admin)).toBe(true);
  });

  it("personal and university audiences", () => {
    expect(audienceIncludes("MEMBERS", "user", outsider, "someone")).toBe(true);
    expect(audienceIncludes("LEADERS", "user", outsider, "someone")).toBe(false);
    expect(audienceIncludes("LEADERS", "user", outsider, "o")).toBe(true);
    expect(audienceIncludes("MEMBERS", "university", outsider)).toBe(true);
    expect(audienceIncludes("LEADERS", "university", outsider)).toBe(false);
    expect(audienceIncludes("MEMBERS", "university", nobody)).toBe(false);
  });

  it("uploaders and grantees always see their item, signed-out visitors never do", () => {
    expect(canSee({ vis: "LEADERS", kind: "club", viewer: member, createdById: "m", granted: false })).toBe(true);
    expect(canSee({ vis: "LEADERS", kind: "club", viewer: outsider, createdById: "x", granted: true })).toBe(true);
    expect(canSee({ vis: "LEADERS", kind: "club", viewer: outsider, createdById: "x", granted: false })).toBe(false);
    expect(canSee({ vis: "MEMBERS", kind: "club", viewer: nobody, createdById: "x", granted: true })).toBe(false);
  });
});

describe("names", () => {
  it("cleans names", () => {
    expect(cleanName("  Fall   kickoff\n flyer.png ")).toBe("Fall kickoff flyer.png");
    expect(cleanName("a/b\\c")).toBe("a-b-c");
    expect(nameProblem("   ")).toBe("Give it a name.");
    expect(nameProblem("..")).toMatch(/reserved/);
    expect(nameProblem("Minutes")).toBeNull();
  });

  it("splits extensions", () => {
    expect(splitExt("report.final.pdf")).toEqual(["report.final", ".pdf"]);
    expect(splitExt(".env")).toEqual([".env", ""]);
    expect(splitExt("v1.2", true)).toEqual(["v1.2", ""]);
  });

  it("finds a free name like a desktop file manager", () => {
    expect(uniqueName("Flyer.png", ["notes.md"])).toBe("Flyer.png");
    expect(uniqueName("Flyer.png", ["flyer.PNG"])).toBe("Flyer (2).png");
    expect(uniqueName("Flyer.png", ["Flyer.png", "Flyer (2).png"])).toBe("Flyer (3).png");
    expect(uniqueName("Flyer (2).png", ["Flyer (2).png"])).toBe("Flyer (3).png");
    expect(uniqueName("New folder", ["New folder", "New folder 2"], true)).toBe("New folder 3");
  });
});

describe("listing", () => {
  const row = (name: string, extra: Partial<{ isFolder: boolean; mimeType: string | null; sizeBytes: number | null; updatedAt: string }> = {}) => ({
    name,
    isFolder: false,
    mimeType: null,
    sizeBytes: null,
    updatedAt: "2026-10-01T00:00:00Z",
    ...extra,
  });

  it("keeps folders first and sorts names naturally", () => {
    const sorted = sortRows([row("Minutes 10.md"), row("Minutes 2.md"), row("Zeta", { isFolder: true }), row("alpha.pdf")], "name", "asc");
    expect(sorted.map((r) => r.name)).toEqual(["Zeta", "alpha.pdf", "Minutes 2.md", "Minutes 10.md"]);
  });

  it("sorts by size and date, folders still first", () => {
    const rows = [row("a", { sizeBytes: 10 }), row("b", { sizeBytes: 300 }), row("f", { isFolder: true })];
    expect(sortRows(rows, "size", "desc").map((r) => r.name)).toEqual(["f", "b", "a"]);
    const dated = [row("old", { updatedAt: "2025-01-01T00:00:00Z" }), row("new", { updatedAt: "2026-01-01T00:00:00Z" })];
    expect(sortRows(dated, "modified", "desc").map((r) => r.name)).toEqual(["new", "old"]);
  });

  it("filters by what a picker accepts", () => {
    expect(matchesAccept({ isFolder: false, mimeType: "image/png", name: "a.png" }, "image")).toBe(true);
    expect(matchesAccept({ isFolder: false, mimeType: "application/pdf", name: "a.pdf" }, "image")).toBe(false);
    expect(matchesAccept({ isFolder: false, mimeType: "application/pdf", name: "a.pdf" }, "document")).toBe(true);
    expect(matchesAccept({ isFolder: false, mimeType: "video/mp4", name: "a.mp4" }, "document")).toBe(false);
    expect(matchesAccept({ isFolder: true, mimeType: null, name: "Flyers" }, "video")).toBe(true);
  });

  it("type-ahead jumps to the next match and wraps", () => {
    const names = ["Agenda", "Budget", "bylaws", "Constitution"];
    expect(typeAheadIndex(names, "b", 0)).toBe(1);
    expect(typeAheadIndex(names, "b", 2)).toBe(2);
    expect(typeAheadIndex(names, "a", 3)).toBe(0);
    expect(typeAheadIndex(names, "x", 0)).toBe(-1);
  });
});

describe("stored and served types", () => {
  it("takes the stored type from the extension, never the browser's claim", () => {
    expect(guessMime("Flyer.PNG", "text/html")).toBe("image/png");
    expect(guessMime("page.xml", "application/xml")).toBe("application/octet-stream");
    expect(guessMime("noext", "image/png")).toBe("application/octet-stream");
    expect(guessMime("clip.webm")).toBe("video/webm");
  });

  it("shows only safe types in place; text becomes plain text; the rest downloads", () => {
    expect(servedType("application/pdf")).toBe("application/pdf");
    expect(servedType("image/svg+xml")).toBe("image/svg+xml");
    expect(servedType("video/mp4")).toBe("video/mp4");
    expect(servedType("text/markdown")).toBe("text/plain; charset=utf-8");
    expect(servedType("text/html; charset=utf-8")).toBe("text/plain; charset=utf-8");
    for (const risky of ["application/xml", "application/xhtml+xml", "image/svg", "application/octet-stream", "application/javascript", "", null]) {
      expect(servedType(risky)).toBeNull();
    }
  });
});
