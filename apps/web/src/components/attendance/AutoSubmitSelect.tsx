"use client";

import type { ComponentProps } from "react";
import { Select } from "@/components/ui/form";

/** A filter <select> that applies itself on change (its GET form still has a submit button for no-JS). */
export function AutoSubmitSelect(props: ComponentProps<typeof Select>) {
  return <Select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
