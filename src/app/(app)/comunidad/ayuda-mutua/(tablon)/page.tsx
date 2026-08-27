import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, CaretDown, HandsClapping, Plus } from "@phosphor-icons/react/dist/ssr";
import { Bubble, EmptyState, buttonVariants } from "@/components/ui";
import { ModuleFilterChips, type FilterOption } from "@/components/search";
import {
  ComunidadHeading,
  ManoCard,
  ManoListSkeleton,
  OfrecerEnTema,
  ReglasDeAyuda,
  ZonaBuscador,
} from "@/components/comunidad";
import {
  COMUNIDAD_COPY,
  HELP_DIRECTION_COPY,
  HELP_TOPICS,
  HELP_TOPIC_LABEL,
  isHelpDirection,
  isHelpTopic,
  type HelpDirection,
  type HelpTopic,
} from "@/lib/comunidad";
import { getAuthUserId } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { fetchHelpBoard } from "../../queries";

export const metadata = { title: "Dar y pedir una mano" };

const C = COMUNIDAD_COPY.ayudaMutua;

/**
 * =============================================================================
 * EL TABLÓN DE AYUDA MUTUA — las dos direcciones en una sola lista
 * =============================================================================
 *
 * Es la parte del módulo Comunidad que la gente ESCRIBE. Las otras seis puertas
 * de la portada llevan a fichas curadas (o a Perdido y encontrado); ésta lleva
 * a lo que publicaron los vecinos, ya revisado por el equipo.
 *
 * ── POR QUÉ UNA SOLA LISTA Y NO DOS PESTAÑAS ────────────────────────────────
 * "Quién se ofrece" y "dónde hacen falta manos" son las dos caras del mismo
 * pedido del cliente, y separarlas en pestañas obligaría a mirar las dos para
 * entender qué está pasando en el barrio. Van juntas, con los pedidos arriba
 * (`sortNeedsFirst`: un pedido tiene fecha y cupo; un ofrecimiento sigue
 * disponible mañana) y con un filtro para quien quiera ver una sola.
 *
 * ── HACE FALTA CUENTA PARA VER ESTO ─────────────────────────────────────────
 * La policy de SELECT de `community_help_notices` (0120) no incluye a `anon`.
 * Sin sesión la consulta vuelve vacía y esta pantalla muestra su estado vacío
 * con el botón de entrar. No es una pared de pago disfrazada: es que cada fila
 * lleva a una persona de una población perseguible pegada a un barrio, y eso no
 * se publica en internet abierto (§5.4).
 *
 * ── LO QUE NO HAY ACÁ ───────────────────────────────────────────────────────
 * Ni impulsos, ni destacados, ni orden comprable. No se le vende posición a
 * alguien que ofrece ayuda — mismo criterio que Perdido y encontrado.
 *
 * Todo el estado vive en la URL (?tema=&modo=&zona=&cursor=): se comparte por
 * link, sobrevive al botón atrás y el Server Component lo lee sin sincronizar
 * nada.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface Filtros {
  tema: HelpTopic | null;
  modo: HelpDirection | null;
  zona: string;
  cursor: string;
}

function primerValor(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseFiltros(sp: Record<string, string | string[] | undefined>): Filtros {
  const tema = primerValor(sp.tema);
  const modo = primerValor(sp.modo);
  return {
    // Las MISMAS guardas que deciden si una fila de la base se muestra: un
    // search param es texto libre que cualquiera escribe a mano.
    tema: isHelpTopic(tema) ? tema : null,
    modo: isHelpDirection(modo) ? modo : null,
    zona: primerValor(sp.zona).slice(0, 80),
    cursor: primerValor(sp.cursor).slice(0, 200),
  };
}

const OPCIONES_MODO: readonly FilterOption[] = [
  { value: "", label: C.filtros.todo },
  { value: "need", label: HELP_DIRECTION_COPY.need.filtro },
  { value: "offer", label: HELP_DIRECTION_COPY.offer.filtro },
];

const OPCIONES_TEMA: readonly FilterOption[] = [
  { value: "", label: C.filtros.todosLosTemas },
  ...HELP_TOPICS.map((topic) => ({ value: topic, label: HELP_TOPIC_LABEL[topic] })),
];

export default async function AyudaMutuaPage({ searchParams }: { searchParams: SearchParams }) {
  const filtros = parseFiltros(await searchParams);

  return (
    <>
      <Link
        href="/comunidad"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {COMUNIDAD_COPY.index.title}
      </Link>

      <ComunidadHeading
        className="mt-2"
        icon={<HandsClapping size={30} weight="fill" aria-hidden="true" />}
        title={C.title}
        subtitle={C.subtitle}
      />

      <p className="mt-4 text-sm leading-relaxed text-foreground-secondary">{C.intro}</p>

      {/* Las dos puertas, con el mismo peso: es el pedido del cliente entero.
          Cuando hay un tema filtrado se abren YA con ese tema puesto, así nadie
          lo vuelve a elegir en el paso 1. */}
      <OfrecerEnTema topic={filtros.tema ?? "voluntariado"} className="mt-4" />

      <ReglasDeAyuda variante="lectura" className="mt-4" />

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
        <Link
          href="/comunidad/ayuda-mutua/mios"
          className="inline-flex min-h-11 items-center text-sm font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          {C.misAvisosCta}
        </Link>
      </div>

      {/* Bandeja de filtros: la zona primero —es con lo que se decide si algo
          sirve— y los chips después, igual que en Perdido y encontrado. */}
      <Bubble tone="tray" shape="tile" size="none" className="mb-5 mt-4 space-y-4 p-4">
        <ZonaBuscador
          inputId="ayuda-zona"
          label={C.filtros.zonaLabel}
          placeholder={C.filtros.zonaPlaceholder}
          help={C.filtros.zonaHelp}
        />
        <ModuleFilterChips param="modo" label={C.filtros.direccionLabel} options={OPCIONES_MODO} />
        <ModuleFilterChips param="tema" label={C.filtros.temaLabel} options={OPCIONES_TEMA} />
      </Bubble>

      <Suspense key={JSON.stringify(filtros)} fallback={<ManoListSkeleton />}>
        <Tablon filtros={filtros} />
      </Suspense>
    </>
  );
}

async function Tablon({ filtros }: { filtros: Filtros }) {
  const [tenant, viewerId] = await Promise.all([getTenant(), getAuthUserId()]);

  const { items, nextCursor, failed, needsSession } = await fetchHelpBoard({
    tenantId: tenant.id,
    viewerId,
    topic: filtros.tema,
    direction: filtros.modo,
    area: filtros.zona || null,
    cursor: filtros.cursor || null,
  });

  const hayFiltro = Boolean(filtros.zona || filtros.tema || filtros.modo);

  /**
   * Mirando sin cuenta. NO es un error y no se pinta como tal: la 0120 le niega
   * SELECT a `anon` a propósito (un tablón público de nombre + barrio + "pido
   * ayuda con esto" es un padrón), así que este camino es el diseño
   * funcionando. Antes caía en la rama de abajo y mostraba un cartel rojo que
   * además decía "No pudimos ENVIARLO" en una pantalla donde no se envía nada.
   */
  if (needsSession) {
    return (
      <EmptyState
        illustration="/images/empty-state-search.png"
        title={COMUNIDAD_COPY.ofrecerse.sinSesion.title}
        message={COMUNIDAD_COPY.ofrecerse.sinSesion.message}
        action={
          <Link
            href="/entrar?next=/comunidad/ayuda-mutua"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COMUNIDAD_COPY.ofrecerse.sinSesion.cta}
          </Link>
        }
      />
    );
  }

  if (items.length === 0) {
    return (
      <>
        {/* "No pudimos leer" NO es lo mismo que "no hay": si la consulta falló,
            decirlo evita que alguien concluya que en su barrio nadie ayuda.
            Acá `failed` ya excluye el 42501 de mirar sin sesión, que se atiende
            arriba con su propia pantalla. */}
        {failed && (
          <p
            role="alert"
            className="mb-4 rounded-md bg-danger-bg px-3 py-2.5 text-sm leading-relaxed text-danger-ink"
          >
            {COMUNIDAD_COPY.ofrecerse.errors.leer}
          </p>
        )}
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={hayFiltro ? C.vacio.filtradoTitle : C.vacio.title}
          message={hayFiltro ? C.vacio.filtradoMessage : C.vacio.message}
          action={
            hayFiltro ? (
              <Link
                href="/comunidad/ayuda-mutua"
                className={buttonVariants({ variant: "primary", size: "md" })}
              >
                {C.verTodos}
              </Link>
            ) : (
              <Link
                href="/comunidad/ayuda-mutua/publicar"
                className={buttonVariants({ variant: "primary", size: "md" })}
              >
                <Plus size={18} aria-hidden="true" />
                {C.publicarCta}
              </Link>
            )
          }
        />
      </>
    );
  }

  // El "ver más" arrastra los filtros: sin esto la segunda página vuelve al
  // listado completo y parece que la búsqueda se rompió.
  const siguiente = new URLSearchParams();
  if (filtros.zona) siguiente.set("zona", filtros.zona);
  if (filtros.tema) siguiente.set("tema", filtros.tema);
  if (filtros.modo) siguiente.set("modo", filtros.modo);
  if (nextCursor) siguiente.set("cursor", nextCursor);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {items.map((aviso) => (
          <ManoCard key={aviso.id} aviso={aviso} />
        ))}
      </div>

      {nextCursor && (
        <Link
          href={`/comunidad/ayuda-mutua?${siguiente.toString()}`}
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
        >
          Ver más avisos
          <CaretDown size={16} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
