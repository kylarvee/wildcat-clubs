import { describe, expect, it } from "vitest";
import { parseCheckinInput } from "./checkin-url";

describe("parseCheckinInput", () => {
  it("reads the web QR link", () => {
    expect(parseCheckinInput({ url: "http://localhost:3100/c/BUILD8?t=abc123" })).toEqual({ code: "BUILD8", token: "abc123" });
    expect(parseCheckinInput({ url: "https://clubs.weber.edu/c/HERE26?t=p1x2.y3" })).toEqual({ code: "HERE26", token: "p1x2.y3" });
  });

  it("reads the app deep link", () => {
    expect(parseCheckinInput({ url: "wildcatclubs://c/LATER7?t=tok" })).toEqual({ code: "LATER7", token: "tok" });
    expect(parseCheckinInput({ url: "wildcatclubs:///c/LATER7" })).toEqual({ code: "LATER7", token: null });
  });

  it("keeps a typed code and token as given", () => {
    expect(parseCheckinInput({ code: " here26 ", token: "t" })).toEqual({ code: "here26", token: "t" });
    expect(parseCheckinInput({ url: "HERE26" })).toEqual({ code: "HERE26", token: null });
  });

  it("rejects things that aren't check-in links", () => {
    expect(parseCheckinInput({ url: "https://www.weber.edu/" })).toBeNull();
    expect(parseCheckinInput({ url: "https://example.com/clubs/chess" })).toBeNull();
    expect(parseCheckinInput({ url: "not a url at all" })).toBeNull();
    expect(parseCheckinInput({})).toBeNull();
  });
});
