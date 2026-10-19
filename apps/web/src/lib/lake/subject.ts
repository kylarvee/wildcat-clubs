/**
 * The person an activity row is about (ActivityLog.subjectUserId): data.userId,
 * or an applied election's winnerId. Pure, so the write path (lib/lake/activity)
 * and the seed fill it the same way, and profile feeds find a person's rows
 * through the (subjectUserId, at) index instead of filtering JSON.
 */
export function activitySubject(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.userId === "string" && d.userId) return d.userId;
  if (typeof d.winnerId === "string" && d.winnerId) return d.winnerId;
  return null;
}
