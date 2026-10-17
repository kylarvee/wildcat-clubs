import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/authz", () => ({ CAPABILITIES: { budget: { label: "Budget & funding", description: "" } } }));

import { campusDate } from "@/lib/time";
import { dueInfo } from "./items";

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
