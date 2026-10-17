import { describe, expect, it } from "vitest";
import { buildView, groupOf, parseNetworkGroup, parseNetworkWindow, topConnections, type NetworkClub } from "./network-model";

const club = (id: string, p: Partial<NetworkClub> = {}): NetworkClub => ({
  id,
  name: `Club ${id}`,
  slug: `club-${id}`,
  type: "REGISTERED",
  scope: "COLLEGE",
  collegeId: "sci",
  collegeName: "College of Science",
  departmentName: null,
  majorName: null,
  size: 10,
  members: 5,
  ...p,
});

const colleges = [
  { id: "sci", name: "College of Science", shortName: "Science" },
  { id: "east", name: "College of Engineering, Applied Science & Technology", shortName: "EAST" },
];

describe("buildView", () => {
  const clubs = [club("a"), club("b"), club("c", { collegeId: "east", collegeName: "EAST" }), club("d", { collegeId: null, collegeName: null, scope: "SPORTS" })];
  const lines = [
    { source: "a", target: "b", weight: 7 },
    { source: "a", target: "c", weight: 3 },
    { source: "b", target: "c", weight: 2 },
    { source: "c", target: "d", weight: 1 },
  ];

  it("passes clubs through, heaviest lines first", () => {
    const v = buildView(clubs, lines, "club", colleges);
    expect(v.nodes.map((n) => n.key)).toEqual(["a", "b", "c", "d"]);
    expect(v.edges.map((e) => e.weight)).toEqual([7, 3, 2, 1]);
    expect(v.nodes[0].href).toBe("/clubs/club-a");
  });

  it("sums sizes and line weights by college, dropping lines inside a group", () => {
    const v = buildView(clubs, lines, "college", colleges);
    const sci = v.nodes.find((n) => n.key === "college:sci")!;
    expect(sci).toMatchObject({ kind: "group", size: 20, members: 10, clubIds: ["a", "b"], short: "Science" });
    expect(v.nodes.find((n) => n.key === "scope:SPORTS")?.label).toBe("Club sports");
    // a–b is inside Science; a–c + b–c merge into one Science–EAST line.
    expect(v.edges).toEqual([
      { source: "college:east", target: "college:sci", weight: 5 },
      { source: "college:east", target: "scope:SPORTS", weight: 1 },
    ]);
  });

  it("groups by department and major case-insensitively, with a bucket for blanks", () => {
    const cs = [club("a", { departmentName: "Physics" }), club("b", { departmentName: "physics " }), club("c")];
    expect(groupOf(cs[1], "department", new Map()).key).toBe("department:physics");
    expect(buildView(cs, [], "department", colleges).nodes.map((n) => n.label)).toEqual(["No department", "Physics"]);
    expect(groupOf(cs[2], "major", new Map()).label).toBe("No focus major");
  });
});

describe("helpers", () => {
  it("lists a node's strongest lines", () => {
    const edges = [
      { source: "a", target: "b", weight: 2 },
      { source: "c", target: "a", weight: 9 },
      { source: "b", target: "c", weight: 4 },
    ];
    expect(topConnections("a", edges)).toEqual([
      { key: "c", weight: 9 },
      { key: "b", weight: 2 },
    ]);
  });
  it("falls back to the defaults for unknown windows and groupings", () => {
    expect(parseNetworkWindow("term")).toBe("term");
    expect(parseNetworkWindow("decade")).toBe("12m");
    expect(parseNetworkGroup(undefined)).toBe("club");
  });
});
