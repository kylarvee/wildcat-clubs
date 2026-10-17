/**
 * Smoke test: signs in as every test persona and requests every page route
 * with real ids from the seeded database. Fails on any 5xx (or a page that
 * renders Next's error screen). 404s are reported separately — some are
 * expected (a student opening an admin page), so they're listed, not failed.
 *
 *   BASE_URL=http://localhost:3200 npx tsx scripts/smoke.ts
 */
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PERSONAS } from "../src/lib/auth/personas";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const db = new PrismaClient();

function pageRoutes(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name.startsWith("_") || name === "api") continue;
      const seg = name.startsWith("(") ? "" : `/${name}`;
      out.push(...pageRoutes(full, base + seg));
    } else if (name === "page.tsx") {
      out.push(base || "/");
    }
  }
  return out;
}

async function ids() {
  const pick = async <T>(p: Promise<T | null>) => (await p) ?? null;
  const approved = await db.club.findFirst({ where: { slug: "wildcat-robotics" }, select: { id: true, slug: true } });
  const event = await pick(db.event.findFirst({ where: { clubId: approved?.id, status: "SCHEDULED" }, select: { id: true } }));
  const training = await pick(db.event.findFirst({ where: { clubId: null, status: "SCHEDULED" }, select: { id: true } }));
  const occ = await pick(db.eventOccurrence.findFirst({ where: { event: { clubId: approved?.id } }, orderBy: { startsAt: "desc" }, select: { id: true, checkinCode: true } }));
  const trainingOcc = await pick(db.eventOccurrence.findFirst({ where: { event: { clubId: null } }, select: { id: true } }));
  const member = await pick(db.membership.findFirst({ where: { clubId: approved?.id, status: "ACTIVE" }, select: { userId: true } }));
  const election = await pick(db.election.findFirst({ select: { id: true, club: { select: { slug: true } } } }));
  const test = await pick(db.test.findFirst({ where: { clubId: null, status: "PUBLISHED" }, select: { id: true } }));
  const attempt = await pick(db.testAttempt.findFirst({ where: { testId: test?.id }, select: { id: true } }));
  const policy = await pick(db.policy.findFirst({ where: { status: "PUBLISHED" }, select: { slug: true } }));
  const draft = await pick(db.constitutionDraft.findFirst({ select: { id: true } }));
  const invite = await pick(db.advisorInvite.findFirst({ where: { status: "PENDING" }, select: { token: true } }));
  const user = await pick(db.user.findFirst({ where: { email: "maya.chen@mail.weber.edu" }, select: { handle: true, id: true } }));
  const convo = await pick(db.conversation.findFirst({ where: { clubId: approved?.id }, select: { id: true } }));
  const funding = await pick(db.fundingRequest.findFirst({ select: { id: true } }));
  const complaint = await pick(db.complaint.findFirst({ select: { id: true } }));
  return {
    slug: approved?.slug ?? "x", clubId: approved?.id ?? "x", eventId: event?.id ?? "x", trainingId: training?.id ?? "x",
    occurrenceId: occ?.id ?? "x", trainingOccurrenceId: trainingOcc?.id ?? "x", code: occ?.checkinCode ?? "x", userId: member?.userId ?? "x",
    electionId: election?.id ?? "x", testId: test?.id ?? "x", attemptId: attempt?.id ?? "x", policySlug: policy?.slug ?? "x", draftId: draft?.id ?? "x",
    token: invite?.token ?? "x", handle: user?.handle ?? "x", conversationId: convo?.id ?? "x", fundingId: funding?.id ?? "x", complaintId: complaint?.id ?? "x",
  };
}

function fill(route: string, v: Awaited<ReturnType<typeof ids>>): string {
  return route
    .replace("/admin/trainings/occurrences/[occurrenceId]", `/admin/trainings/occurrences/${v.trainingOccurrenceId}`)
    .replace("/admin/trainings/[eventId]", `/admin/trainings/${v.trainingId}`)
    .replace("/admin/analytics/[clubId]", `/admin/analytics/${v.clubId}`)
    .replace("/admin/clubs/[id]", `/admin/clubs/${v.clubId}`)
    .replace("/admin/funding/[id]", `/admin/funding/${v.fundingId}`)
    .replace("/admin/complaints/[id]", `/admin/complaints/${v.complaintId}`)
    .replace("/admin/tests/[id]", `/admin/tests/${v.testId}`)
    .replace("/admin/users/[id]", `/admin/users/${v.userId}`)
    .replace("[slug]", v.slug)
    .replace("[eventId]", v.eventId)
    .replace("[occurrenceId]", v.occurrenceId)
    .replace("[userId]", v.userId)
    .replace("[code]", v.code)
    .replace("[handle]", v.handle)
    .replace("[token]", v.token)
    .replace("[attemptId]", v.attemptId)
    .replace("[conversationId]", v.conversationId)
    .replace("[clubId]", v.clubId)
    .replace(/\/policies\/\[[^\]]+\]/, `/policies/${v.policySlug}`)
    .replace(/\/constitution\/\[[^\]]+\]/, `/constitution/${v.draftId}`)
    .replace(/\/tests\/\[[^\]]+\]/, `/tests/${v.testId}`)
    .replace(/\/elections\/\[[^\]]+\]/, `/elections/${v.electionId}`)
    .replace(/\/events\/\[[^\]]+\]/, `/events/${v.eventId}`)
    .replace(/\[[^\]]+\]/g, "x");
}

async function main() {
  const routes = pageRoutes(path.join(process.cwd(), "src/app")).sort();
  const v = await ids();
  const urls = [...new Set(routes.map((r) => fill(r, v)))];
  const people: { label: string; cookie: string | null; sessionId?: string }[] = [{ label: "signed-out", cookie: null }];
  for (const p of PERSONAS) {
    const u = await db.user.findUnique({ where: { email: p.email } });
    if (!u) continue;
    const token = randomBytes(24).toString("base64url");
    const s = await db.session.create({ data: { userId: u.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600_000) } });
    people.push({ label: p.key, cookie: `wc_session=${token}`, sessionId: s.id });
  }
  const failures: string[] = [];
  const notFound: string[] = [];
  let count = 0;
  try {
    for (const person of people) {
      for (const url of urls) {
        const started = Date.now();
        let status = 0;
        let body = "";
        try {
          const res = await fetch(BASE + url, { headers: person.cookie ? { cookie: person.cookie } : {}, redirect: "manual" });
          status = res.status;
          body = status >= 200 && status < 300 ? await res.text() : "";
        } catch (e) {
          failures.push(`${person.label} ${url} → fetch failed: ${e}`);
          continue;
        }
        count++;
        const ms = Date.now() - started;
        if (status >= 500 || /Application error|Unhandled Runtime Error|Something went wrong/.test(body)) failures.push(`${person.label} ${url} → ${status}${ms > 0 ? ` (${ms} ms)` : ""}`);
        else if (status === 404) notFound.push(`${person.label} ${url}`);
        if (ms > 4000) console.log(`slow: ${person.label} ${url} ${ms} ms`);
      }
      console.log(`${person.label}: done`);
    }
  } finally {
    await db.session.deleteMany({ where: { id: { in: people.map((p) => p.sessionId).filter((x): x is string => Boolean(x)) } } });
    await db.$disconnect();
  }
  console.log(`\n${count} requests, ${urls.length} routes × ${people.length} viewers`);
  console.log(`\n404s (${notFound.length}) — expected where a viewer lacks access:`);
  for (const n of notFound) console.log("  " + n);
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.log("  " + f);
  process.exit(failures.length ? 1 : 0);
}

main();
