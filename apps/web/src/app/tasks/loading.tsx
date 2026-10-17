import { Card } from "@/components/ui/card";
import { Container, Skeleton } from "@/components/ui/layout";

export default function Loading() {
  return (
    <Container>
      <p className="sr-only" role="status">
        Loading your tasks…
      </p>
      <div aria-hidden="true">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        <div className="mt-8 flex gap-4 border-b border-line pb-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
        </div>
        <Card className="mt-6 p-5">
          <Skeleton className="h-10 w-full" />
        </Card>
        <Card className="mt-5 space-y-5 p-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-5 w-5" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </Card>
      </div>
    </Container>
  );
}
