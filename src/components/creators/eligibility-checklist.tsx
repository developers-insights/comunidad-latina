import Link from "next/link";
import { CheckCircle, Circle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Badge, BezelCard, buttonVariants } from "@/components/ui";
import { describeEligibilityCheck } from "@/lib/creators/eligibility-copy";
import type { EligibilityResult } from "@/lib/creators/eligibility";
import { cn } from "@/lib/utils";

/**
 * =============================================================================
 * QUÉ TE FALTA PARA SER CREADOR
 * =============================================================================
 *
 * Esta tarjeta existe para no mostrar nunca la peor pantalla posible: "no
 * calificás", sin más. Ese cartel no dice cuánto falta, no dice qué hacer y
 * suena a un juicio sobre la persona en vez de a una cuenta de números — y la
 * persona cierra la app.
 *
 * DOS REGLAS DURAS:
 *
 *  1. NINGÚN CÓDIGO CRUDO. Lo que la base llama `seguidores` acá dice "Te
 *     faltan 40 seguidores. Tenés 60 de 100". La traducción vive entera en
 *     `lib/creators/eligibility-copy.ts` y hay un test que exige que todo
 *     código tenga la suya.
 *
 *  2. SOLO LO QUE RIGE HOY. La lista se arma con los requisitos VIGENTES según
 *     la configuración del tenant (0064). Un umbral en 0 o una bandera apagada
 *     no es "un requisito que ya cumplís": es un requisito que no existe, y
 *     mostrarlo haría creer que la comunidad pide cosas que no pide. El filtro
 *     lo hace `evaluateEligibility`, que replica las guardas del SQL.
 *
 * Server Component: son datos que la página ya resolvió, sin interacción.
 * Accesibilidad: el estado nunca se comunica solo con color — cada fila lleva
 * su ícono y su texto.
 */

const COPY = {
  title: "Lo que te falta para recibir trabajos",
  titleReady: "Cumplís todos los requisitos",
  subtitlePending:
    "Tu comunidad pide esto para dejar que alguien cobre por sus trabajos. Cuando estén todos en verde, vas a poder mandar tu solicitud.",
  subtitleReady: "Ya podés mandar tu solicitud. La revisa el equipo de tu comunidad.",
  progress: (done: number, total: number) => `${done} de ${total} listos`,
  emptyTitle: "Tu comunidad no pide requisitos extra",
  emptyBody: "Podés mandar tu solicitud directamente.",
} as const;

export function CreatorEligibilityChecklist({
  result,
  className,
}: {
  result: EligibilityResult;
  className?: string;
}) {
  const { checks, eligible } = result;
  const done = checks.filter((check) => check.status === "met").length;

  return (
    <BezelCard
      variant={eligible ? "success" : "default"}
      coreClassName={cn("flex flex-col gap-5 p-5", className)}
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-foreground">
            {eligible ? COPY.titleReady : COPY.title}
          </h2>
          {checks.length > 0 && (
            <Badge variant={eligible ? "success" : "neutral"} className="shrink-0">
              {eligible && <CheckCircle size={13} weight="fill" aria-hidden="true" />}
              {COPY.progress(done, checks.length)}
            </Badge>
          )}
        </div>
        <p className="text-sm leading-relaxed text-foreground-secondary">
          {eligible ? COPY.subtitleReady : COPY.subtitlePending}
        </p>
      </header>

      {checks.length === 0 ? (
        <div>
          <p className="text-sm font-semibold text-foreground">{COPY.emptyTitle}</p>
          <p className="mt-0.5 text-sm text-foreground-secondary">{COPY.emptyBody}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {checks.map((check) => {
            const copy = describeEligibilityCheck(check);
            return (
              <li key={check.reason} className="flex items-start gap-2.5">
                <StatusIcon status={check.status} />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      check.status === "met" ? "text-foreground-secondary" : "text-foreground",
                    )}
                  >
                    {copy.title}
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed text-foreground-secondary">
                    {copy.detail}
                  </p>
                  {copy.action && (
                    <Link
                      href={copy.action.href}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2")}
                    >
                      {copy.action.label}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </BezelCard>
  );
}

function StatusIcon({ status }: { status: "met" | "missing" | "unknown" }) {
  if (status === "met") {
    return (
      <CheckCircle
        size={20}
        weight="fill"
        aria-label="Listo"
        className="mt-0.5 shrink-0 text-success"
      />
    );
  }
  if (status === "unknown") {
    return (
      <WarningCircle
        size={20}
        weight="fill"
        aria-label="No lo pudimos leer"
        className="mt-0.5 shrink-0 text-foreground-muted"
      />
    );
  }
  return (
    <Circle size={20} aria-label="Te falta" className="mt-0.5 shrink-0 text-foreground-muted" />
  );
}
