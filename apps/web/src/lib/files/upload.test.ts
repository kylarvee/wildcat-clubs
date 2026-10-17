import { describe, expect, it } from "vitest";
import { readUploadForm } from "@/lib/files/upload";

/** A multipart body with no Content-Length (chunked), the way a client can skip declaring it. */
async function undeclared(size: number) {
  const fd = new FormData();
  fd.append("title", "Minutes");
  fd.append("file", new Blob([new Uint8Array(size)]), "minutes.pdf");
  const encoded = new Request("http://x/", { method: "POST", body: fd });
  const headers = { "content-type": encoded.headers.get("content-type")! };
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 1024) c.enqueue(bytes.subarray(i, i + 1024));
      c.close();
    },
  });
  return new Request("http://x/", { method: "POST", body, headers, duplex: "half" } as RequestInit);
}

describe("readUploadForm", () => {
  it("reads a form under the limit", async () => {
    const form = await readUploadForm(await undeclared(2000), 10_000);
    expect(form.get("title")).toBe("Minutes");
    expect((form.get("file") as File).size).toBe(2000);
  });

  it("refuses a declared Content-Length over the limit without reading", async () => {
    const req = new Request("http://x/", { method: "POST", body: "x", headers: { "content-length": "999999" } });
    await expect(readUploadForm(req, 10_000)).rejects.toThrow(/up to 25 MB/);
    expect(req.bodyUsed).toBe(false);
  });

  it("cuts off an undeclared body once it passes the limit", async () => {
    await expect(readUploadForm(await undeclared(50_000), 10_000)).rejects.toThrow(/up to 25 MB/);
  });

  it("says so when the form is malformed", async () => {
    const req = new Request("http://x/", { method: "POST", body: "not a form", headers: { "content-type": "multipart/form-data; boundary=zz" } });
    await expect(readUploadForm(req, 10_000)).rejects.toThrow(/didn't arrive in one piece/);
  });
});
