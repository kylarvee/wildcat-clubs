"use client";

import { useCallback, useState, useTransition } from "react";
import { toast } from "@/components/ui/misc";
import type { ActionResult } from "@/lib/domain/kit";

/**
 * Runs a server action that returns ActionResult, with a pending flag, an
 * inline error for the dialog that started it, and toasts. Server actions
 * revalidate their pages, so there's nothing to refresh by hand.
 */
export function useRunAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    <T,>(fn: () => Promise<ActionResult<T>>, opts: { success?: string; onSuccess?: (data: T) => void; toastError?: boolean } = {}) =>
      new Promise<ActionResult<T>>((resolve) => {
        setError(null);
        startTransition(async () => {
          let r: ActionResult<T>;
          try {
            r = await fn();
          } catch {
            r = { ok: false, error: "We couldn't reach the server. Check your connection and try again.", code: "ERROR" };
          }
          if (r.ok) {
            if (opts.success) toast.success(opts.success);
            opts.onSuccess?.(r.data);
          } else {
            setError(r.error);
            if (opts.toastError) toast.error(r.error);
          }
          resolve(r);
        });
      }),
    [],
  );

  return { pending, error, setError, run };
}
