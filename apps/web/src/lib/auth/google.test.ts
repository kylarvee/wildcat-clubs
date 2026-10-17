import { afterEach, describe, expect, it, vi } from "vitest";

let payload: Record<string, unknown> = {};
vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    async verifyIdToken() {
      return { getPayload: () => payload };
    }
  },
}));

const { authMode, NotUniversityAccount, personasEnabled, verifyIdToken } = await import("@/lib/auth/google");

afterEach(() => vi.unstubAllEnvs());

describe("verifyIdToken", () => {
  it("accepts verified accounts managed by the university's Workspace", async () => {
    payload = { email: "maya@mail.weber.edu", email_verified: true, hd: "mail.weber.edu", name: "Maya" };
    expect(await verifyIdToken("t")).toEqual({ email: "maya@mail.weber.edu", name: "Maya", picture: null });
    payload = { email: "prof@weber.edu", email_verified: true, hd: "weber.edu" };
    expect((await verifyIdToken("t")).email).toBe("prof@weber.edu");
  });

  it("refuses a personal Google account that merely uses a university address", async () => {
    payload = { email: "former@weber.edu", email_verified: true };
    await expect(verifyIdToken("t")).rejects.toBeInstanceOf(NotUniversityAccount);
    payload = { email: "former@weber.edu", email_verified: true, hd: "gmail.com" };
    await expect(verifyIdToken("t")).rejects.toBeInstanceOf(NotUniversityAccount);
  });

  it("refuses unverified or non-university emails", async () => {
    payload = { email: "maya@mail.weber.edu", email_verified: false, hd: "mail.weber.edu" };
    await expect(verifyIdToken("t")).rejects.toBeInstanceOf(NotUniversityAccount);
    payload = { email: "someone@other.edu", email_verified: true, hd: "weber.edu" };
    await expect(verifyIdToken("t")).rejects.toBeInstanceOf(NotUniversityAccount);
  });
});

describe("authMode", () => {
  it("defaults to both outside production and honors AUTH_MODE", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_MODE", "");
    expect(authMode()).toBe("both");
    vi.stubEnv("AUTH_MODE", "mock");
    expect(authMode()).toBe("mock");
  });

  it("is Google-only in production, whatever AUTH_MODE says, unless test sign-in is explicitly allowed", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "both");
    expect(authMode()).toBe("google");
    expect(personasEnabled()).toBe(false);
    vi.stubEnv("ALLOW_TEST_SIGNIN", "1");
    expect(authMode()).toBe("both");
    vi.stubEnv("AUTH_MODE", "");
    expect(authMode()).toBe("both");
  });
});
