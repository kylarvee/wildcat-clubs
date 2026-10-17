import { Badge } from "@/components/ui/badge";
import { STAGE_TONE, stageLabel, type ClubAnalyticsRow } from "@/lib/analytics/club-table";

/** "Active", "In pilot", "Inactive", "Draft", "Waiting on WSUSA", "Retired"… with a matching tone. Text carries the meaning, not color. */
export function StageBadge({ row, className }: { row: Pick<ClubAnalyticsRow, "stage" | "status">; className?: string }) {
  return (
    <Badge tone={STAGE_TONE[row.stage]} className={className}>
      {stageLabel(row)}
    </Badge>
  );
}
