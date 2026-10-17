import { Users } from "lucide-react";
import type { ConversationType } from "@prisma/client";
import type { ChatClubRef, PersonRef } from "@/lib/domain/messaging";
import { Avatar, ClubLogo } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";

/** Club logo for club chats, the other person for DMs, a group mark for leader groups. Hook-free, so it renders anywhere. */
export function ConversationAvatar({
  type,
  club,
  person,
  size = "md",
  className,
}: {
  type: ConversationType;
  club: ChatClubRef | null;
  person?: PersonRef | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const box = size === "md" ? "h-10 w-10" : "h-8 w-8";
  if (type === "CLUB" && club) {
    return <ClubLogo name={club.name} src={club.logoUrl} color={club.logoColor} size="sm" className={cn(box, size === "md" ? "rounded-xl text-sm" : "", className)} />;
  }
  if (type === "DIRECT" && person) {
    return <Avatar name={person.name} src={person.avatarUrl} color={person.avatarColor} size={size === "md" ? "md" : "sm"} className={cn("ring-0", className)} />;
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand", box, className)} aria-hidden="true">
      <Users className={size === "md" ? "h-5 w-5" : "h-4 w-4"} />
    </span>
  );
}
