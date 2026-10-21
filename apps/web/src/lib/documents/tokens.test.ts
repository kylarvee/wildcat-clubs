import { afterEach, describe, expect, it, vi } from "vitest";
import { documentSecret, issueDocumentToken, readDocumentToken, signDocumentToken, verifyDocumentToken, verifyUrl } from "./tokens";

const SECRET = "test-secret-please-change";
const issuedAt = new Date("2026-10-20T15:30:00.000Z");
const claim = { kind: "involvement" as const, subjectId: "cmaya000000000000000000001", issuedAt };
const later = new Date("2027-03-01T12:00:00.000Z");

describe("document tokens", () => {
  it("round-trips kind, subject and issue time", () => {
    const token = signDocumentToken(claim, SECRET);
    expect(token).toMatch(/^ir\.cmaya000000000000000000001\.[0-9a-z]+\.[A-Za-z0-9_-]{24}$/);
    expect(readDocumentToken(token, SECRET, later)).toEqual(claim);
  });

  it("is URL-safe and short enough for a small QR code", () => {
    const token = signDocumentToken(claim, SECRET);
    expect(encodeURIComponent(token)).toBe(token);
    expect(token.length).toBeLessThan(70);
  });

  it("refuses a changed subject, kind, date or signature", () => {
    const token = signDocumentToken(claim, SECRET);
    const [code, subject, issued, sig] = token.split(".");
    const swapLast = (s: string) => s.slice(0, -1) + (s.endsWith("A") ? "B" : "A");
    expect(readDocumentToken([code, "csomeoneelse0000000000000", issued, sig].join("."), SECRET, later)).toBeNull();
    expect(readDocumentToken(["xx", subject, issued, sig].join("."), SECRET, later)).toBeNull();
    expect(readDocumentToken([code, subject, (parseInt(issued, 36) - 86_400_000).toString(36), sig].join("."), SECRET, later)).toBeNull();
    expect(readDocumentToken([code, subject, issued, swapLast(sig)].join("."), SECRET, later)).toBeNull();
    expect(readDocumentToken([code, subject, issued, `${sig}*`].join("."), SECRET, later)).toBeNull();
  });

  it("refuses another secret's tokens, cut-off tokens and junk", () => {
    const token = signDocumentToken(claim, SECRET);
    expect(readDocumentToken(token, "another-secret", later)).toBeNull();
    expect(readDocumentToken(token.slice(0, -3), SECRET, later)).toBeNull();
    expect(readDocumentToken(token.split(".").slice(0, 3).join("."), SECRET, later)).toBeNull();
    for (const junk of ["", "ir", "....", "ir.a.b.c.d", "x".repeat(500), "ir.<script>.1.2"]) expect(readDocumentToken(junk, SECRET, later)).toBeNull();
  });

  it("refuses a token issued in the future, allowing a little clock drift", () => {
    const token = signDocumentToken(claim, SECRET);
    expect(readDocumentToken(token, SECRET, new Date(issuedAt.getTime() - 60_000))).toEqual(claim);
    expect(readDocumentToken(token, SECRET, new Date(issuedAt.getTime() - 60 * 60_000))).toBeNull();
  });

  it("only signs plain ids", () => {
    expect(() => signDocumentToken({ ...claim, subjectId: "a.b" }, SECRET)).toThrow();
    expect(() => signDocumentToken({ ...claim, subjectId: "" }, SECRET)).toThrow();
  });
});

describe("officers of record tokens", () => {
  const officers = { kind: "officers" as const, subjectId: "crobotics00000000000000001", issuedAt };

  it("name the club and round-trip like the involvement record's", () => {
    const token = signDocumentToken(officers, SECRET);
    expect(token).toMatch(/^or\.crobotics00000000000000001\.[0-9a-z]+\.[A-Za-z0-9_-]{24}$/);
    expect(readDocumentToken(token, SECRET, later)).toEqual(officers);
    expect(token.length).toBeLessThan(70);
  });

  it("can't be turned into the other kind: the kind is signed with the rest", () => {
    const [, subject, issued, sig] = signDocumentToken(officers, SECRET).split(".");
    expect(readDocumentToken(["ir", subject, issued, sig].join("."), SECRET, later)).toBeNull();
    const [, s2, i2, sig2] = signDocumentToken(claim, SECRET).split(".");
    expect(readDocumentToken(["or", s2, i2, sig2].join("."), SECRET, later)).toBeNull();
  });
});

describe("the server secret", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses DOCUMENT_SECRET when it's set", () => {
    vi.stubEnv("DOCUMENT_SECRET", "  from-the-environment  ");
    expect(documentSecret()).toBe("from-the-environment");
    const token = issueDocumentToken("involvement", "cabc", issuedAt);
    expect(readDocumentToken(token, "from-the-environment", later)?.subjectId).toBe("cabc");
    expect(verifyDocumentToken(token, later)?.subjectId).toBe("cabc");
  });

  it("falls back for development, and refuses to guess in production", () => {
    vi.stubEnv("DOCUMENT_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(verifyDocumentToken(issueDocumentToken("involvement", "cabc", issuedAt), later)?.kind).toBe("involvement");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => documentSecret()).toThrow(/DOCUMENT_SECRET/);
  });

  it("links to the verify page on this deployment", () => {
    vi.stubEnv("APP_URL", "https://clubs.weber.edu/");
    expect(verifyUrl("ir.c1.k.sig")).toBe("https://clubs.weber.edu/verify/ir.c1.k.sig");
  });
});
