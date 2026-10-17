"use server";

import { revalidatePath } from "next/cache";
import type { ConfigKey } from "@/lib/config";
import { act } from "@/lib/domain/kit";
import { confirmConfig, setConfigs } from "@/lib/domain/system";

/**
 * Saves one section of platform rules (or one switch). Rules change behavior
 * on every page, so the whole app is refreshed.
 */
export async function saveConfigAction(values: Partial<Record<ConfigKey, unknown>>) {
  const r = await act((actor) => setConfigs(actor, values));
  if (r.ok && r.data.changed.length) revalidatePath("/", "layout");
  return r;
}

/** "These details are correct" for settings still holding their shipped placeholder values. */
export async function confirmConfigAction(keys: ConfigKey[]) {
  const r = await act((actor) => confirmConfig(actor, keys));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
