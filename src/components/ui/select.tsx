import { CaretDown } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { fieldControlClass } from "./input";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/** Select nativo (mejor en mobile) con caret propio de Phosphor. */
export function Select({ className, children, ...props }: SelectProps) {
  return (
    <span className={cn("relative block", className)}>
      <select
        className={cn(fieldControlClass, "h-11 appearance-none pl-4 pr-10")}
        {...props}
      >
        {children}
      </select>
      <CaretDown
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-foreground-muted"
      />
    </span>
  );
}
