import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { DomainError } from "@/lib/domain/kit";
import { conversationDetail, loadThread } from "@/lib/domain/messaging";
import { PolicyNotices } from "@/components/policies/PolicyNotices";
import { ConversationView } from "@/components/messages/ConversationView";

/** /messages/<conversationId> — one conversation (deep-linkable from notifications). */
export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await Promise.all([conversationDetail(user, conversationId), loadThread(user, conversationId)]);
  } catch (e) {
    if (e instanceof DomainError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  const [detail, page] = data;
  const hasPolicy = (await db.policy.count({ where: { status: "PUBLISHED", placements: { has: "MESSAGING" } } })) > 0;
  return (
    <ConversationView
      key={detail.id}
      detail={detail}
      initial={page}
      policy={hasPolicy ? <PolicyNotices placement="MESSAGING" title="Messaging policy" /> : null}
    />
  );
}
