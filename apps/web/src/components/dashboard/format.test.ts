import { describe, expect, it } from "vitest";
import { campusDate } from "@/lib/time";
import { agendaDayLabel, audienceLabel, meetingLabel } from "@/components/dashboard/format";

// Sunday, October 18 2026, 9:00 a.m. on campus.
const now = campusDate(2026, 10, 18, 9, 0);

describe("meetingLabel", () => {
  it("says today and tomorrow by name", () => {
    expect(meetingLabel(campusDate(2026, 10, 18, 17, 30), now)).toBe("Today 5:30 PM");
    expect(meetingLabel(campusDate(2026, 10, 19, 17, 0), now)).toBe("Tomorrow 5:00 PM");
  });
  it("uses the weekday inside a week, then the date", () => {
    expect(meetingLabel(campusDate(2026, 10, 22, 17, 30), now)).toBe("Thu 5:30 PM");
    expect(meetingLabel(campusDate(2026, 10, 25, 18, 0), now)).toBe("Oct 25, 6:00 PM");
  });
  it("counts days in campus time, not UTC", () => {
    // 11:30 p.m. tonight on campus is already tomorrow in UTC.
    expect(meetingLabel(campusDate(2026, 10, 18, 23, 30), now)).toBe("Today 11:30 PM");
  });
});

describe("agendaDayLabel", () => {
  it("names today and tomorrow, then the date", () => {
    expect(agendaDayLabel(campusDate(2026, 10, 18, 20, 0), now)).toBe("Today");
    expect(agendaDayLabel(campusDate(2026, 10, 19, 8, 0), now)).toBe("Tomorrow");
    expect(agendaDayLabel(campusDate(2026, 10, 20, 17, 0), now)).toBe("Tue, Oct 20");
  });
});

describe("audienceLabel", () => {
  it("names member-wide requirements simply", () => {
    expect(audienceLabel(["MEMBER", "OFFICER"])).toBe("Every club member");
  });
  it("lists leader roles in rank order", () => {
    expect(audienceLabel(["OFFICER", "PRESIDENT", "VP"])).toBe("Presidents, VPs and officers");
    expect(audienceLabel(["AMBASSADOR"])).toBe("Ambassadors");
  });
});
