"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { toast } from "@/components/ui/misc";
import { addDepartmentAction } from "@/app/admin/clubs/actions";
import { useFormSubmit } from "@/components/founding/useFormSubmit";

/** One click: add the founder's "Other" department to the list (or link an existing one with that name) and link the club. */
export function AddDepartmentForm({ clubId, requested, colleges, defaultCollegeId, compact }: { clubId: string; requested: string; colleges: { id: string; name: string }[]; defaultCollegeId?: string | null; compact?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { pending, onSubmit } = useFormSubmit(async (fd) => {
    setError(null);
    const r = await addDepartmentAction({ clubId, name: String(fd.get("name") ?? ""), collegeId: String(fd.get("collegeId") ?? "") || null });
    if (!r.ok) return setError(r.error);
    toast.success(`${r.data.name} added and linked`);
    router.refresh();
  });
  return (
    <form onSubmit={onSubmit} className={compact ? "flex flex-col gap-2 lg:flex-row lg:items-end" : "grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"} noValidate aria-busy={pending}>
      <Field label="Department name" error={error} className="min-w-0 flex-1">
        {(id) => <Input id={id} name="name" defaultValue={requested} maxLength={120} required />}
      </Field>
      <Field label="College" className="min-w-0 flex-1">
        {(id) => (
          <Select id={id} name="collegeId" defaultValue={defaultCollegeId ?? ""}>
            <option value="">No college</option>
            {colleges.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Button type="submit" disabled={pending} className={error ? "lg:mb-6" : ""}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
        {pending ? "Adding…" : "Add department & link"}
      </Button>
    </form>
  );
}
