import Link from "next/link";
import { ArrowLeft, MessageSquareOff } from "lucide-react";

/** A conversation that doesn't exist, or isn't yours to read, looks the same: not found. */
export default function ConversationNotFound() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-line px-2 py-2.5 md:hidden">
        <Link href="/messages" className="inline-flex items-center gap-1.5 rounded-lg p-2 text-sm font-medium text-ink-2 hover:bg-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All conversations
        </Link>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <MessageSquareOff className="h-8 w-8 text-ink-3" aria-hidden="true" />
        <h2 className="mt-3 text-lg font-semibold text-ink">We couldn&apos;t find that conversation</h2>
        <p className="mt-1 max-w-sm text-sm text-ink-3">
          It may have been a group you left, or a chat for a club you&apos;re no longer in. Pick another conversation or start a new one.
        </p>
        <Link href="/messages" className="mt-4 text-sm font-medium text-brand-600 hover:underline">
          Back to Messages
        </Link>
      </div>
    </div>
  );
}
