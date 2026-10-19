import { describe, expect, it } from "vitest";
import { activitySubject } from "./subject";

describe("activity subject", () => {
  it("is data.userId, or an applied election's winner", () => {
    expect(activitySubject({ userId: "u1", role: "OFFICER" })).toBe("u1");
    expect(activitySubject({ title: "President — Spring 2027", winnerId: "u2" })).toBe("u2");
    expect(activitySubject({ userId: "u1", winnerId: "u2" })).toBe("u1");
  });

  it("is null when the row isn't about one person", () => {
    expect(activitySubject(undefined)).toBeNull();
    expect(activitySubject(null)).toBeNull();
    expect(activitySubject({ title: "Bake sale" })).toBeNull();
    expect(activitySubject(["u1"])).toBeNull();
    expect(activitySubject({ userId: 42 })).toBeNull();
    expect(activitySubject({ userId: "" })).toBeNull();
  });
});
