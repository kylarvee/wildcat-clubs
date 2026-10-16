import { describe, expect, it } from "vitest";
import { CHECKIN_PASS_MAX_AGE_MS, checkinPass, checkinPath, checkinToken, isCheckinPass, tokenWindow, verifyCheckinPass, verifyCheckinToken, verifyScanProof } from "./token";

const secret = "TESTSECRETTESTSECRETTESTSECRET23";
const rotate = 30;
const now = Date.UTC(2026, 9, 17, 0, 15, 7);

describe("rotating QR tokens", () => {
  it("accepts the current window and the two before it", () => {
    const w = tokenWindow(now, rotate);
    expect(verifyCheckinToken(secret, checkinToken(secret, w), now, rotate)).toBe(true);
    expect(verifyCheckinToken(secret, checkinToken(secret, w - 2), now, rotate)).toBe(true);
    expect(verifyCheckinToken(secret, checkinToken(secret, w - 3), now, rotate)).toBe(false);
    expect(verifyCheckinToken(secret, checkinToken(secret, w + 1), now, rotate)).toBe(false);
  });

  it("rejects tokens signed with another occurrence's secret", () => {
    const w = tokenWindow(now, rotate);
    expect(verifyCheckinToken(secret, checkinToken("OTHERSECRET", w), now, rotate)).toBe(false);
  });

  it("builds the check-in path", () => {
    expect(checkinPath("ABC234")).toBe("/c/ABC234");
    expect(checkinPath("ABC234", "a-b_c")).toBe("/c/ABC234?t=a-b_c");
  });
});

describe("scan passes", () => {
  it("are recognisably different from rotating tokens", () => {
    expect(isCheckinPass(checkinPass(secret, now))).toBe(true);
    expect(isCheckinPass(checkinToken(secret, tokenWindow(now, rotate)))).toBe(false);
  });

  it("stay valid for the grace period, then expire", () => {
    const pass = checkinPass(secret, now);
    expect(verifyCheckinPass(secret, pass, now + 60_000)).toBe(true);
    expect(verifyCheckinPass(secret, pass, now + CHECKIN_PASS_MAX_AGE_MS - 1000)).toBe(true);
    expect(verifyCheckinPass(secret, pass, now + CHECKIN_PASS_MAX_AGE_MS + 1000)).toBe(false);
  });

  it("can't be forged or moved to another occurrence", () => {
    const pass = checkinPass(secret, now);
    expect(verifyCheckinPass("OTHERSECRET", pass, now)).toBe(false);
    const tampered = pass.replace(/^p[0-9a-z]+/, "p" + Math.floor(now / 1000 + 300).toString(36));
    expect(verifyCheckinPass(secret, tampered, now + 300_000)).toBe(false);
  });

  it("count as scan proof alongside live tokens", () => {
    expect(verifyScanProof(secret, checkinPass(secret, now), now + 120_000, rotate)).toBe(true);
    expect(verifyScanProof(secret, checkinToken(secret, tokenWindow(now, rotate)), now, rotate)).toBe(true);
    expect(verifyScanProof(secret, "nonsense", now, rotate)).toBe(false);
  });
});
