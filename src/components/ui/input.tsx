import { cn } from "@/lib/utils";

/**
 * Clase base compartida por Input / Textarea / Select.
 * Estado de error via `aria-invalid` (lo setea <Field /> o el consumidor).
 */
export const fieldControlClass = cn(
  "w-full rounded-md border border-border bg-surface text-base text-foreground",
  "placeholder:text-placeholder",
  "transition-[border-color,box-shadow] duration-(--duration-fast) ease-(--ease-out-premium)",
  "hover:border-border-strong",
  "focus-visible:border-brand",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-invalid:border-danger",
);

/**
 * `ComponentProps<"input">` y no `InputHTMLAttributes`: la segunda NO incluye
 * `ref`, así que cualquier consumidor que necesitara medir o enfocar el campo
 * tenía que colgar el ref de un contenedor y buscar el input desde ahí (lo hace
 * hoy `components/onboarding/zone-input.tsx`). En React 19 `ref` es una prop
 * más de los componentes de función, no hace falta `forwardRef`.
 */
export type InputProps = React.ComponentProps<"input">;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(fieldControlClass, "h-11 px-4", className)}
      {...props}
    />
  );
}
