import "server-only";
import { invalid } from "@/lib/domain/kit";
import { MAX_UPLOAD_BYTES } from "@/lib/files/storage";

/** Room for the multipart boundaries and the form's text fields around the file. */
const FORM_OVERHEAD = 512 * 1024;

/**
 * Reads an upload route's multipart form without holding more than the upload
 * limit in memory: a declared Content-Length over it is refused before reading,
 * and a body without one is cut off once it passes the limit. Callers check
 * sign-in first, so strangers can't make the server buffer anything.
 */
export async function readUploadForm(req: Request, limit = MAX_UPLOAD_BYTES + FORM_OVERHEAD): Promise<FormData> {
  const tooLarge = () => invalid(`Files can be up to ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  if (Number(req.headers.get("content-length")) > limit) throw tooLarge();
  if (!req.body) throw invalid("No file was attached.");
  let seen = 0;
  const capped = req.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        seen += chunk.byteLength;
        if (seen > limit) ctl.error(new Error("too large"));
        else ctl.enqueue(chunk);
      },
    }),
  );
  try {
    return await new Response(capped, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    throw seen > limit ? tooLarge() : invalid("That upload didn't arrive in one piece. Please try again.");
  }
}
