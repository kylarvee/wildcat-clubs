import { Skeleton } from "@/components/ui/layout";

export default function Loading() {
  return (
    <div>
      <p className="sr-only" role="status">
        Loading club…
      </p>
      <div className="border-b border-line bg-surface" aria-hidden="true">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 pb-10 pt-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div>
            <Skeleton className="h-4 w-32" />
            <div className="mt-6 flex gap-5">
              <Skeleton className="h-24 w-24 rounded-3xl" />
              <div className="flex-1 space-y-3 pt-2">
                <Skeleton className="h-9 w-3/4" />
                <Skeleton className="h-5 w-40 rounded-full" />
              </div>
            </div>
            <Skeleton className="mt-6 h-5 w-full max-w-lg" />
            <Skeleton className="mt-2 h-5 w-5/6 max-w-md" />
            <div className="mt-6 flex gap-2">
              <Skeleton className="h-12 w-36" />
              <Skeleton className="h-12 w-12" />
            </div>
          </div>
          <Skeleton className="h-[420px] w-full rounded-[var(--radius-card)]" />
        </div>
      </div>
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem]" aria-hidden="true">
        <div className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-32 w-full" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    </div>
  );
}
