import { Container, Skeleton } from "@/components/ui/layout";

export default function Loading() {
  return (
    <Container size="md">
      <p className="sr-only" role="status">
        Loading notifications…
      </p>
      <div aria-hidden="true">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="mt-3 h-4 w-40" />
        <div className="mt-8 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-3 rounded-xl border border-line bg-surface p-4">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Container>
  );
}
