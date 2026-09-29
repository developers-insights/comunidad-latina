"use client";

import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { Spinner, fieldControlClass } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { UsernameLiveStatus } from "./use-username-availability";

/**
 * Campo de nombre de usuario, con la arroba pegada adentro del control.
 *
 * ── POR QUÉ LA ARROBA ES UN ADORNO Y NO PARTE DEL VALOR ──────────────────────
 * La columna guarda `rosa.martinez`, sin `@`. Si la arroba viviera dentro del
 * `<input>`, cada pegado desde otra app (donde la gente copia `@rosa.martinez`)
 * dejaría un valor con dos arrobas o una que hay que recortar en el servidor.
 * Va fuera del campo, como prefijo visual: se ve como un handle y se guarda como
 * un handle.
 *
 * ── LO QUE SE NORMALIZA MIENTRAS SE ESCRIBE ──────────────────────────────────
 * Sólo minúsculas y el recorte de la arroba pegada. NADA más: si el campo
 * borrara los caracteres inválidos en vivo, escribir "rosa martinez" haría
 * desaparecer el espacio sin explicación y la persona no entendería por qué su
 * texto se transforma solo. Lo inválido se marca con un mensaje, que sí explica.
 */
export interface UsernameInputProps {
  id: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  /**
   * Ícono de estado a la derecha del campo — comprobando / disponible. Ausente
   * (u "idle"/"unknown"/"invalid"/"taken") no dibuja nada acá: esos estados ya
   * se explican con el mensaje debajo del campo, no necesitan un segundo ícono.
   */
  liveStatus?: UsernameLiveStatus;
}

export function UsernameInput({
  id,
  name,
  value,
  onChange,
  invalid,
  describedBy,
  disabled,
  liveStatus,
}: UsernameInputProps) {
  const showStatusIcon = liveStatus === "checking" || liveStatus === "available";
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 select-none text-base font-medium text-foreground-muted"
      >
        @
      </span>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="text"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={30}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/^@+/, "").toLowerCase())}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        // `h-11 px-4` es lo que agrega <Input> sobre la clase base; acá se
        // repite con el `pl-8` que le hace lugar a la arroba y el `pr-10` que
        // le hace lugar al ícono de estado cuando hay uno.
        className={cn(fieldControlClass, "h-11 px-4 pl-8", showStatusIcon && "pr-10")}
      />
      {liveStatus === "checking" && (
        <Spinner
          size={16}
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-foreground-muted"
        />
      )}
      {liveStatus === "available" && (
        <CheckCircle
          size={18}
          weight="fill"
          aria-hidden="true"
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-success"
        />
      )}
    </div>
  );
}
