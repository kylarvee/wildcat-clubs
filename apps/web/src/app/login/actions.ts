"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { signInWeb, signOutWeb } from "@/lib/auth/session";
import { personasEnabled } from "@/lib/auth/google";
import { PERSONAS } from "@/lib/auth/personas";
import { findOrCreateUserByEmail } from "@/lib/auth/accounts";

function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export async function signInAsPersona(formData: FormData) {
  if (!personasEnabled()) throw new Error("Test personas are turned off.");
  const key = String(formData.get("persona"));
  const persona = PERSONAS.find((p) => p.key === key);
  if (!persona) throw new Error("Unknown persona.");
  const user = (await db.user.findUnique({ where: { email: persona.email } })) ?? (await findOrCreateUserByEmail({ email: persona.email, name: persona.name }));
  await signInWeb(user.id);
  redirect(safeNext(String(formData.get("next") ?? "")));
}

/** Test sign-in with any university email (creates the account on first use, like Google would). */
export async function signInWithTestEmail(formData: FormData) {
  if (!personasEnabled()) throw new Error("Test sign-in is turned off.");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const user = await findOrCreateUserByEmail({ email, name: name || email.split("@")[0] });
  await signInWeb(user.id);
  redirect(safeNext(String(formData.get("next") ?? "")));
}

export async function signOut() {
  await signOutWeb();
  redirect("/");
}
