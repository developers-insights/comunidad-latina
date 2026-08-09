import { MagnifyingGlass, X } from "@phosphor-icons/react/dist/ssr";
import { Button, Input, buttonVariants } from "@/components/ui";
import Link from "next/link";

/**
 * BUSCADOR DE UN TRABAJO POR SU CÓDIGO.
 *
 * Form nativo con `method="get"`: la búsqueda queda en la URL, se puede
 * compartir y volver atrás, y funciona sin JavaScript. No hace falta un client
 * component para un campo y un botón.
 *
 * El texto de ayuda nombra LOS DOS formatos a propósito. Quien tiene un recibo
 * de antes de agosto tiene anotado `CL-2026-0007`, no `CL-CM-2026-000007`, y si
 * la pantalla solo mostrara el formato nuevo asumiría que su código está mal.
 * La búsqueda acepta cualquiera de los dos (ver `lib/creators/job-code.ts`).
 */

const COPY = {
  label: "Buscar por código",
  placeholder: "CL-CM-2026-000007",
  help: "Es el código que figura en el contrato o el recibo. También sirve el formato viejo (CL-2026-0007).",
  submit: "Buscar",
  clear: "Limpiar",
} as const;

export function JobCodeSearch({ value, action }: { value?: string; action: string }) {
  return (
    <form action={action} method="get" role="search" className="mb-4 flex flex-col gap-1.5">
      <label htmlFor="codigo" className="text-sm font-medium text-foreground">
        {COPY.label}
      </label>
      <div className="flex gap-2">
        <Input
          id="codigo"
          name="codigo"
          type="search"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          defaultValue={value ?? ""}
          placeholder={COPY.placeholder}
          aria-describedby="codigo-help"
          className="numeric flex-1 uppercase"
        />
        <Button type="submit" variant="secondary" size="md" className="shrink-0">
          <MagnifyingGlass size={18} aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">{COPY.submit}</span>
        </Button>
        {value && (
          <Link
            href={action}
            className={`${buttonVariants({ variant: "ghost", size: "md" })} shrink-0`}
          >
            <X size={18} aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{COPY.clear}</span>
          </Link>
        )}
      </div>
      <p id="codigo-help" className="text-sm text-foreground-muted">
        {COPY.help}
      </p>
    </form>
  );
}
