import "server-only";
import type { StreamEvent } from "@/lib/ai/types";

/**
 * A server-sent-events response for the assistant's routes. The work keeps
 * running if the browser goes away (closing the panel mid-answer), so the
 * stored conversation always ends in a consistent state; events are simply
 * no longer delivered. A comment line every 15 s keeps proxies from closing
 * the connection while Claude thinks.
 */
export function sseResponse(run: (emit: (event: StreamEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };
      const emit = (event: StreamEvent) => send(`data: ${JSON.stringify(event)}\n\n`);
      const ping = setInterval(() => send(": keep-alive\n\n"), 15_000);
      void (async () => {
        try {
          await run(emit);
        } catch (e) {
          console.error("[assistant] stream failed", e);
          emit({ type: "fatal", message: "Something went wrong on our side. Try again in a moment." });
        } finally {
          clearInterval(ping);
          if (open) {
            open = false;
            try {
              controller.close();
            } catch {
              // Already closed by the client.
            }
          }
        }
      })();
    },
    cancel() {
      open = false;
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

/** A JSON error in the same shape as apiRoute's, for problems found before streaming starts. */
export function jsonError(status: number, error: string, code: string) {
  return Response.json({ ok: false, error, code }, { status, headers: { "cache-control": "no-store" } });
}
