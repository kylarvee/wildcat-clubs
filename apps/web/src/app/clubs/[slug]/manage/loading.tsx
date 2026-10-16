import { Skeleton } from "@/components/ui/layout";

/** Workspace tools load inside the club workspace shell; show a neutral skeleton, not the public club page's. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <p className="sr-only" role="status">
        Loading…
      </p>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}
