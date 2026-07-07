import { SealCheck } from "@phosphor-icons/react/dist/ssr";
import { Banner } from "@/components/ui";
import { isStripeConfigured } from "@/lib/config/services";
import { PLAN_IDS, PLANES_PRESENCIA } from "@/lib/stripe";
import { PlanesPresencia } from "./planes-presencia";

export const metadata = { title: "Presencia Verificada" };

/** Copy local del módulo PAGOS — no toca src/lib/i18n (compartido). */
const COPY = {
  titulo: "Presencia Verificada",
  subtitulo:
    "Tu negocio, presente en el directorio de tu comunidad todo el año — aunque no tengas un aviso activo.",
  exito:
    "¡Listo! Recibimos tu pago. Tu Presencia Verificada se activa en unos minutos.",
  cancelado:
    "No se hizo ningún cargo. Cuando quieras, tus planes te esperan acá.",
} as const;

export default async function PresenciaPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;

  return (
    <>
      {estado === "exito" && (
        <Banner
          variant="info"
          className="mb-4 rounded-lg"
          icon={<SealCheck size={20} className="text-success" />}
        >
          {COPY.exito}
        </Banner>
      )}
      {estado === "cancelado" && (
        <Banner variant="offline" className="mb-4 rounded-lg">
          {COPY.cancelado}
        </Banner>
      )}

      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
        {COPY.titulo}
      </h1>
      <p className="mt-1 text-sm text-foreground-secondary">{COPY.subtitulo}</p>

      <PlanesPresencia
        planes={PLAN_IDS.map((id) => PLANES_PRESENCIA[id])}
        stripeConfigured={isStripeConfigured}
      />
    </>
  );
}
