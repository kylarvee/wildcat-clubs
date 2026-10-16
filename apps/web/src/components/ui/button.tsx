import Link from "next/link";
import { forwardRef, type ComponentProps } from "react";
import { cn } from "@/components/ui/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg" | "icon";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap select-none";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-600 active:bg-brand-700 shadow-sm",
  secondary: "bg-brand-50 text-brand hover:bg-brand-100",
  outline: "border border-line-2 bg-surface text-ink hover:bg-muted",
  ghost: "text-ink-2 hover:bg-muted hover:text-ink",
  danger: "bg-danger text-white hover:bg-red-800 shadow-sm",
  link: "text-brand-600 underline-offset-2 hover:underline px-0 h-auto",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
  icon: "h-9 w-9 p-0",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], variant === "link" ? "" : sizes[size], className);
}

export type ButtonProps = ComponentProps<"button"> & { variant?: Variant; size?: Size };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant, size, className, type = "button", ...props }, ref) {
  return <button ref={ref} type={type} className={buttonClasses(variant, size, className)} {...props} />;
});

export function ButtonLink({ variant, size, className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}
