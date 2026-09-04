import { Suspense } from "react";
import Link from "next/link";
import { CaretDown, HandHeart, Plus } from "@phosphor-icons/react/dist/ssr";
import { Bubble, EmptyState, buttonVariants } from "@/components/ui";
import { ModuleFilterChips, ModuleSearchBar, type FilterOption } from "@/components/search";
import {
  ComunidadHeading,
  PedidoCard,
  PedidoListSkeleton,
  ReglasDeAyuda,
  ZonaBuscador,
} from "@/components/comunidad";
import {
  COMUNIDAD_COPY,
  HELP_TOPICS,
  HELP_TOPIC_LABEL,
  isHelpTopic,
  type HelpTopic,
} from "@/lib/comunidad";
import { getAuthUserId } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { fetchHelpBoard } from "../../queries";

export const metadata = { title: "Pedir ayuda" };

const C = COMUNIDAD_COPY.pedirAyuda;

/**
 * =============================================================================
 * EL TABLÓN — la gente pide, la comunidad contesta
 * =============================================================================
 *
 * Es la parte del módulo Comunidad que la gente ESCRIBE. Las otras puertas de
 * la portada llevan a fichas curadas (o a Perdido y encontrado); ésta lleva a
 * lo que están necesitando los vecinos ahora mismo.
 *
 * ── QUÉ ERA ESTO ANTES ──────────────────────────────────────────────────────
 * `/comunidad/ayuda-mutua`, un tablón de dos direcciones donde también se
 * ofrecía ayuda. El cliente lo reencuadró el 2026-09-03: los ofrecimientos
 * salen (responsabilidad legal si alguien se lastima) y lo que queda son los
 * pedidos, con respuestas públicas. Las URLs viejas redirigen acá con 308.
 *
 * ── HACE FALTA CUENTA PARA VER ESTO ─────────────────────────────────────────
 * La policy de SELECT de `community_help_notices` (0120) no incluye a `anon`.
 * Sin sesión la consulta vuelve vacía y esta pantalla muestra su estado propio
 * con el botón de entrar. No es una pared de pago disfrazada: cada fila lleva a
 * una persona de una población perseguible pegada a un barrio y a lo que le
 * falta, y eso no se publica en internet abierto (§5.4).
 *
 * ── LO QUE NO HAY ACÁ ───────────────────────────────────────────────────────
 * Ni impulsos, ni destacados, ni orden comprable. No se le vende posición a
 * alguien que necesita algo — mismo criterio que Perdido y encontrado.
 *
 * Todo el estado vive en la URL (?q=&tema=&zona=&cursor=): se comparte por
 * link, sobrevive al botón atrás y el Server Component lo lee sin sincronizar
 * nada.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface Filtros {
  tema: HelpTopic | null;
  zona: string;
  busqueda: string;
  cursor: string;
}

function primerValor(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function parseFiltros(sp: Record<string, string | string[] | undefined>): Filtros {
  const tema = primerValor(sp.tema);
  return {
    // La MISMA guarda que decide si una fila de la base se muestra: un search
    // param es texto libre que cualquiera escribe a mano.
    tema: isHelpTopic(tema) ? tema : null,
    zona: primerValor(sp.zona).slice(0, 80),
    busqueda: primerValor(sp.q).slice(0, 60),
    cursor: primerValor(sp.cursor).slice(0, 200),
  };
}

const OPCIONES_TEMA: readonly FilterOption[] = [
  { value: "", label: C.filtros.todosLosTemas },
  ...HELP_TOPICS.map((topic) => ({ value: topic, label: HELP_TOPIC_LABEL[topic] })),
];

export default async function PedirAyudaPage({ searchParams }: { searchParams: SearchParams }) {
  const filtros = parseFiltros(await searchParams);

  return (
    <>
      <ComunidadHeading
        icon={<HandHeart size={30} weight="fill" aria-hidden="true" />}
        title={C.title}
        subtitle={C.subtitle}
      />

      <p className="mt-4 text-sm leading-relaxed text-foreground-secondary">{C.intro}</p>

      {/* La acción principal, arriba y sola. Antes acá había DOS botones del
          mismo peso ("Quiero ayudar" / "Necesito manos") y el cliente contó que
          esa bifurcación lo confundió: ahora hay una sola cosa que hacer. */}
      <Link
        href="/comunidad/pedir-ayuda/publicar"
        className={cn(buttonVariants({ variant: "primary", size: "md" }), "mt-4 w-full sm:w-auto")}
      >
        <Plus size={18} aria-hidden="true" />
        {C.publicarCta}
      </Link>

      <ReglasDeAyuda variante="lectura" className="mt-4" />

      <div className="mt-4">
        <Link
          href="/comunidad/pedir-ayuda/mios"
          className="inline-flex min-h-11 items-center text-sm font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          {C.misPedidosCta}
        </Link>
      </div>

      {/* Bandeja de filtros. El orden es el de QUITTR "Community"
          (https://mobbin.com/screens/ba6982fb-4f59-48e4-85a0-c7cd623502b6):
          buscar primero, filtrar después — quien tiene una palabra en la cabeza
          no pasa por las categorías. La zona va al final porque es el filtro
          que se usa una vez y queda puesto. */}
      <Bubble tone="tray" shape="tile" size="none" className="mb-5 mt-4 space-y-4 p-4">
        {/* Sin `resetParams`: la barra ya borra `cursor` sola, y los otros dos
            filtros (tema y zona) NO se tocan a propósito — se busca DENTRO de
            lo que ya está filtrado, como en el resto de la app. */}
        <ModuleSearchBar
          label={C.filtros.buscarLabel}
          placeholder={C.filtros.buscarPlaceholder}
        />
        <ModuleFilterChips param="tema" label={C.filtros.temaLabel} options={OPCIONES_TEMA} />
        <ZonaBuscador
          inputId="pedir-ayuda-zona"
          label={C.filtros.zonaLabel}
          placeholder={C.filtros.zonaPlaceholder}
          help={C.filtros.zonaHelp}
        />
      </Bubble>

      <Suspense key={JSON.stringify(filtros)} fallback={<PedidoListSkeleton />}>
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
    area: filtros.zona || null,
    search: filtros.busqueda || null,
    cursor: filtros.cursor || null,
  });

  const hayFiltro = Boolean(filtros.zona || filtros.tema || filtros.busqueda);

  /**
   * Mirando sin cuenta. NO es un error y no se pinta como tal: la 0120 le niega
   * SELECT a `anon` a propósito (un tablón público de nombre + barrio +
   * "necesito ayuda con esto" es un padrón), así que este camino es el diseño
   * funcionando.
   */
  if (needsSession) {
    return (
      <EmptyState
        illustration="/images/empty-state-search.png"
        title={COMUNIDAD_COPY.escribirPedido.sinSesion.title}
        message={COMUNIDAD_COPY.escribirPedido.sinSesion.message}
        action={
          <Link
            href="/entrar?next=/comunidad/pedir-ayuda"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COMUNIDAD_COPY.escribirPedido.sinSesion.cta}
          </Link>
        }
      />
    );
  }

  if (items.length === 0) {
    return (
      <>
        {/* "No pudimos leer" NO es lo mismo que "no hay": si la consulta falló,
            decirlo evita que alguien concluya que en su barrio nadie pide nada.
            Acá `failed` ya excluye el 42501 de mirar sin sesión, que se atiende
            arriba con su propia pantalla. */}
        {failed && (
          <p
            role="alert"
            className="mb-4 rounded-md bg-danger-bg px-3 py-2.5 text-sm leading-relaxed text-danger-ink"
          >
            {COMUNIDAD_COPY.escribirPedido.errors.leer}
          </p>
        )}
        <EmptyState
          illustration="/images/empty-state-search.png"
          title={hayFiltro ? C.vacio.filtradoTitle : C.vacio.title}
          message={hayFiltro ? C.vacio.filtradoMessage : C.vacio.message}
          action={
            hayFiltro ? (
              <Link
                href="/comunidad/pedir-ayuda"
                className={buttonVariants({ variant: "primary", size: "md" })}
              >
                {C.verTodos}
              </Link>
            ) : (
              <Link
                href="/comunidad/pedir-ayuda/publicar"
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
  if (filtros.busqueda) siguiente.set("q", filtros.busqueda);
  if (filtros.zona) siguiente.set("zona", filtros.zona);
  if (filtros.tema) siguiente.set("tema", filtros.tema);
  if (nextCursor) siguiente.set("cursor", nextCursor);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {items.map((pedido) => (
          <PedidoCard key={pedido.id} pedido={pedido} />
        ))}
      </div>

      {nextCursor && (
        <Link
          href={`/comunidad/pedir-ayuda?${siguiente.toString()}`}
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-full")}
        >
          Ver más pedidos
          <CaretDown size={16} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
