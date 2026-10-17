import { Container, Skeleton } from "@/components/ui/layout";

export default function Loading() {
  return (
    <Container size="xl" className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid min-h-[34rem] overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="hidden space-y-2 border-r border-line p-3 lg:block">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
        <div className="space-y-3 p-3">
          <Skeleton className="h-9 w-full" />
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-8 w-8" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only" role="status">
        Loading files…
      </span>
    </Container>
  );
}
