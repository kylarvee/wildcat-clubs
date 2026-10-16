"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
      <p className="mt-3 text-ink-2">Please try again. If it keeps happening, tell your club advisor or WSUSA.</p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-ink-3">Reference: {error.digest}</p> : null}
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
