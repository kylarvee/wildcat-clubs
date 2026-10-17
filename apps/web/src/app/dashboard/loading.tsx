import { Card } from "@/components/ui/card";
import { Container, Skeleton } from "@/components/ui/layout";

export default function Loading() {
  return (
    <Container size="xl">
      <p className="sr-only" role="status">
        Loading your dashboard…
      </p>
      <div aria-hidden="true">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="mt-3 h-4 w-48" />
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            {[0, 1].map((i) => (
              <Card key={i} className="space-y-4 p-5">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </Card>
            ))}
          </div>
          <Card className="space-y-4 p-5">
            <Skeleton className="h-5 w-28" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </Card>
        </div>
      </div>
    </Container>
  );
}
