import { Skeleton } from "@/components/ui/layout";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8 sm:px-6" aria-hidden="true">
      <p className="sr-only" role="status">
        Loading…
      </p>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-64" />
      <Skeleton className="h-64" />
    </div>
  );
}
