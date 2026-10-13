import { Suspense } from "react";
import { SealCheck } from "@phosphor-icons/react/dist/ssr";
import { Badge, BezelCard, Skeleton } from "@/components/ui";
import { PLANES_PRESENCIA, type PlanId } from "@/lib/stripe";
import { getViewerFormatDate } from "@/lib/time/viewer-zone";
import { GestionarPlan } from "./gestionar-plan";
import { leerVigencia } from "./vigencia";

const COPY = {
  eyebrow: "Tu plan",
  plan: (nombre: string) => `Plan ${nombre}`,
  pagoPendiente: "Pago pendiente",
  seCancela: "Se cancela",
  renueva: (fecha: string) => `Se renueva el ${fecha}.`,
  termina: (fecha: string) => `Lo cancelaste: tu presencia sigue activa hasta el ${fecha}.`,
  pagoPendienteDetalle:
    "No pudimos cobrar la última cuota. Actualizá tu tarjeta para que tu negocio siga visible.",
  ayuda: (finSiCancela: string | null) =>
    finSiCancela
      ? `Podés actualizar tu tarjeta, ver tus facturas o cancelar. Si cancelás, tu presencia sigue hasta el ${finSiCancela}.`
      : "Podés actualizar tu tarjeta, ver tus facturas o cancelar. Si cancelás, tu presencia sigue hasta el final del período que ya pagaste.",
  ayudaCancelado: "Si cambiás de idea, desde ahí mismo podés reanudarlo.",
} as const;

const ESTADOS_DE_COBRO_PENDIENTE = new Set(["past_due", "unpaid"]);

export function MiPlan({
  plan,
  planStatus,
  subscriptionId,
  stripeConfigured,
}: {
  plan: PlanId;
  planStatus: string | null;
  subscriptionId: string | null;
  stripeConfigured: boolean;
}) {
  const pagoPendiente = ESTADOS_DE_COBRO_PENDIENTE.has(planStatus ?? "");

  return (
    <BezelCard variant="featured" className="mt-6" coreClassName="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            {COPY.eyebrow}
          </p>
          <h2 className="mt-1 flex items-center gap-2 font-display text-xl font-bold text-foreground">
            <SealCheck size={22} weight="fill" aria-hidden="true" className="text-success" />
            {COPY.plan(PLANES_PRESENCIA[plan].nombre)}
          </h2>
        </div>
        {pagoPendiente && <Badge variant="warning">{COPY.pagoPendiente}</Badge>}
      </div>

      {pagoPendiente && (
        <p className="text-sm text-foreground-secondary">{COPY.pagoPendienteDetalle}</p>
      )}

      {stripeConfigured && subscriptionId ? (
        <Suspense fallback={<VigenciaEsqueleto />}>
          <VigenciaYAyuda subscriptionId={subscriptionId} />
        </Suspense>
      ) : (
        <p className="text-sm text-foreground-secondary">{COPY.ayuda(null)}</p>
      )}

      <GestionarPlan />
    </BezelCard>
  );
}

async function VigenciaYAyuda({ subscriptionId }: { subscriptionId: string }) {
  const [vigencia, formatDate] = await Promise.all([
    leerVigencia(subscriptionId),
    getViewerFormatDate(),
  ]);
  const fecha = vigencia ? formatDate(vigencia.fecha, { style: "long" }) : null;

  if (vigencia?.tipo === "termina" && fecha) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          <Badge variant="warning">{COPY.seCancela}</Badge>
          {COPY.termina(fecha)}
        </p>
        <p className="text-sm text-foreground-secondary">{COPY.ayudaCancelado}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {fecha && (
        <p className="numeric text-sm font-medium text-foreground">{COPY.renueva(fecha)}</p>
      )}
      <p className="text-sm text-foreground-secondary">{COPY.ayuda(fecha)}</p>
    </div>
  );
}

function VigenciaEsqueleto() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-44" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}
