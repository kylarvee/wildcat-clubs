import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/authz", () => ({ CAPABILITIES: { budget: { label: "Budget & funding", description: "" } } }));

import { campusDate } from "@/lib/time";
import { dueInfo, groupJoinRequests } from "./items";

describe("task due dates (campus time)", () => {
  const now = campusDate(2026, 10, 16, 9, 0); // Friday 9:00 AM in Ogden

  it("reads today, tomorrow, weekday, then date", () => {
    expect(dueInfo(campusDate(2026, 10, 16, 23, 59), now)?.label).toBe("Due today");
    expect(dueInfo(campusDate(2026, 10, 17, 23, 59), now)?.label).toBe("Due tomorrow");
    expect(dueInfo(campusDate(2026, 10, 20, 23, 59), now)?.label).toBe("Due Tuesday");
    expect(dueInfo(campusDate(2026, 11, 2, 23, 59), now)?.label).toBe("Due Nov 2");
    expect(dueInfo(campusDate(2027, 1, 12, 23, 59), now)?.label).toBe("Due Jan 12, 2027");
  });

  it("flags overdue in red and soon in amber", () => {
    const late = dueInfo(campusDate(2026, 10, 14, 23, 59), now)!;
    expect(late.overdue).toBe(true);
    expect(late.label).toBe("Overdue · was due Oct 14");
    expect(dueInfo(campusDate(2026, 10, 16, 8, 0), now)?.label).toBe("Overdue · was due today");
    expect(dueInfo(campusDate(2026, 10, 18, 12, 0), now)?.soon).toBe(true);
    expect(dueInfo(campusDate(2026, 10, 25, 12, 0), now)?.soon).toBe(false);
  });

  it("uses the campus day near midnight UTC", () => {
    // 2026-10-17 03:00 UTC is still Oct 16 in Ogden.
    expect(dueInfo(new Date("2026-10-17T03:00:00Z"), now)?.label).toBe("Due today");
    expect(dueInfo(new Date("2026-10-17T03:00:00Z"), now)?.dateInput).toBe("2026-10-16");
  });

  it("returns null without a due date", () => {
    expect(dueInfo(null, now)).toBeNull();
  });
});

describe("groupJoinRequests", () => {
  const now = campusDate(2026, 10, 16, 9, 0);
  const club = { name: "Wildcat Robotics", slug: "wildcat-robotics", logoColor: "#1d4ed8", logoUrl: null };
  const row = (id: string, over: Record<string, unknown> = {}) =>
    ({
      id, kind: "APPROVAL", title: `Person ${id} asked to join Wildcat Robotics`, description: null, assigneeType: "CLUB", assigneeId: null, clubId: "c1", club,
      capability: "roster", href: "/clubs/wildcat-robotics/manage/members", dueAt: null, required: false, status: "OPEN", sourceType: "membership", sourceId: id,
      createdById: null, createdBy: null, createdAt: now, completedAt: null, completedById: null, completedBy: null, assignee: null, ...over,
    }) as unknown as Parameters<typeof groupJoinRequests>[0][number];

  it("collapses a club's join requests into one row where the first one was", () => {
    const items = groupJoinRequests([row("personal", { kind: "PERSONAL", sourceType: null, clubId: null, club: null }), row("a"), row("b"), row("c")], "me", now);
    expect(items.map((i) => i.title)).toEqual(["Person personal asked to join Wildcat Robotics", "3 people asked to join Wildcat Robotics"]);
    expect(items[1].href).toBe("/clubs/wildcat-robotics/manage/members");
  });

  it("leaves a single request alone", () => {
    expect(groupJoinRequests([row("a")], "me", now)[0].title).toBe("Person a asked to join Wildcat Robotics");
  });
});
