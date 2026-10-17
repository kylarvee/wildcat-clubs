"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { Tooltip } from "@/components/ui/misc";
import { MapEmbed } from "@/components/embeds/MapEmbed";
import { useRunAction } from "@/components/roles/useRunAction";
import { deleteDirectoryItemAction, saveDirectoryItemAction, type DirectoryKind } from "@/app/admin/directory/actions";

export type Option = { id: string; name: string };
export type DepartmentOption = Option & { collegeId: string | null };

export type DirectoryItem =
  | { kind: "college"; id: string; name: string; shortName: string }
  | { kind: "department"; id: string; name: string; collegeId: string | null }
  | { kind: "major"; id: string; name: string; collegeId: string | null; departmentId: string | null }
  | { kind: "building"; id: string; code: string; name: string; campus: string; address: string | null; lat: number | null; lng: number | null };

const NOUN: Record<DirectoryKind, string> = { college: "college", department: "department", major: "major", building: "building" };
const CAMPUSES = ["Ogden", "Davis", "Farmington Station", "Online"];

/** Add or edit one directory entry. `item` null = add. */
export function DirectoryItemDialog({
  kind,
  item,
  colleges = [],
  departments = [],
  mapsSuffix,
}: {
  kind: DirectoryKind;
  item: DirectoryItem | null;
  colleges?: Option[];
  departments?: DepartmentOption[];
  mapsSuffix?: string;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, setError, run } = useRunAction();
  const editing = Boolean(item);
  const noun = NOUN[kind];

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    void run(() => saveDirectoryItemAction(kind, item?.id ?? null, input), {
      success: editing ? "Saved" : `Added ${input.name || noun}`,
      onSuccess: () => setOpen(false),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        {editing ? (
          <Button size="sm" variant="ghost" aria-label={`Edit ${itemLabel(item!)}`}>
            <Pencil className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Edit</span>
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="h-4 w-4" aria-hidden /> Add {noun}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={editing ? `Edit ${itemLabel(item!)}` : `Add a ${noun}`} wide={kind === "building"}>
        <form onSubmit={submit} noValidate className="space-y-4" aria-busy={pending}>
          {kind === "college" ? <CollegeFields item={item?.kind === "college" ? item : null} /> : null}
          {kind === "department" ? <DepartmentFields item={item?.kind === "department" ? item : null} colleges={colleges} /> : null}
          {kind === "major" ? <MajorFields item={item?.kind === "major" ? item : null} colleges={colleges} departments={departments} /> : null}
          {kind === "building" ? <BuildingFields item={item?.kind === "building" ? item : null} mapsSuffix={mapsSuffix ?? ""} /> : null}
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {editing ? "Save changes" : `Add ${noun}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function itemLabel(item: DirectoryItem) {
  return item.kind === "building" ? `${item.name} (${item.code})` : item.name;
}

function CollegeFields({ item }: { item: Extract<DirectoryItem, { kind: "college" }> | null }) {
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
      <Field label="Name" required>
        {(id) => <Input id={id} name="name" defaultValue={item?.name} maxLength={120} required autoFocus placeholder="College of Engineering, Applied Science & Technology" />}
      </Field>
      <Field label="Short name" required hint="Used on cards and filters.">
        {(id) => <Input id={id} name="shortName" defaultValue={item?.shortName} maxLength={30} required placeholder="EAST" />}
      </Field>
    </div>
  );
}

function CollegeSelect({ name = "collegeId", value, defaultValue, onChange, colleges, hint }: { name?: string; value?: string; defaultValue?: string; onChange?: (v: string) => void; colleges: Option[]; hint?: ReactNode }) {
  return (
    <Field label="College" hint={hint}>
      {(id) => (
        <Select id={id} name={name} value={value} defaultValue={defaultValue} onChange={onChange ? (e) => onChange(e.target.value) : undefined}>
          <option value="">No college</option>
          {colleges.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function DepartmentFields({ item, colleges }: { item: Extract<DirectoryItem, { kind: "department" }> | null; colleges: Option[] }) {
  return (
    <>
      <Field label="Name" required>
        {(id) => <Input id={id} name="name" defaultValue={item?.name} maxLength={120} required autoFocus placeholder="Department of Psychology" />}
      </Field>
      <CollegeSelect defaultValue={item?.collegeId ?? ""} colleges={colleges} />
    </>
  );
}

function MajorFields({ item, colleges, departments }: { item: Extract<DirectoryItem, { kind: "major" }> | null; colleges: Option[]; departments: DepartmentOption[] }) {
  const [collegeId, setCollegeId] = useState(item?.collegeId ?? "");
  const [departmentId, setDepartmentId] = useState(item?.departmentId ?? "");
  const shown = collegeId ? departments.filter((d) => d.collegeId === collegeId || d.id === departmentId) : departments;
  return (
    <>
      <Field label="Name" required>
        {(id) => <Input id={id} name="name" defaultValue={item?.name} maxLength={120} required autoFocus placeholder="Computer Science" />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <CollegeSelect
          value={collegeId}
          onChange={(v) => {
            setCollegeId(v);
            const d = departments.find((x) => x.id === departmentId);
            if (d && v && d.collegeId && d.collegeId !== v) setDepartmentId("");
          }}
          colleges={colleges}
        />
        <Field label="Department" hint="Picking one fills in its college.">
          {(id) => (
            <Select
              id={id}
              name="departmentId"
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                const d = departments.find((x) => x.id === e.target.value);
                if (d?.collegeId) setCollegeId(d.collegeId);
              }}
            >
              <option value="">No department</option>
              {shown.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </>
  );
}

function BuildingFields({ item, mapsSuffix }: { item: Extract<DirectoryItem, { kind: "building" }> | null; mapsSuffix: string }) {
  const [preview, setPreview] = useState({ name: item?.name ?? "", lat: item?.lat?.toString() ?? "", lng: item?.lng?.toString() ?? "" });
  const [draft, setDraft] = useState(preview);
  const listId = useId();
  const lat = Number(preview.lat);
  const lng = Number(preview.lng);
  const hasCoords = preview.lat.trim() !== "" && preview.lng.trim() !== "" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  // The map reloads only when a field loses focus, not on every keystroke.
  const commit = () => setPreview(draft);
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
          <Field label="Code" required>
            {(id) => <Input id={id} name="code" defaultValue={item?.code} maxLength={10} required autoFocus className="uppercase" placeholder="SU" />}
          </Field>
          <Field label="Name" required>
            {(id) => <Input id={id} name="name" defaultValue={item?.name} maxLength={120} required placeholder="Shepherd Union" onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} onBlur={commit} />}
          </Field>
        </div>
        <Field label="Campus" required>
          {(id) => (
            <>
              <Input id={id} name="campus" defaultValue={item?.campus ?? "Ogden"} maxLength={60} required list={listId} />
              <datalist id={listId}>
                {CAMPUSES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Street address" hint="Optional. Shown with directions.">
          {(id) => <Input id={id} name="address" defaultValue={item?.address ?? ""} maxLength={200} placeholder="3848 Harrison Blvd, Ogden, UT 84408" />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Latitude">
            {(id) => <Input id={id} name="lat" inputMode="decimal" defaultValue={item?.lat ?? ""} placeholder="41.1922" onChange={(e) => setDraft((d) => ({ ...d, lat: e.target.value }))} onBlur={commit} />}
          </Field>
          <Field label="Longitude">
            {(id) => <Input id={id} name="lng" inputMode="decimal" defaultValue={item?.lng ?? ""} placeholder="-111.9437" onChange={(e) => setDraft((d) => ({ ...d, lng: e.target.value }))} onBlur={commit} />}
          </Field>
        </div>
        <p className="text-xs text-ink-3">Coordinates pin the exact building. In Google Maps, right-click the building and click the numbers to copy them.</p>
      </div>
      <div className="min-w-0">
        <p className="mb-1.5 text-sm font-medium text-ink">Map preview</p>
        {hasCoords || preview.name.trim() ? (
          <MapEmbed lat={hasCoords ? lat : null} lng={hasCoords ? lng : null} query={hasCoords ? null : `${preview.name}, ${mapsSuffix}`} label={preview.name || "New building"} height={260} />
        ) : (
          <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-line-2 px-6 text-center text-sm text-ink-3">Enter a name or coordinates to preview the pin.</div>
        )}
        {!hasCoords && preview.name.trim() ? <p className="mt-1.5 text-xs text-ink-3">No coordinates yet, so the pin comes from searching the name.</p> : null}
      </div>
    </div>
  );
}

/** Delete, unless something uses the entry (then the button explains why it can't). */
export function DeleteDirectoryItemButton({ kind, id, name, inUse }: { kind: DirectoryKind; id: string; name: string; inUse: string | null }) {
  const { pending, run } = useRunAction();
  if (inUse) {
    return (
      <Tooltip content={`In use by ${inUse} — can't be deleted`}>
        <span tabIndex={0} className="inline-flex rounded-lg focus-visible:outline-2 focus-visible:outline-brand" aria-label={`${name} can't be deleted: in use by ${inUse}`}>
          <Button size="sm" variant="ghost" disabled aria-hidden tabIndex={-1}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </span>
      </Tooltip>
    );
  }
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-50 hover:text-danger" disabled={pending} aria-label={`Delete ${name}`}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
        </Button>
      }
      title={`Delete ${name}?`}
      description={`Nothing uses this ${NOUN[kind]}, so it can be removed from the directory. This can't be undone.`}
      confirmLabel="Delete"
      danger
      onConfirm={() => void run(() => deleteDirectoryItemAction(kind, id), { success: `${name} deleted`, toastError: true })}
    />
  );
}
