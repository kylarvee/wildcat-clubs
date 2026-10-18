"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { createTestAction } from "@/components/tests/actions";
import { KindChoice } from "@/components/tests/KindChoice";
import { LIMITS } from "@/lib/tests/editor";

/** "New test or form": asks which, and for a title, creates a draft, opens the builder. */
export function CreateTestButton({ clubId, basePath, label = "New test or form", variant = "primary" }: { clubId: string | null; basePath: string; label?: string; variant?: "primary" | "outline" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [isForm, setIsForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await createTestAction(clubId, title, isForm).catch(() => null);
      if (!r) return setError("We couldn't reach the server. Check your connection and try again.");
      if (!r.ok) return setError(r.error);
      router.push(`${basePath}/${r.data.id}`);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant}>
          <Plus className="h-4 w-4" aria-hidden /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent title="Start a new test or form" description="You'll add the intro, questions and settings next. It stays a draft until you publish it.">
        <form onSubmit={submit} className="space-y-4">
          <KindChoice isForm={isForm} onChange={setIsForm} name="new-kind" />
          <Field label="Title" required error={error}>
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.title} placeholder={isForm ? "e.g. Officer contact form" : "e.g. Event Safety Quiz"} autoFocus />}
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || title.trim().length < 3}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
