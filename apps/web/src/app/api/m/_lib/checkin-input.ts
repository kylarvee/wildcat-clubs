import "server-only";
import { z } from "zod";
import { invalid, parse } from "@/lib/domain/kit";
import { parseCheckinInput } from "./checkin-url";

const Body = z.object({
  url: z.string().max(2048).nullish(),
  code: z.string().max(64).nullish(),
  token: z.string().max(200).nullish(),
  via: z.enum(["mobile-scan", "mobile-popup"]).optional(),
});

/** The code + token from a check-in request body, or a plain-language 400. */
export function checkinInput(raw: unknown) {
  const body = parse(Body, raw);
  const parsed = parseCheckinInput(body);
  if (!parsed) {
    throw invalid(
      body.url
        ? "That QR code isn't a Wildcat Clubs check-in code. Scan the code on the club's check-in screen."
        : "Enter the 6-character code shown under the QR code.",
    );
  }
  return { ...parsed, via: body.via ?? "mobile-scan" };
}
