import { Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/layout";

export function NoPermission({ what = "this tool", suspended }: { what?: string; suspended?: boolean }) {
  return (
    <EmptyState
      icon={<Lock />}
      title={`You don't have access to ${what}`}
      description={
        suspended
          ? "Your leadership permissions are paused until you finish your required officer training or test. Check your tasks."
          : "Ask your club's president or advisor to add this permission to your role."
      }
    />
  );
}
