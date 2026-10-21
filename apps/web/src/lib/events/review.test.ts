import { describe, expect, it } from "vitest";
import type { EventRisk } from "@prisma/client";
import { normalizeFlags, readTravel, reviewAfterSave, reviewLine, riskLabel, sameTravel, travelPlan, underReview, waitingLabel, type ReviewBefore, type TravelPlan } from "./review";

const trip: TravelPlan = {
  destination: "Utah State University, Logan",
  departsAt: "2026-11-06T14:00:00.000Z",
  returnsAt: "2026-11-08T23:00:00.000Z",
  overnight: true,
  drivers: [{ userId: "u1", name: "Priya Patel" }, { userId: null, name: "Coach Dana" }],
  notes: null,
};
const on = (before: ReviewBefore | null, flags: EventRisk[], travel: TravelPlan | null = null) => reviewAfterSave({ club: true, reviewOn: true, before, flags, travel });

describe("what's waiting for review", () => {
  it("is pending or sent back for changes; published events aren't", () => {
    expect(underReview({ reviewStatus: "PENDING" })).toBe(true);
    expect(underReview({ reviewStatus: "CHANGES_REQUESTED" })).toBe(true);
    expect(underReview({ reviewStatus: "APPROVED" })).toBe(false);
    expect(underReview({ reviewStatus: "NONE" })).toBe(false);
    expect(underReview({})).toBe(false);
  });
});

describe("a new club event", () => {
  it("publishes right away with nothing checked", () => {
    expect(on(null, [])).toEqual({ status: "NONE", task: "none", submitted: false });
  });

  it("waits for its office with anything checked", () => {
    expect(on(null, ["MINORS"])).toEqual({ status: "PENDING", task: "ensure", submitted: true });
    expect(on(null, ["TRAVEL", "MINORS"], trip)).toEqual({ status: "PENDING", task: "ensure", submitted: true });
  });

  it("never waits for a university event, or while review is off", () => {
    expect(reviewAfterSave({ club: false, reviewOn: true, before: null, flags: ["ALCOHOL"], travel: null })).toEqual({ status: "NONE", task: "none", submitted: false });
    expect(reviewAfterSave({ club: true, reviewOn: false, before: null, flags: ["ALCOHOL"], travel: null })).toEqual({ status: "NONE", task: "none", submitted: false });
  });
});

describe("editing", () => {
  const approved: ReviewBefore = { status: "APPROVED", flags: ["TRAVEL"], travel: trip };

  it("sends an approved event back when a flag is added", () => {
    expect(on(approved, ["TRAVEL", "MINORS"], trip)).toEqual({ status: "PENDING", task: "ensure", submitted: true });
    expect(on({ status: "NONE", flags: [], travel: null }, ["MONEY"])).toEqual({ status: "PENDING", task: "ensure", submitted: true });
  });

  it("sends an approved trip back when the travel details change", () => {
    expect(on(approved, ["TRAVEL"], { ...trip, destination: "Boise State University" })).toEqual({ status: "PENDING", task: "ensure", submitted: true });
    expect(on(approved, ["TRAVEL"], { ...trip, returnsAt: "2026-11-09T01:00:00.000Z" })).toEqual({ status: "PENDING", task: "ensure", submitted: true });
    expect(on(approved, ["TRAVEL"], { ...trip, drivers: [trip.drivers[0]] })).toEqual({ status: "PENDING", task: "ensure", submitted: true });
  });

  it("keeps an approved event published when nothing new is added", () => {
    expect(on(approved, ["TRAVEL"], { ...trip })).toEqual({ status: "APPROVED", task: "none", submitted: false });
    // The same instants written differently are the same trip.
    expect(on(approved, ["TRAVEL"], { ...trip, departsAt: "2026-11-06T07:00:00-07:00" })).toEqual({ status: "APPROVED", task: "none", submitted: false });
  });

  it("never needs review to remove flags", () => {
    expect(on(approved, [])).toEqual({ status: "APPROVED", task: "none", submitted: false });
    expect(on({ status: "APPROVED", flags: ["MINORS", "MONEY"], travel: null }, ["MONEY"])).toEqual({ status: "APPROVED", task: "none", submitted: false });
  });

  it("updates a pending event in place, keeping its one task", () => {
    expect(on({ status: "PENDING", flags: ["MINORS"], travel: null }, ["MINORS", "OUTDOOR_SPACE"])).toEqual({ status: "PENDING", task: "ensure", submitted: false });
  });

  it("publishes a pending event once nothing is left to review, closing its task", () => {
    expect(on({ status: "PENDING", flags: ["MINORS"], travel: null }, [])).toEqual({ status: "NONE", task: "close", submitted: false });
    expect(on({ status: "CHANGES_REQUESTED", flags: ["ALCOHOL"], travel: null }, [])).toEqual({ status: "NONE", task: "close", submitted: false });
  });

  it("sends an event back for review when the club saves the changes asked for", () => {
    expect(on({ status: "CHANGES_REQUESTED", flags: ["ALCOHOL"], travel: null }, ["ALCOHOL"])).toEqual({ status: "PENDING", task: "ensure", submitted: true });
  });

  it("lets everything waiting go when review is turned off", () => {
    expect(reviewAfterSave({ club: true, reviewOn: false, before: { status: "PENDING", flags: ["MINORS"], travel: null }, flags: ["MINORS"], travel: null })).toEqual({ status: "NONE", task: "close", submitted: false });
    expect(reviewAfterSave({ club: true, reviewOn: false, before: approved, flags: ["TRAVEL", "ALCOHOL"], travel: trip })).toEqual({ status: "APPROVED", task: "none", submitted: false });
  });
});

describe("travel details", () => {
  const event = { startsAt: new Date("2026-11-07T16:00:00Z"), endsAt: new Date("2026-11-07T23:00:00Z"), repeats: false };
  const input = { destination: " Utah State University, Logan ", departsAt: "2026-11-06T14:00:00Z", returnsAt: "2026-11-08T23:00:00Z", overnight: true, drivers: [{ userId: "u1", name: "Priya Patel" }, { name: "Coach Dana" }, { userId: "u1", name: "Priya P." }], notes: "  " };

  it("keeps a valid trip, trimmed, with each driver once", () => {
    const r = travelPlan(input, event);
    expect(r.ok && r.plan).toEqual({ destination: "Utah State University, Logan", departsAt: "2026-11-06T14:00:00.000Z", returnsAt: "2026-11-08T23:00:00.000Z", overnight: true, drivers: [{ userId: "u1", name: "Priya Patel" }, { userId: null, name: "Coach Dana" }], notes: null });
  });

  it("needs a destination, and a return after leaving", () => {
    expect(travelPlan({ ...input, destination: "" }, event)).toEqual({ ok: false, error: "Add where you're going." });
    expect(travelPlan({ ...input, returnsAt: "2026-11-06T13:00:00Z" }, event)).toEqual({ ok: false, error: "The trip has to come back after it leaves." });
    expect(travelPlan({ ...input, departsAt: "not a date" }, event)).toEqual({ ok: false, error: "Add when you leave." });
    expect(travelPlan({ ...input, overnight: undefined }, event)).toEqual({ ok: false, error: "Say whether the trip is overnight." });
  });

  it("checks that an overnight trip comes back on a later day, and that trips aren't endless", () => {
    expect(travelPlan({ ...input, departsAt: "2026-11-07T14:00:00Z", returnsAt: "2026-11-08T04:00:00Z" }, event)).toEqual({ ok: false, error: "An overnight trip comes back on a later day. Check the dates, or choose “No” for overnight." });
    expect(travelPlan({ ...input, overnight: false, departsAt: "2026-11-07T14:00:00Z", returnsAt: "2026-11-08T04:00:00Z" }, event).ok).toBe(true);
    expect(travelPlan({ ...input, returnsAt: "2026-12-30T23:00:00Z" }, event)).toEqual({ ok: false, error: "Trips can last up to 21 days." });
  });

  it("covers the event's date", () => {
    expect(travelPlan({ ...input, departsAt: "2026-11-01T14:00:00Z", returnsAt: "2026-11-02T23:00:00Z" }, event)).toEqual({ ok: false, error: "The trip should cover the event: leave before it ends and come back after it starts." });
    // A repeating event's trips aren't tied to one date.
    expect(travelPlan({ ...input, departsAt: "2026-11-01T14:00:00Z", returnsAt: "2026-11-02T23:00:00Z" }, { ...event, repeats: true }).ok).toBe(true);
  });

  it("asks each driver for a name", () => {
    expect(travelPlan({ ...input, drivers: [{ name: " " }] }, event)).toEqual({ ok: false, error: "Each driver needs a name." });
  });

  it("reads back what was stored, and nothing malformed", () => {
    expect(readTravel(trip)).toEqual(trip);
    expect(readTravel({ destination: "x" })).toBeNull();
    expect(readTravel(null)).toBeNull();
    expect(sameTravel(trip, readTravel(JSON.parse(JSON.stringify(trip))))).toBe(true);
    expect(sameTravel(trip, null)).toBe(false);
    expect(sameTravel(null, null)).toBe(true);
  });
});

describe("words", () => {
  it("reads the crowd threshold from System settings", () => {
    expect(riskLabel("LARGE_CROWD", 100)).toBe("More than 100 people");
    expect(riskLabel("LARGE_CROWD", 1500)).toBe("More than 1,500 people");
  });

  it("names the club's office and how long it takes", () => {
    expect(reviewLine({ name: "Campus Recreation", reviewDays: 3 })).toBe("Campus Recreation reviews events like this before they're posted. That usually takes 3 days.");
    expect(reviewLine({ name: "WSUSA", reviewDays: 1 })).toBe("WSUSA reviews events like this before they're posted. That usually takes 1 day.");
    expect(waitingLabel({ name: "Campus Recreation" })).toBe("Waiting for Campus Recreation's review");
  });

  it("keeps flags in checklist order", () => {
    expect(normalizeFlags(["TRAVEL", "MINORS", "TRAVEL", "BOGUS"])).toEqual(["MINORS", "TRAVEL"]);
  });
});
