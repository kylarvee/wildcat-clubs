import { googleTokenSignInEnabled, personasEnabled } from "@/lib/auth/google";
import { PERSONAS } from "@/lib/auth/personas";
import { mobile, preflight } from "../../_lib/http";
import type { MAuthOptions } from "../../_types";

/**
 * GET /api/m/auth/personas → MAuthOptions — what the sign-in screen offers:
 * test personas (when AUTH_MODE allows them) and whether Google sign-in can
 * be verified here. Public; reveals nothing beyond the web sign-in page.
 */
export async function GET() {
  return mobile(async (): Promise<MAuthOptions> => {
    const enabled = personasEnabled();
    return {
      personasEnabled: enabled,
      personas: enabled ? PERSONAS.map((p) => ({ key: p.key, name: p.name, email: p.email, group: p.group, label: p.label, blurb: p.blurb })) : [],
      googleEnabled: googleTokenSignInEnabled(),
    };
  });
}

export const OPTIONS = preflight;
