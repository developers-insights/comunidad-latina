import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Label } from "./label";

export interface FieldProps {
  /** id del control interno — conecta label, ayuda y error. */
  htmlFor: string;
  label: string;
  /** Texto de ayuda debajo del control. */
  help?: string;
  /**
   * Mensaje de error cálido y accionable (nunca "Campo inválido").
   * El consumidor debe además pasar `aria-invalid` y
   * `aria-describedby={`${id}-error`}` al control.
   */
  error?: string;
  /** Marca visual de opcionalidad — lo requerido es el default silencioso. */
  optional?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Field({
  htmlFor,
  label,
  help,
  error,
  optional = false,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {optional && (
          <span className="text-xs text-foreground-muted">Opcional</span>
        )}
      </div>
      {children}
      {error ? (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="flex items-start gap-1.5 text-sm text-danger"
        >
          <WarningCircle
            size={16}
            weight="fill"
            aria-hidden="true"
            className="mt-0.5 shrink-0"
          />
          {error}
        </p>
      ) : help ? (
        <p id={`${htmlFor}-help`} className="text-sm text-foreground-muted">
          {help}
        </p>
      ) : null}
    </div>
  );
}
