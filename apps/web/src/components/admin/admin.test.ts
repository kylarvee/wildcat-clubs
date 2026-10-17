import { describe, expect, it } from "vitest";
import { ANONYMITY_NOTICE, COMPLAINT_CATEGORIES, normalizeCaseCode } from "@/components/admin/complaint-copy";
import { activityLabel } from "@/components/admin/users/labels";

describe("case codes", () => {
  it("accepts codes however people type them", () => {
    expect(normalizeCaseCode("WC-7KQ2-48")).toBe("WC-7KQ2-48");
    expect(normalizeCaseCode(" wc-7kq2-48 ")).toBe("WC-7KQ2-48");
    expect(normalizeCaseCode("WC 7KQ2 48")).toBe("WC-7KQ2-48");
    expect(normalizeCaseCode("wc7kq248")).toBe("WC-7KQ2-48");
  });
  it("rejects anything that isn't a case code", () => {
    for (const bad of ["", "WC-7KQ2", "WC-7KQ2-4", "XX-7KQ2-48", "WC-7KQ2-4A", "WC-7KQ22-48"]) expect(normalizeCaseCode(bad), bad).toBeNull();
  });
});

describe("report wording", () => {
  it("offers exactly the categories in the brief", () => {
    expect(COMPLAINT_CATEGORIES.map((c) => c.value)).toEqual(["Hazing", "Discrimination or harassment", "Misuse of funds", "Safety", "Review bombing", "Other policy violation"]);
  });
  it("shows the full anonymity notice", () => {
    expect(ANONYMITY_NOTICE).toContain("may not be shared outside university administrators and the proper authorities under WSU policy");
    expect(ANONYMITY_NOTICE).toContain("Do not try to identify the reporter");
  });
});

describe("activity labels", () => {
  it("uses plain words for common actions and a readable fallback for the rest", () => {
    expect(activityLabel("attendance.checkin")).toBe("Checked in to an event");
    expect(activityLabel("constitution.draft_saved")).toBe("Constitution: draft saved");
    expect(activityLabel("solo")).toBe("Solo");
  });
});
