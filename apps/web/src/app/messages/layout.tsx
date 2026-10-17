import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { canStartLeaderGroup, listConversations } from "@/lib/domain/messaging";
import { MessagesShell } from "@/components/messages/MessagesShell";

export const metadata: Metadata = { title: "Messages" };

/**
 * Messages: club group chats, direct messages and leader groups. The list
 * loads here once and then keeps itself fresh; each thread is a child page.
 */
export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [conversations, canStartGroup] = await Promise.all([listConversations(user), canStartLeaderGroup(user)]);
  const me = { id: user.id, name: user.name, handle: user.handle, avatarUrl: user.avatarUrl, avatarColor: user.avatarColor };
  return (
    <MessagesShell me={me} initialConversations={conversations} canStartGroup={canStartGroup && user.status === "ACTIVE"} canStartDirect={user.status === "ACTIVE"}>
      {children}
    </MessagesShell>
  );
}
