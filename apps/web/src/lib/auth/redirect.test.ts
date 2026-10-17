import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/redirect";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/clubs/robotics?register=1#join")).toBe("/clubs/robotics?register=1#join");
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/.//evil.example")).toBe("/.//evil.example");
  });

  it("falls back to the dashboard for anything that could leave the site", () => {
    for (const bad of [null, undefined, "", "dashboard", "https://evil.example", "//evil.example", "/\\evil.example", "/%09/x\\y", "/\t/evil.example", "/\n/evil.example", "javascript:alert(1)"]) {
      expect(safeNext(bad)).toBe("/dashboard");
    }
    // ?next=/a&next=/b reaches a page as an array.
    expect(safeNext(["/a", "/b"] as unknown as string)).toBe("/dashboard");
  });

  it("never returns something a browser resolves to another origin", () => {
    for (const n of ["/a", "//b", "/\\c", "/\t/d", "/./e", "/.//f", " /g"]) {
      const out = safeNext(n);
      expect(new URL(out, "https://clubs.weber.edu").origin).toBe("https://clubs.weber.edu");
    }
  });
});
