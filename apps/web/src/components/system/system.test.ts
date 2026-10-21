import { describe, expect, it } from "vitest";
import { CONFIG_DEFAULTS, type ConfigKey } from "@/lib/config";
import { CONFIG_SCHEMAS } from "@/lib/domain/system";
import { CONFIG_COPY, withUnit } from "@/components/system/config-copy";
import { toLocalPath } from "@/components/system/outbox";

const KEYS = Object.keys(CONFIG_DEFAULTS) as ConfigKey[];

describe("platform rules", () => {
  it("has a validator and plain-language copy for every setting", () => {
    expect(Object.keys(CONFIG_SCHEMAS).sort()).toEqual([...KEYS].sort());
    expect(Object.keys(CONFIG_COPY).sort()).toEqual([...KEYS].sort());
  });

  it("accepts every shipped default", () => {
    for (const key of KEYS) {
      const r = CONFIG_SCHEMAS[key].safeParse(CONFIG_DEFAULTS[key]);
      expect(r.success, `${key}: ${r.success ? "" : r.error.issues[0]?.message}`).toBe(true);
    }
  });

  it("keeps each number's form limits in line with the server's", () => {
    for (const key of KEYS) {
      const c = CONFIG_COPY[key];
      if (c.min === undefined || c.max === undefined) continue;
      expect(CONFIG_SCHEMAS[key].safeParse(c.min).success, `${key} min`).toBe(true);
      expect(CONFIG_SCHEMAS[key].safeParse(c.max).success, `${key} max`).toBe(true);
      expect(CONFIG_SCHEMAS[key].safeParse(c.min - 1).success, `${key} below min`).toBe(false);
      expect(CONFIG_SCHEMAS[key].safeParse(c.max + 1).success, `${key} above max`).toBe(false);
    }
  });

  it("reads numbers typed into a form", () => {
    expect(CONFIG_SCHEMAS["activity.studentWindowDays"].parse(" 45 ")).toBe(45);
    expect(CONFIG_SCHEMAS["activity.studentWindowDays"].safeParse("").success).toBe(false);
    expect(CONFIG_SCHEMAS["activity.studentWindowDays"].safeParse("4.5").success).toBe(false);
    expect(CONFIG_SCHEMAS["activity.studentWindowDays"].safeParse(null).success).toBe(false);
  });

  it("rejects values that would break the platform", () => {
    expect(CONFIG_SCHEMAS["reviews.bombingMaxRating"].safeParse(5).success).toBe(false);
    expect(CONFIG_SCHEMAS["app.iosUrl"].safeParse("http://apps.apple.com/x").success).toBe(false);
    expect(CONFIG_SCHEMAS["app.iosUrl"].safeParse("").success).toBe(true);
    expect(CONFIG_SCHEMAS["ai.assistantEnabled"].safeParse("true").success).toBe(false);
    expect(CONFIG_SCHEMAS["wsusa.reviewers"].safeParse([{ name: "A", title: "", email: "a@weber.edu" }]).success).toBe(false);
  });

  it("words units naturally", () => {
    expect(withUnit(1, "days")).toBe("1 day");
    expect(withUnit(31, "days")).toBe("31 days");
    expect(withUnit(1000, "members")).toBe("1,000 members");
    expect(withUnit(3)).toBe("3");
  });
});

describe("outbox links", () => {
  const app = "http://localhost:3100";
  it("keeps testers on their own host for platform links", () => {
    expect(toLocalPath("http://localhost:3100/clubs/x/manage?tab=a#b", app)).toBe("/clubs/x/manage?tab=a#b");
    expect(toLocalPath("http://localhost:3100", app)).toBe("/");
  });
  it("leaves outside links alone", () => {
    expect(toLocalPath("https://www.weber.edu/wsusa", app)).toBeNull();
    expect(toLocalPath("http://localhost:3000/clubs", app)).toBeNull();
    expect(toLocalPath("not a url", app)).toBeNull();
  });
});
