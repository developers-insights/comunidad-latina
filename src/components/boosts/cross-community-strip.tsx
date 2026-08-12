import Image from "next/image";
import { ArrowUpRight, Megaphone, MapPin } from "@phosphor-icons/react/dist/ssr";
import { Chip } from "@/components/ui";
import { isOptimizableSrc, listingPhotoUrl } from "@/components/listings";
import {
  recordBoostImpressions,
  selectCrossCommunityBoosts,
  type CrossCommunityBoost,
} from "@/lib/boosts/select";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";

/**
 * =============================================================================
 * IMPULSOS QUE LLEGAN DE OTRAS COMUNIDADES
 * =============================================================================
 *
 * Un aviso que compró alcance `nacional` o `global` (migración 0092) se muestra
 * también en las otras comunidades de la plataforma. Acá es donde se muestra.
 *
 * POR QUÉ UNA TIRA APARTE Y NO MEZCLADO CON LOS RESULTADOS
 *   1. Porque no funcionaría: las páginas de detalle exigen
 *      `listing.tenant_id = tenant.id` y devuelven 404 a cualquier otra cosa.
 *      Un aviso forastero entre los de la casa sería una tarjeta que al tocarla
 *      no lleva a ningún lado. El enlace de acá va al sitio de SU comunidad.
 *   2. Porque es más honesto. Alguien que entra a /propiedades de su comunidad
 *      está mirando la vidriera de su comunidad; que un aviso de otra ciudad se
 *      cuele entre los vecinos, aunque diga "Patrocinado", desdibuja lo único
 *      que hace útil a este producto. Separado y rotulado, se entiende de una.
 *
 * LA DIVULGACIÓN NO SE DEBILITA (FTC §255)
 *   Cada tarjeta lleva el chip "Patrocinado" —la MISMA palabra y el MISMO
 *   tratamiento visual que en el feed, en el reel y en los listados— más el
 *   nombre de la comunidad de origen. Una superficie nueva donde aparece
 *   contenido pago es una superficie nueva que tiene que divulgarlo; no hay
 *   excepción por ser "una tira chica al costado".
 *
 * Es un Server Component autocontenido: resuelve su comunidad desde el Host,
 * hace sus propias lecturas y, si no hay nada que mostrar, NO RENDERIZA NADA
 * (ni el encabezado ni un hueco). Una sección vacía en un listado no es
 * información, es ruido.
 */

const COPY = {
  titulo: "Patrocinado desde otras comunidades",
  ayuda:
    "Avisos de otras comunidades de la plataforma que pagaron para mostrarse acá. Abren en su propio sitio.",
  // La MISMA palabra que el resto de lo pago (contrato 2026-07-30 §4): una
  // divulgación que cambia de nombre según la pantalla deja de leerse como
  // divulgación.
  chip: "Patrocinado",
  desde: (comunidad: string) => `desde ${comunidad}`,
  abreEnOtroSitio: "Abre en el sitio de otra comunidad",
} as const;

/** Cuántas tarjetas entran. Dos: es publicidad, no es el contenido. */
const SLOTS = 2;

export async function ImpulsosDeOtrasComunidades({
  kind,
  className,
}: {
  /** Vertical de la pantalla: `property`, `business`, `professional`, `job`. */
  kind: string;
  className?: string;
}) {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);

  // La comunidad que MUESTRA y su país salen del servidor (Host → tenant), y el
  // país se vuelve a leer acá y no se toma de ninguna prop: quien decide a qué
  // país pertenece esta vidriera es el servidor, siempre.
  const { data: comunidad } = await supabase
    .from("tenants")
    .select("country_focus")
    .eq("id", tenant.id)
    .maybeSingle();

  const items = await selectCrossCommunityBoosts(supabase, {
    tenantId: tenant.id,
    tenantCountry: comunidad?.country_focus ?? null,
    kind,
    slots: SLOTS,
  });

  if (items.length === 0) return null;

  // Se sirvieron: se cuentan. Va después de decidir que hay algo que mostrar,
  // nunca antes — cobrar una impresión por algo que no se mostró sería el mismo
  // problema que este módulo existe para evitar.
  await recordBoostImpressions(items.map((item) => item.boostId));

  return (
    <section aria-label={COPY.titulo} className={cn("flex flex-col gap-2.5", className)}>
      <div>
        <h2 className="font-display text-base font-bold text-foreground">{COPY.titulo}</h2>
        <p className="mt-0.5 text-xs leading-snug text-foreground-secondary">{COPY.ayuda}</p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {items.map((item) => (
          <TarjetaForastera key={item.boostId} item={item} />
        ))}
      </div>
    </section>
  );
}

function TarjetaForastera({ item }: { item: CrossCommunityBoost }) {
  const photo = item.photoPath ? listingPhotoUrl(item.photoPath) : null;

  const contenido = (
    <>
      <span className="relative size-16 shrink-0 overflow-hidden rounded-md bg-surface-subtle">
        {photo ? (
          isOptimizableSrc(photo) ? (
            <Image src={photo} alt="" fill sizes="64px" className="object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- host externo fuera del allowlist de next/image
            <img src={photo} alt="" className="size-full object-cover" />
          )
        ) : null}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-1.5">
          {/* Mismo chip, misma palabra y mismo tratamiento dorado que el de los
              listados: la divulgación es una sola en toda la plataforma. */}
          <Chip
            variant="neutral"
            size="sm"
            className="border-[1.5px] border-sponsored bg-surface text-sponsored-ink"
          >
            <Megaphone size={12} weight="fill" aria-hidden="true" />
            {COPY.chip}
          </Chip>
          <span className="text-[11px] font-medium text-foreground-muted">
            {COPY.desde(item.communityName)}
          </span>
        </span>

        <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
          {item.title}
        </span>

        {item.areaLabel && (
          <span className="flex items-center gap-1 text-xs text-foreground-secondary">
            <MapPin size={12} aria-hidden="true" />
            {item.areaLabel}
          </span>
        )}
      </span>

      <ArrowUpRight
        size={16}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-foreground-muted transition-transform duration-(--duration-fast) ease-(--ease-spring) group-hover:-translate-y-[1px] group-hover:translate-x-[1px]"
      />
    </>
  );

  const clases = cn(
    "group flex items-start gap-3 rounded-xl border border-border-subtle bg-surface p-3",
    "ring-1 ring-sponsored/40",
    "transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-spring)",
    "hover:bg-surface-subtle active:scale-[0.99]",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
  );

  // `href` nulo significa que esa comunidad no tiene dominio activo. No pasa
  // por acá (el selector ya las descarta), pero si pasara la tarjeta se
  // renderiza SIN enlace en vez de con un `href` inventado.
  if (!item.href) {
    return <div className={clases}>{contenido}</div>;
  }

  return (
    <a
      href={item.href}
      // `noopener noreferrer`: es otro origen, aunque sea de la misma
      // plataforma. Y `title` dice a dónde va antes de tocarlo.
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={COPY.abreEnOtroSitio}
      className={clases}
    >
      {contenido}
    </a>
  );
}
