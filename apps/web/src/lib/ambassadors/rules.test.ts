import { describe, expect, it } from "vitest";
import { requestBlocker } from "./rules";

const base = {
  clubType: "REGISTERED",
  clubStatus: "APPROVED",
  hasProgram: true,
  collegeName: "College of Science",
  hasOpenRequest: false,
  canManageOrgChart: true,
};

describe("requestBlocker", () => {
  it("lets an approved club's org-chart managers ask their college's program", () => {
    expect(requestBlocker(base)).toBeNull();
  });

  it("never lets an ambassador program ask for ambassadors", () => {
    expect(requestBlocker({ ...base, clubType: "COLLEGE_AMBASSADORS" })).toMatch(/place ambassadors/);
  });

  it("waits for WSUSA approval", () => {
    expect(requestBlocker({ ...base, clubStatus: "DRAFT" })).toMatch(/once WSUSA approves/);
  });

  it("names the college when it has no program", () => {
    expect(requestBlocker({ ...base, hasProgram: false })).toBe("College of Science doesn't have an ambassador program yet. WSUSA starts them, one per college.");
    expect(requestBlocker({ ...base, hasProgram: false, collegeName: null })).toMatch(/isn't linked to a college/);
  });

  it("allows one open request at a time", () => {
    expect(requestBlocker({ ...base, hasOpenRequest: true })).toMatch(/with the ambassador program/);
  });

  it("is only for leaders who manage the org chart", () => {
    expect(requestBlocker({ ...base, canManageOrgChart: false })).toMatch(/manage the org chart/);
  });
});
