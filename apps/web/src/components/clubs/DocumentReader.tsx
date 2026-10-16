"use client";

import type { ReactNode } from "react";
import { BookOpen } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Opens a governing document (constitution, bylaws) to read in place. The content is rendered on the server and passed in. */
export function DocumentReader({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" aria-label={`Read ${title}`}>
          <BookOpen className="h-4 w-4" aria-hidden="true" /> Read
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={subtitle} wide>
        <div className="max-h-[65dvh] overflow-y-auto pr-1">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
