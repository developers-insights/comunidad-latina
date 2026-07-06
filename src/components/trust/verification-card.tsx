import { CheckCircle, XCircle } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { BezelCard } from "@/components/ui/bezel-card";

/**
 * Resultado del verificador de profesionales (Escudo Anti-Estafa, §3.3):
 * SIEMPRE binario y grande — verde o rojo, nunca un gris que deje duda.
 * El disclaimer legal es fijo y no editable (§11 del plan).
 */
export interface VerificationCardProps {
  status: "found_active" | "not_found";
  /**
   * Descriptor literal del registro oficial,
   * ej. "Abogado licenciado en NY, matrícula #12345".
   * En not_found: el nombre/dato buscado.
   */
  descriptor: string;
  /** Nombre del registro consultado, ej. "el colegio de abogados de NY". */
  registry: string;
  /** Fecha de la consulta ya formateada, ej. "6 de julio de 2026". */
  date: string;
  className?: string;
}

export function VerificationCard({
  status,
  descriptor,
  registry,
  date,
  className,
}: VerificationCardProps) {
  const found = status === "found_active";

  return (
    <BezelCard
      variant={found ? "success" : "danger"}
      className={cn("w-full", className)}
      coreClassName="flex flex-col items-center gap-3 px-6 py-8 text-center"
      role="status"
    >
      {found ? (
        <CheckCircle
          size={48}
          weight="fill"
          aria-hidden="true"
          className="text-success"
        />
      ) : (
        <XCircle
          size={48}
          weight="fill"
          aria-hidden="true"
          className="text-danger"
        />
      )}

      {found ? (
        <>
          <p className="font-display text-xl font-bold text-foreground">
            {descriptor}
          </p>
          {/* Disclaimer legal EXACTO — no editar (§11 del plan) */}
          <p className="max-w-[44ch] text-sm text-foreground-secondary">
            Licencia activa según {registry} al {date}. Esto NO garantiza
            conducta — nunca envíes dinero por adelantado.
          </p>
        </>
      ) : (
        <>
          <p className="font-display text-xl font-bold text-foreground">
            No encontrado
          </p>
          <p className="max-w-[44ch] text-sm text-foreground-secondary">
            &ldquo;{descriptor}&rdquo; no aparece en {registry} al {date}. No
            es un representante acreditado — no le envíes dinero ni tus
            documentos.
          </p>
        </>
      )}
    </BezelCard>
  );
}
