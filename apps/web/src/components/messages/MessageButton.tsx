"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare } from "lucide-react";
import { startDirectAction } from "@/app/messages/actions";
import { Button, type ButtonProps } from "@/components/ui/button";
import { toast } from "@/components/ui/misc";

/**
 * "Message" button for profiles and rosters: opens (or starts) your direct
 * conversation with someone. Show it only when canDirectMessage(viewer, userId)
 * from lib/domain/messaging is true; the server re-checks either way.
 */
export function MessageButton({ userId, name, label = "Message", variant = "outline", size = "sm", className }: { userId: string; name: string; label?: string } & Pick<ButtonProps, "variant" | "size" | "className">) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function open() {
    setPending(true);
    try {
      const r = await startDirectAction(userId);
      if (r.ok) router.push(`/messages/${r.data.id}`);
      else toast.error(r.error);
    } catch {
      toast.error("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant={variant} size={size} className={className} onClick={() => void open()} disabled={pending} aria-label={label === "Message" ? `Message ${name}` : undefined}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MessageSquare className="h-4 w-4" aria-hidden="true" />}
      {size === "icon" ? null : label}
    </Button>
  );
}
