"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/form";

/**
 * Whole-number input that never hands the parent NaN: half-typed values
 * ("" or "-") stay local until they parse, and blur restores the last good one.
 */
export function NumberInput({
  value,
  onValue,
  min,
  max,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange" | "type" | "min" | "max"> & { value: number; onValue: (n: number) => void; min?: number; max?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <Input
      {...props}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isInteger(n)) onValue(n);
      }}
      onBlur={(e) => {
        setText(String(value));
        props.onBlur?.(e);
      }}
    />
  );
}
