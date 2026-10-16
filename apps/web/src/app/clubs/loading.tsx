import { Container } from "@/components/ui/layout";
import { Skeleton } from "@/components/ui/layout";

export default function Loading() {
  return (
    <Container size="xl">
      <div className="mb-6 space-y-2" aria-hidden="true">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <Skeleton className="h-36 w-full" />
      <p className="sr-only" role="status">
        Loading clubs…
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <div className="flex gap-3">
              <Skeleton className="h-12 w-12 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <Skeleton className="mt-4 h-5 w-24 rounded-full" />
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-5/6" />
            <Skeleton className="mt-5 h-10 w-full" />
          </div>
        ))}
      </div>
    </Container>
  );
}
