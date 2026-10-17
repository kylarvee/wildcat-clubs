import { Card } from "@/components/ui/card";
import { Container, Skeleton } from "@/components/ui/layout";

export default function Loading() {
  return (
    <Container size="lg">
      <p className="sr-only" role="status">
        Loading profile…
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_300px]" aria-hidden="true">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <Skeleton className="h-24 rounded-none sm:h-28" />
            <div className="px-6 pb-6">
              <Skeleton className="-mt-12 h-24 w-24 rounded-full ring-4 ring-white" />
              <Skeleton className="mt-4 h-7 w-56" />
              <Skeleton className="mt-2 h-4 w-80 max-w-full" />
              <Skeleton className="mt-2 h-4 w-40" />
            </div>
          </Card>
          {[0, 1, 2].map((i) => (
            <Card key={i} className="space-y-3 p-6">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </Card>
          ))}
        </div>
        <div className="space-y-6">
          <Card className="space-y-3 p-5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </Card>
        </div>
      </div>
    </Container>
  );
}
