import { Skeleton } from "@/components/ui/layout";

/** Thread skeleton while a conversation opens. */
export default function ConversationLoading() {
  return (
    <div className="flex flex-1 flex-col" aria-busy="true" aria-label="Loading conversation">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-hidden px-4 py-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className={i % 2 ? "h-3.5 w-3/4" : "h-3.5 w-1/2"} />
              {i === 1 ? <Skeleton className="h-3.5 w-2/3" /> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-line px-4 py-3">
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    </div>
  );
}
