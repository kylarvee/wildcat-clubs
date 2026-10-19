import QRCode from "qrcode";

/**
 * A QR code's modules as rows of "0"/"1" ("1" = dark), top row first, so the
 * app can draw the rotating check-in QR with plain views instead of shipping
 * a QR library. Error correction M, as on the web's live check-in screen.
 * Pure: no server imports, so it can be unit-tested.
 */
export function qrRows(text: string): string[] {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const rows: string[] = [];
  for (let r = 0; r < modules.size; r++) {
    let row = "";
    for (let c = 0; c < modules.size; c++) row += modules.get(r, c) ? "1" : "0";
    rows.push(row);
  }
  return rows;
}
