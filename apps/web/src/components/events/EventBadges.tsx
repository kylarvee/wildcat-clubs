import { Cast, Gift, HeartHandshake, Lock, UtensilsCrossed, Video, type LucideIcon } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import type { EventBadge, EventBadgeKey } from "@/lib/events/labels";

/** Green for what's free, purple for service, blue for how to join, gray for who it's for. */
const LOOK: Record<EventBadgeKey, { tone: Tone; icon: LucideIcon }> = {
  food: { tone: "success", icon: UtensilsCrossed },
  stuff: { tone: "success", icon: Gift },
  service: { tone: "brand", icon: HeartHandshake },
  online: { tone: "info", icon: Video },
  hybrid: { tone: "info", icon: Cast },
  members: { tone: "neutral", icon: Lock },
};

function One({ b }: { b: EventBadge }) {
  const { tone, icon: Icon } = LOOK[b.key];
  return (
    <Badge tone={tone}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {b.label}
    </Badge>
  );
}

/**
 * An event's badges (lib/events/labels eventBadges): "Free food", "Service
 * hours · 2", "Hybrid"… A list, or `inline` badges for inside a line of text.
 */
export function EventBadges({ badges, className, inline }: { badges: EventBadge[]; className?: string; inline?: boolean }) {
  if (!badges.length) return null;
  if (inline) return <>{badges.map((b) => <One key={b.key} b={b} />)}</>;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {badges.map((b) => (
        <li key={b.key}>
          <One b={b} />
        </li>
      ))}
    </ul>
  );
}
