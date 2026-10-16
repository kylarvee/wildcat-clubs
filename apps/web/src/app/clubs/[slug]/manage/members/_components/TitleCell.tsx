"use client";

import { useRef, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { toast } from "@/components/ui/misc";
import { saveInternalTitle } from "../actions";

/** Inline editor for a member's club-defined internal title ("Lead Mentor", "Pledge Class 2025"). */
export function TitleCell({ slug, membershipId, name, value, editable }: { slug: string; membershipId: string; name: string; value: string | null; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  if (!editable) return <span className="text-sm text-ink-2">{value || <span className="text-ink-3">—</span>}</span>;

  async function save() {
    if ((draft.trim() || null) === (value || null)) return setEditing(false);
    setSaving(true);
    const r = await saveInternalTitle(slug, membershipId, draft).catch(() => ({ ok: false as const, error: "We couldn't reach the server. Try again." }));
    setSaving(false);
    if (r.ok) {
      setEditing(false);
      toast.success(draft.trim() ? `Saved ${name}'s title.` : `Cleared ${name}'s title.`);
      requestAnimationFrame(() => button.current?.focus());
    } else toast.error(r.error);
  }

  if (!editing) {
    return (
      <button
        ref={button}
        type="button"
        onClick={() => {
          setDraft(value ?? "");
          setEditing(true);
        }}
        className="group inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-sm text-ink-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand"
        aria-label={value ? `Edit ${name}'s title: ${value}` : `Add a title for ${name}`}
      >
        <span className="truncate">{value || <span className="text-ink-3">Add title</span>}</span>
        <Pencil className="h-3.5 w-3.5 shrink-0 text-ink-3 opacity-60 group-hover:opacity-100" aria-hidden />
      </button>
    );
  }

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input
        autoFocus
        value={draft}
        maxLength={60}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        className="h-8 min-w-[9rem]"
        aria-label={`Internal title for ${name}`}
        placeholder="e.g. Lead Mentor"
        disabled={saving}
      />
      <Button type="submit" size="icon" variant="ghost" className="h-8 w-8" aria-label="Save title" disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Cancel" onClick={() => setEditing(false)} disabled={saving}>
        <X className="h-4 w-4" />
      </Button>
    </form>
  );
}
