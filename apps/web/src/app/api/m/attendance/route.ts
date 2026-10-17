import { mobile, mobileActor, preflight } from "../_lib/http";
import { attendanceView } from "../_lib/views";

/**
 * GET /api/m/attendance → MAttendance: your record in every club you've
 * belonged to or visited (numbers from lib/metrics.memberClubSummaries, so
 * they match the web) and your recent check-ins, newest first.
 */
export async function GET(req: Request) {
  return mobile(async () => attendanceView(await mobileActor(req)));
}

export const OPTIONS = preflight;
