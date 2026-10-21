import { Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/layout";

/**
 * A tool the person can't use here. `note` (lib/authz pausedNote) says when
 * an overdue single-permission requirement paused just this permission.
 */
export function NoPermission({ what = "this tool", suspended, note }: { what?: string; suspended?: boolean; note?: string | null }) {
  return (
    <EmptyState
      icon={<Lock />}
      title={note ? `${what.charAt(0).toUpperCase()}${what.slice(1)} is paused for you` : `You don't have access to ${what}`}
      description={
        note
          ? `${note} Check your tasks.`
          : suspended
            ? "Your leadership permissions are paused until you finish your overdue requirement. Check your tasks."
            : "Ask your club's president or advisor to add this permission to your role."
      }
    />
  );
}
