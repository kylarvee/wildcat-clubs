import { describe, expect, it } from "vitest";
import { isPolicyDocument, policySlug, primaryPlacement, SLUG_PATTERN } from "@/components/policies/placements";

describe("policy addresses", () => {
  it("makes clean slugs from titles", () => {
    expect(policySlug("Review Integrity")).toBe("review-integrity");
    expect(policySlug("Funding & Purchasing")).toBe("funding-and-purchasing");
    expect(policySlug("  Événement — Safety!! ")).toBe("evenement-safety");
    expect(SLUG_PATTERN.test(policySlug("Files & Messaging Acceptable Use"))).toBe(true);
  });

  it("rejects malformed slugs", () => {
    expect(SLUG_PATTERN.test("double--hyphen")).toBe(false);
    expect(SLUG_PATTERN.test("-leading")).toBe(false);
    expect(SLUG_PATTERN.test("Upper")).toBe(false);
  });
});

describe("policy library grouping", () => {
  it("lists a policy under its first placement, with General last", () => {
    expect(primaryPlacement(["GENERAL", "MEMBERSHIP"])).toBe("MEMBERSHIP");
    expect(primaryPlacement(["FILES", "MESSAGING"])).toBe("FILES");
    expect(primaryPlacement(["MEMBERSHIP", "CLUB_CREATION"])).toBe("CLUB_CREATION");
    expect(primaryPlacement([])).toBe("GENERAL");
  });
});

describe("policy documents", () => {
  it("accepts PDF and Word only", () => {
    expect(isPolicyDocument("code.pdf", "application/pdf")).toBe(true);
    expect(isPolicyDocument("code.docx", "")).toBe(true);
    expect(isPolicyDocument("notes.doc", null)).toBe(true);
    expect(isPolicyDocument("photo.png", "image/png")).toBe(false);
  });
});
