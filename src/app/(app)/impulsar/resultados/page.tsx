import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChartLineUp,
  CurrencyDollarSimple,
  Eye,
  Megaphone,
  Play,
  Rocket,
} from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Chip, EmptyState, buttonVariants } from "@/components/ui";
import { SectionTopBar } from "@/components/shell";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import {
  armarResumen,
  type CampanaResumen,
  type Medicion,
  type ListingLite,
  type PostLite,
  type TotalesDeCampanas,
} from "./resumen";

export const metadata = { title: "Cómo van tus promociones" };

/**
 * Copy local — mismo criterio que el índice y que /impulsar/crear: el módulo
 * Boost no escribe en `lib/i18n` ni en `feed/copy.ts`, que son compartidos.
 *
 * SIN JERGA DE MARKETING. Quien lee esto puso USD 25 de su bolsillo para que
 * vean su aviso; no sabe —ni tiene por qué saber— qué es una impresión, un CTR
 * o un alcance servido. Cada número se nombra por lo que le pasó a su aviso.
 */
const COPY = {
  titulo: "Cómo van tus promociones",
  bajada: "Todo lo que pagaste para llegar a más gente, junto y en un solo lugar.",

  activas: "Activas ahora",
  vecesMostrada: "Veces que se mostró",
  vistas: "Vistas en total",
  pagado: "Lo que pagaste",

  /**
   * Las etiquetas de FILA van en minúscula y cortas porque ahí se leen pegadas
   * al número ("240 veces que se mostró"), no como título de una tarjeta.
   */
  vecesMostradaFila: "veces que se mostró",
  vistasFila: "vistas",

  /**
   * Las aclaraciones que evitan que dos números parecidos se lean como un
   * error. Son las mismas distinciones que ya hace la pantalla de estadísticas
   * de un aviso, dichas una sola vez acá abajo en vez de una por tarjeta.
   *
   * Cada una se muestra SÓLO si su número está en pantalla: explicar una
   * métrica que no aparece en ningún lado (le pasa a quien únicamente
   * promocionó publicaciones) manda a buscar algo que no existe.
   */
  aclaracionMostrada:
    "«Veces que se mostró» cuenta cada vez que tu aviso ocupó el lugar pago en un listado.",
  aclaracionVistas:
    "«Vistas» cuenta a quien lo abrió, y son todas las del aviso, no sólo las del tiempo que pagaste.",

  estadoActiva: (dias: number) =>
    dias <= 0 ? "Termina hoy" : dias === 1 ? "Queda 1 día" : `Quedan ${dias} días`,
  estadoActivaCorto: "Activa",
  estadoTerminada: "Terminó",
  estadoCancelada: "Cancelada",

  huecoValor: "—",
  huecoEtiqueta: "No pudimos traerlo",
  huecoAviso:
    "Algunos números no se pudieron traer ahora mismo y los dejamos en blanco. No son ceros: volvé a entrar en un rato y van a estar.",

  tipoAviso: "Aviso",
  tipoPublicacion: "Publicación",

  vacioTitulo: "Todavía no promocionaste nada",
  vacioMensaje:
    "Cuando le pongas Boost a un aviso o a una publicación, acá vas a ver cuánta gente lo vio y cómo le fue.",
  vacioCta: "Ir a Boost",

  verDetalle: "Ver el detalle",
  tope: (n: number) => `Mostrando tus ${n} promociones más recientes.`,
} as const;

/** Tope de la lista. Acota también la lectura de impresiones de abajo. */
const LIMIT = 20;

/**
 * =============================================================================
 * /impulsar/resultados — "Cómo van tus promociones"
 * =============================================================================
 *
 * EL PEDIDO. El cliente (video de seguimiento) pidió ver el rendimiento de la
 * publicidad "medio como Meta": cuánta gente la vio, quién hizo clic, si va
 * bien o va mal — y sin tener que entrar aviso por aviso.
 *
 * POR QUÉ ES UNA RUTA PROPIA Y NO UNA SECCIÓN DEL ÍNDICE. `/impulsar` tiene UN
 * trabajo: elegir qué promocionar. Es una pantalla de compra, y sus filas son
 * botones "Promocionar". Colgarle números de rendimiento a cada fila mezcla dos
 * decisiones distintas —"¿qué promociono?" y "¿cómo me fue con lo que ya
 * promocioné?"— en la misma lista, y encima obligaría a que la pantalla de
 * compra pague las consultas de métricas de todo el mundo, incluso de quien
 * nunca promocionó nada. Separadas, cada una hace una cosa y la hace rápido.
 *
 * Tampoco es una pestaña: las pestañas de este repo que navegan son `NavTabs`
 * (una URL por pestaña) y acá hay exactamente dos destinos, uno de los cuales
 * sólo tiene sentido si ya compraste algo. Un enlace desde el índice —que
 * aparece SÓLO si tenés promociones— dice lo mismo sin gastar una barra.
 *
 * CERO N+1. Dos idas a la base, no una por campaña:
 *   1ª  impulsos + promociones de publicaciones del usuario (en paralelo).
 *   2ª  los avisos, los posts y las impresiones de TODO lo anterior, con tres
 *       `in(...)` en paralelo.
 * Con 20 campañas son 5 consultas; con 1, también 5. El tope de `LIMIT` acota
 * además cuántas filas de `boost_impressions` entran (una por impulso y día).
 *
 * TODO SE RENDERIZA EN EL SERVIDOR. Sin `useEffect`, sin spinner, sin fetch en
 * vivo: la pantalla baja con los números puestos (HARD RULE de velocidad del
 * repo). La única isla de cliente sería una animación, y no hace falta ninguna.
 */
export default async function ResultadosDePromocionesPage() {
  const [tenant, supabase] = await Promise.all([getTenant(), createClient()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?next=/impulsar/resultados");

  // `pending_payment` queda afuera a propósito, igual que en `fetchListingStats`:
  // un checkout abandonado nunca se sirvió y no tiene resultados que mostrar.
  // Listarlo acá sólo agregaría filas en cero a una pantalla cuyo único trabajo
  // es decir si lo que se pagó sirvió.
  const [{ data: boostRows }, { data: promoRows }] = await Promise.all([
    supabase
      .from("boosts")
      .select("id, listing_id, status, amount_cents, ends_at, created_at")
      .eq("tenant_id", tenant.id)
      .eq("buyer_id", user.id)
      .neq("status", "pending_payment")
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("post_promotions")
      .select("id, post_id, status, amount_cents, ends_at, created_at")
      .eq("tenant_id", tenant.id)
      .eq("buyer_id", user.id)
      .neq("status", "pending_payment")
      .order("created_at", { ascending: false })
      .limit(LIMIT),
  ]);

  const boosts = boostRows ?? [];
  const promociones = promoRows ?? [];
  const ahoraMs = new Date().getTime();

  const listingIds = [...new Set(boosts.map((row) => row.listing_id))];
  const postIds = [...new Set(promociones.map((row) => row.post_id))];
  const boostIds = boosts.map((row) => row.id);

  const [listingsRes, postsRes, impresionesRes] = await Promise.all([
    listingIds.length > 0
      ? // Sin filtro de `status`: un aviso pausado o vencido sigue teniendo una
        // campaña que se pagó, y su título tiene que poder mostrarse.
        supabase.from("listings").select("id, title, photos, view_count").in("id", listingIds)
      : Promise.resolve({ data: [] as ListingLite[], error: null }),
    postIds.length > 0
      ? supabase.from("posts").select("id, body, media, view_count").in("id", postIds)
      : Promise.resolve({ data: [] as PostLite[], error: null }),
    boostIds.length > 0
      ? supabase.from("boost_impressions").select("boost_id, impressions").in("boost_id", boostIds)
      : Promise.resolve({ data: [] as { boost_id: string; impressions: number | null }[], error: null }),
  ]);

  const listingsPorId = new Map(
    ((listingsRes.data ?? []) as ListingLite[]).map((row) => [row.id, row]),
  );
  const postsPorId = new Map(((postsRes.data ?? []) as PostLite[]).map((row) => [row.id, row]));

  // `null` = la lectura se cayó ENTERA, y entonces ningún impulso puede mostrar
  // un número. Un `Map` vacío, en cambio, significa "se leyó y no hay ninguna
  // impresión todavía", que es un cero de verdad. La diferencia es el punto de
  // toda esta pantalla.
  let impresionesPorBoost: Map<string, number> | null = null;
  if (impresionesRes.error) {
    console.warn("[resultados] no se pudieron leer las impresiones — se informan como hueco", {
      code: impresionesRes.error.code,
    });
  } else {
    impresionesPorBoost = new Map();
    // La tabla viene agregada por (impulso, día): acá sólo se suman los días.
    for (const row of impresionesRes.data ?? []) {
      const previo = impresionesPorBoost.get(row.boost_id) ?? 0;
      impresionesPorBoost.set(row.boost_id, previo + (row.impressions ?? 0));
    }
  }

  const { campanas, totales } = armarResumen({
    boosts,
    promociones,
    listingsPorId,
    postsPorId,
    impresionesPorBoost,
    ahoraMs,
  });

  const hayHuecos = campanas.some(
    (c) => c.vecesMostrada.estado === "ilegible" || c.vistas.estado === "ilegible",
  );
  // Una aclaración sólo se muestra si su número está en pantalla en algún lado.
  const muestraVecesMostrada = campanas.some((c) => c.vecesMostrada.estado !== "no_aplica");
  const muestraVistas = campanas.some((c) => c.vistas.estado !== "no_aplica");

  return (
    <div className="flex flex-col gap-6 pb-8">
      <SectionTopBar fallbackHref="/impulsar" />

      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.titulo}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.bajada}</p>
      </header>

      {campanas.length === 0 ? (
        <EmptyState
          icon={<ChartLineUp size={32} weight="fill" aria-hidden="true" />}
          title={COPY.vacioTitulo}
          message={COPY.vacioMensaje}
          action={
            <Link href="/impulsar" className={buttonVariants({ variant: "primary", size: "md" })}>
              <Rocket size={18} aria-hidden="true" />
              {COPY.vacioCta}
            </Link>
          }
        />
      ) : (
        <>
          {/* EL VISTAZO. Cuatro números como mucho: si tengo algo corriendo,
              cuánto se mostró, cuánto se vio y cuánto me costó. Es lo que se
              mira antes de decidir si se vuelve a comprar; cualquier tarjeta
              extra acá sería un tablero que nadie lee. */}
          <section aria-label={COPY.titulo} className="flex flex-col gap-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              {tarjetasDeTotales(totales).map((tarjeta, index, todas) => (
                <TarjetaTotal
                  key={tarjeta.label}
                  {...tarjeta}
                  // Cantidad impar: la última ocupa las dos columnas. Con tres
                  // tarjetas (le pasa a quien sólo promocionó publicaciones) el
                  // hueco de abajo a la derecha se lee como algo que falta.
                  anchoCompleto={todas.length % 2 === 1 && index === todas.length - 1}
                />
              ))}
            </div>
            {(muestraVecesMostrada || muestraVistas) && (
              <p className="text-xs leading-relaxed text-foreground-muted">
                {muestraVecesMostrada && COPY.aclaracionMostrada}
                {muestraVecesMostrada && muestraVistas && " "}
                {muestraVistas && COPY.aclaracionVistas}
              </p>
            )}
            {hayHuecos && (
              <p className="text-xs leading-relaxed text-foreground-muted">{COPY.huecoAviso}</p>
            )}
          </section>

          <section aria-label="Tus promociones" className="flex flex-col gap-2.5">
            <ul className="flex flex-col gap-2.5">
              {campanas.map((campana) => (
                <FilaDeCampana key={`${campana.tipo}-${campana.id}`} campana={campana} />
              ))}
            </ul>
            {campanas.length >= LIMIT && (
              <p className="text-center text-xs text-foreground-muted">
                {COPY.tope(campanas.length)}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface TarjetaDeTotal {
  icon: React.ReactNode;
  label: string;
  medicion?: Medicion;
  texto?: string;
  destacada?: boolean;
}

/**
 * Las tarjetas del vistazo, ya filtradas.
 *
 * Una medición `no_aplica` NO produce tarjeta. Verificado en pantalla con datos
 * reales: quien sólo promocionó publicaciones veía un "—" mudo en "Veces que se
 * mostró" (las publicaciones no ocupan un lugar pago que contar), y eso se lee
 * como algo roto, no como algo que no corresponde. Mismo criterio que las
 * celdas de cada fila.
 */
function tarjetasDeTotales(totales: TotalesDeCampanas): TarjetaDeTotal[] {
  const todas: TarjetaDeTotal[] = [
    {
      icon: <Rocket size={20} weight="fill" aria-hidden="true" />,
      label: COPY.activas,
      medicion: { estado: "ok", valor: totales.activas },
      destacada: totales.activas > 0,
    },
    {
      icon: <Megaphone size={20} weight="fill" aria-hidden="true" />,
      label: COPY.vecesMostrada,
      medicion: totales.vecesMostrada,
    },
    {
      icon: <Eye size={20} weight="fill" aria-hidden="true" />,
      label: COPY.vistas,
      medicion: totales.vistas,
    },
    {
      icon: <CurrencyDollarSimple size={20} weight="fill" aria-hidden="true" />,
      label: COPY.pagado,
      texto: `USD ${Math.round(totales.pagadoCents / 100).toLocaleString("es-US")}`,
    },
  ];
  return todas.filter((t) => t.medicion?.estado !== "no_aplica");
}

/**
 * Un total. Misma forma que las tarjetas de `[listingId]/estadisticas` para que
 * las dos pantallas se lean como un solo producto.
 *
 * Una medición `ilegible` muestra un guion Y la nota de por qué está en blanco:
 * falló algo y se dice. Las `no_aplica` ya no llegan acá (ver `tarjetasDeTotales`).
 */
function TarjetaTotal({
  icon,
  label,
  medicion,
  texto,
  destacada = false,
  anchoCompleto = false,
}: TarjetaDeTotal & { anchoCompleto?: boolean }) {
  const ilegible = medicion?.estado === "ilegible";
  const sinNumero = medicion !== undefined && medicion.estado !== "ok";

  return (
    <BezelCard
      variant={destacada ? "featured" : "default"}
      className={anchoCompleto ? "col-span-2" : undefined}
      coreClassName="flex flex-col gap-1 p-4"
    >
      <span className={sinNumero ? "text-foreground-muted" : "text-brand"} aria-hidden="true">
        {icon}
      </span>
      <span
        className={cn(
          "numeric font-display text-2xl font-bold",
          sinNumero ? "text-foreground-muted" : "text-foreground",
        )}
      >
        {texto ??
          (medicion?.estado === "ok"
            ? medicion.valor.toLocaleString("es-US")
            : COPY.huecoValor)}
      </span>
      <span className="text-xs text-foreground-secondary">{label}</span>
      {ilegible && (
        <span className="text-[11px] leading-tight text-foreground-muted">
          {COPY.huecoEtiqueta}
        </span>
      )}
    </BezelCard>
  );
}

function FilaDeCampana({ campana }: { campana: CampanaResumen }) {
  const contenido = <CuerpoDeCampana campana={campana} />;

  // Sin `href` es porque lo promocionado ya no está: la fila queda para que el
  // gasto siga a la vista, pero no linkea a un 404.
  return (
    <li>
      {campana.href ? (
        <Link
          href={campana.href}
          aria-label={`${COPY.verDetalle}: ${campana.titulo}`}
          className={cn(
            "block rounded-xl",
            "transition-transform duration-(--duration-fast) ease-(--ease-spring) active:scale-[0.99]",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
          )}
        >
          {contenido}
        </Link>
      ) : (
        contenido
      )}
    </li>
  );
}

function CuerpoDeCampana({ campana }: { campana: CampanaResumen }) {
  return (
    <BezelCard coreClassName="flex flex-col gap-3 p-3.5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-subtle"
        >
          {campana.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- thumbnail de 48px de un bucket propio; no es el LCP de esta página
            <img src={campana.thumbnailUrl} alt="" className="size-full object-cover" />
          ) : (
            <Megaphone size={20} className="text-foreground-muted" />
          )}
          {campana.thumbnailIsVideo && (
            <span className="cl-print-fill absolute inset-0 flex items-center justify-center bg-media-scrim">
              <Play size={12} weight="fill" className="text-on-media" />
            </span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{campana.titulo}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <ChipDeEstado campana={campana} />
            <span className="text-[11px] text-foreground-muted">
              {campana.tipo === "aviso" ? COPY.tipoAviso : COPY.tipoPublicacion}
            </span>
          </div>
        </div>

        {campana.pagadoCents != null && (
          <span className="numeric shrink-0 text-sm font-semibold text-foreground">
            USD {Math.round(campana.pagadoCents / 100)}
          </span>
        )}
      </div>

      {/* Los números de la campaña. Una celda `no_aplica` no se dibuja: una
          publicación promocionada no tiene lugar pago que contar, y un "—" ahí
          haría pensar que algo se rompió. Si no queda ninguna —le pasa a una
          campaña cuyo contenido ya se borró—, tampoco va la línea divisoria:
          sería un renglón vacío con un borde arriba. */}
      {hayAlgunDato(campana) && (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-border-subtle pt-2.5">
          <DatoDeCampana label={COPY.vecesMostradaFila} medicion={campana.vecesMostrada} />
          <DatoDeCampana label={COPY.vistasFila} medicion={campana.vistas} />
        </div>
      )}
    </BezelCard>
  );
}

/** ¿Queda al menos un número que dibujar en la fila? */
function hayAlgunDato(campana: CampanaResumen): boolean {
  return campana.vecesMostrada.estado !== "no_aplica" || campana.vistas.estado !== "no_aplica";
}

function ChipDeEstado({ campana }: { campana: CampanaResumen }) {
  if (campana.estado === "activa") {
    return (
      <Chip variant="success" size="sm">
        {campana.diasRestantes === null
          ? COPY.estadoActivaCorto
          : COPY.estadoActiva(campana.diasRestantes)}
      </Chip>
    );
  }
  return (
    <Chip variant="neutral" size="sm">
      {campana.estado === "cancelada" ? COPY.estadoCancelada : COPY.estadoTerminada}
    </Chip>
  );
}

function DatoDeCampana({ label, medicion }: { label: string; medicion: Medicion }) {
  if (medicion.estado === "no_aplica") return null;
  const ilegible = medicion.estado === "ilegible";

  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={cn(
          "numeric text-base font-bold",
          ilegible ? "text-foreground-muted" : "text-foreground",
        )}
      >
        {medicion.estado === "ok" ? medicion.valor.toLocaleString("es-US") : COPY.huecoValor}
      </span>
      <span className="text-xs text-foreground-secondary">{label}</span>
    </span>
  );
}
