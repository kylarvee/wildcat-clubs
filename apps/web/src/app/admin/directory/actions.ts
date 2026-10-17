"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import * as directory from "@/lib/domain/directory";

export type DirectoryKind = "college" | "department" | "major" | "building";

/** The directory feeds every picker (founding, profiles, events), so refresh broadly. */
function refresh() {
  revalidatePath("/admin/directory");
  revalidatePath("/clubs");
}

export async function saveDirectoryItemAction(kind: DirectoryKind, id: string | null, input: Record<string, unknown>) {
  const r = await act(async (actor) => {
    switch (kind) {
      case "college": {
        const c = id ? await directory.updateCollege(actor, id, input) : await directory.createCollege(actor, input);
        return { id: c.id, name: c.name };
      }
      case "department": {
        const d = id ? await directory.updateDepartment(actor, id, input) : await directory.createDepartment(actor, input);
        return { id: d.id, name: d.name };
      }
      case "major": {
        const m = id ? await directory.updateMajor(actor, id, input) : await directory.createMajor(actor, input);
        return { id: m.id, name: m.name };
      }
      case "building": {
        const b = id ? await directory.updateBuilding(actor, id, input) : await directory.createBuilding(actor, input);
        return { id: b.id, name: b.name };
      }
    }
  });
  if (r.ok) refresh();
  return r;
}

export async function deleteDirectoryItemAction(kind: DirectoryKind, id: string) {
  const r = await act(async (actor) => {
    if (kind === "college") return directory.deleteCollege(actor, id);
    if (kind === "department") return directory.deleteDepartment(actor, id);
    if (kind === "major") return directory.deleteMajor(actor, id);
    return directory.deleteBuilding(actor, id);
  });
  if (r.ok) refresh();
  return r;
}
