import { timingSafeEqual } from "node:crypto";
import { runScheduledJobs } from "@/lib/jobs/tick";

/**
 * GET/POST /api/cron/tick — runs the scheduled jobs (lib/jobs/tick).
 * Protected by CRON_SECRET: send `Authorization: Bearer <secret>` (Vercel
 * Cron and most schedulers do) or `?secret=<secret>`. Without CRON_SECRET set,
 * the endpoint refuses every call; sysadmins can still run jobs from System.
 */
export const maxDuration = 300;

function sameSecret(given: string, secret: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: "Scheduled jobs are off: CRON_SECRET isn't set on the server." }, { status: 503 });
  }
  const header = req.headers.get("authorization") ?? "";
  const given = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : (new URL(req.url).searchParams.get("secret") ?? "");
  if (!given || !sameSecret(given, secret)) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }
  const ranAt = new Date();
  const reports = await runScheduledJobs(ranAt);
  return Response.json({ ok: reports.every((r) => r.ok), ranAt: ranAt.toISOString(), reports }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
