import { cn } from "@/lib/utils";

/**
 * Clase base compartida por Input / Textarea / Select.
 * Estado de error via `aria-invalid` (lo setea <Field /> o el consumidor).
 */
export const fieldControlClass = cn(
  "w-full rounded-md border border-border bg-surface text-base text-foreground",
  "placeholder:text-placeholder",
  "transition-[border-color,box-shadow] duration-(--duration-fast) ease-(--ease-out-premium)",
  "hover:border-neutral-300 dark:hover:border-neutral-600",
  "focus-visible:border-brand",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-invalid:border-danger",
);

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(fieldControlClass, "h-11 px-4", className)}
      {...props}
    />
  );
}
