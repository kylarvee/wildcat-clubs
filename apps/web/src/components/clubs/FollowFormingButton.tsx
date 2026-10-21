"use client";

import { useOptimistic, useTransition } from "react";
import { Bell, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/misc";
import { setClubSubscription } from "@/app/clubs/actions";

/**
 * Follow / Following for a club that's still forming: the same calendar
 * subscription as any club's Follow (lib/domain/memberships), worded for a
 * club that has no events yet. Followers hear when it's approved.
 */
export function FollowFormingButton({ clubId, clubName, following, className }: { clubId: string; clubName: string; following: boolean; className?: string }) {
  const [busy, start] = useTransition();
  const [on, setOn] = useOptimistic(following);
  function toggle() {
    const next = !on;
    start(async () => {
      setOn(next);
      const r = await setClubSubscription(clubId, next);
      if (!r.ok) toast.error(r.error);
      else if (next) toast.success(`You're following ${clubName}`, { description: "We'll tell you when it's approved." });
      else toast.success(`You unfollowed ${clubName}`);
    });
  }
  return (
    <Button
      variant={on ? "secondary" : "outline"}
      size="sm"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      aria-label={`${on ? "Following" : "Follow"} ${clubName}`}
      title={on ? `Unfollow ${clubName}` : undefined}
      className={className}
    >
      {on ? <BellRing className="h-4 w-4" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
      {on ? "Following" : "Follow"}
    </Button>
  );
}
