import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { DomainError, notFound } from "@/lib/domain/kit";
import { assertCanManageTest, cycleForTest } from "@/lib/domain/tests";
import { toCsv } from "@/lib/attendance/matrix";
import { formResponseRows, testResults } from "@/lib/tests/queries";
import { cycleKeyLabel } from "@/lib/tests/cycles";

/**
 * GET /api/tests/[id]/export?cycle=<cycleKey>|all — the results table as CSV
 * (one row per person; for a form, each person's answers). Same permission
 * as the results page: admin.tests for university tests and forms, the
 * club's "tests" capability for club ones.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentUser();
    const test = await db.test.findUnique({ where: { id }, select: { id: true, title: true, clubId: true, audience: true, recurrence: true, passingPercent: true, isForm: true } });
    if (!test) throw notFound("Test");
    await assertCanManageTest(actor, test);
    const param = new URL(req.url).searchParams.get("cycle");
    const cycleKey = param === "all" ? null : param || (await cycleForTest(test)).key;
    const slug = test.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || (test.isForm ? "form" : "test");
    const round = cycleKey ? cycleKeyLabel(cycleKey).replace(/[^A-Za-z0-9]+/g, "-") : "all-rounds";
    const csvResponse = (csv: string, name: string) =>
      new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}"`,
          "Cache-Control": "no-store",
        },
      });
    if (test.isForm) return csvResponse(toCsv(await formResponseRows(id, cycleKey)), `${slug}-responses-${round}.csv`);
    const { rows } = await testResults(id, cycleKey);

    const STATUS: Record<string, string> = {
      "not-started": "Not started",
      "in-progress": "In progress",
      "needs-review": "Waiting for review",
      passed: "Passed",
      failed: "Not passed",
      missed: "Missed deadline",
      excused: "Excused",
    };
    const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");
    const csv = toCsv([
      ["Name", "Email", "Status", "Score %", "Passed", "Attempts", "Minutes taken", "Started", "Handed in", "Timed out", "Due"],
      ...rows.map((r) => [
        r.person.name,
        r.person.email,
        STATUS[r.status] ?? r.status,
        r.attempt?.scorePercent ?? "",
        r.attempt?.passed === null || r.attempt?.passed === undefined ? "" : r.attempt.passed ? "Yes" : "No",
        r.attempts,
        r.attempt?.timeMs !== null && r.attempt?.timeMs !== undefined ? Math.round(r.attempt.timeMs / 600) / 100 : "",
        iso(r.attempt?.startedAt),
        iso(r.attempt?.submittedAt),
        r.attempt?.autoSubmitted ? "Yes" : "",
        iso(r.dueAt),
      ]),
    ]);
    return csvResponse(csv, `${slug}-results-${round}.csv`);
  } catch (e) {
    if (e instanceof DomainError) {
      const status = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID: 400, CONFLICT: 409 }[e.code];
      return Response.json({ ok: false, error: e.message, code: e.code }, { status });
    }
    console.error(e);
    return Response.json({ ok: false, error: "Something went wrong.", code: "ERROR" }, { status: 500 });
  }
}
