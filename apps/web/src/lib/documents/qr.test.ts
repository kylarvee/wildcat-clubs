import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { qrRows } from "./qr";

describe("qrRows", () => {
  const url = "http://localhost:3100/c/BUILD8?t=AbCdEf123456";

  it("is a square of 0s and 1s, one string per row", () => {
    const rows = qrRows(url);
    expect(rows.length).toBeGreaterThanOrEqual(21);
    for (const r of rows) {
      expect(r).toHaveLength(rows.length);
      expect(r).toMatch(/^[01]+$/);
    }
  });

  it("matches the QR the web's live screen draws (error correction M)", () => {
    const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
    const rows = qrRows(url);
    expect(rows).toHaveLength(modules.size);
    for (let r = 0; r < modules.size; r++) for (let c = 0; c < modules.size; c++) expect(rows[r][c]).toBe(modules.get(r, c) ? "1" : "0");
  });

  it("has the three finder squares in its corners", () => {
    const rows = qrRows(url);
    const n = rows.length;
    // Each finder pattern's outer row is seven dark modules.
    expect(rows[0].slice(0, 7)).toBe("1111111");
    expect(rows[0].slice(n - 7)).toBe("1111111");
    expect(rows[n - 1].slice(0, 7)).toBe("1111111");
    // …with a light ring inside.
    expect(rows[1].slice(0, 7)).toBe("1000001");
  });

  it("changes when the token does", () => {
    expect(qrRows(url)).not.toEqual(qrRows(url.replace("AbCdEf123456", "ZyXwVu987654")));
  });
});
