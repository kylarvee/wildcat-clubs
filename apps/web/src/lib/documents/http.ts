import "server-only";
import { DomainError } from "@/lib/domain/kit";

/**
 * A generated document as the response: a download (or `?inline=1` to view
 * it in the browser, as the phone app does), never cached. Domain errors
 * become plain-text replies with their status, so ids reveal nothing.
 */
export async function pdfResponse(req: Request, make: () => Promise<{ pdf: Buffer; fileName: string }>): Promise<Response> {
  const noStore = { "cache-control": "private, no-store" };
  try {
    const { pdf, fileName } = await make();
    const inline = new URL(req.url).searchParams.get("inline") === "1";
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${fileName.replace(/[^\w.-]+/g, "-")}"`,
        "x-content-type-options": "nosniff",
        ...noStore,
      },
    });
  } catch (e) {
    if (e instanceof DomainError) {
      const status = e.code === "UNAUTHENTICATED" ? 401 : e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400;
      return new Response(e.message, { status, headers: noStore });
    }
    console.error(e);
    return new Response("We couldn't build this PDF just now. Please try again in a minute.", { status: 500, headers: noStore });
  }
}

/** Signed out: sign in first, then come straight back to the document (with its ?inline=1, if any). */
export function signInFirst(req: Request, path: string): Response {
  const back = `${path}${new URL(req.url).search}`;
  return Response.redirect(new URL(`/login?next=${encodeURIComponent(back)}`, req.url), 303);
}
