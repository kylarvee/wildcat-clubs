import { getCurrentUser } from "@/lib/auth/session";
import { DomainError } from "@/lib/domain/kit";
import { loadInvoiceForViewer } from "@/lib/domain/funding";
import { renderInvoicePdf } from "@/lib/funding/invoice-pdf";

/**
 * GET /api/invoices/:id/pdf[?download=1]
 * The funding invoice as a PDF, inline (for the in-page preview) or as a
 * download. Admins can open any invoice; a club's budget holders can open
 * their own club's. Everyone else gets 404, so ids reveal nothing.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getCurrentUser();
  if (!actor) return new Response("Sign in to view this invoice.", { status: 401, headers: { "cache-control": "private, no-store" } });

  let invoice;
  try {
    invoice = await loadInvoiceForViewer(actor, id);
  } catch (e) {
    if (e instanceof DomainError) {
      const status = e.code === "UNAUTHENTICATED" ? 401 : e.code === "FORBIDDEN" ? 403 : 404;
      return new Response(status === 404 ? "Invoice not found." : e.message, { status, headers: { "cache-control": "private, no-store" } });
    }
    throw e;
  }

  try {
    const pdf = await renderInvoicePdf(invoice);
    const download = new URL(req.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${invoice.number}.pdf"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    console.error(e);
    return new Response("We couldn't build this invoice PDF. Please try again.", { status: 500 });
  }
}
