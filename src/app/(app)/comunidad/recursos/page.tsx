import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, Lifebuoy } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import {
  ComunidadHeading,
  OrigenNota,
  RecursoCard,
  RecursosSkeleton,
} from "@/components/comunidad";
import {
  COMUNIDAD_COPY,
  RESOURCE_TOPIC_HINT,
  RESOURCE_TOPIC_LABEL,
  isResourceTopic,
  type ResourceGroup,
  type ResourceTopic,
} from "@/lib/comunidad";
import { getTenant } from "@/lib/tenant/resolve";
import { fetchResourceGroups } from "../queries";

export const metadata = { title: "Dónde pedir ayuda" };

const C = COMUNIDAD_COPY.recursos;

/**
 * DIRECTORIO DE AYUDA — agrupado por tema, con la fuente de cada ficha.
 *
 * ── `?tema=` (0099, rediseño de la portada; sumó `acopio` la 0105) ──────────
 * Tres tarjetas de la grilla de `/comunidad` ("Bancos de comida", "Voluntarios",
 * "Centro de acopio") apuntan ACÁ con `?tema=comida` / `?tema=voluntariado` /
 * `?tema=acopio` en vez de llevar a una pantalla propia: es la misma lectura
 * (`fetchResourceGroups`), filtrada. Un
 * `tema` válido angosta el título, la bajada y la lista a UN grupo; sin `tema`
 * (o con uno que no exista) esta pantalla se comporta exactamente como antes.
 * `isResourceTopic` es la MISMA guarda que decide si una fila de la base se
 * muestra (`recursos.ts`) — un search param es texto libre que cualquiera
 * escribe a mano, así que se valida con la fuente de verdad, no con un chequeo
 * propio.
 *
 * ── EL ORDEN DE LOS GRUPOS NO ES ALFABÉTICO ─────────────────────────────────
 * Lo fija `RESOURCE_TOPICS` y arriba va lo urgente: emergencias, migración,
 * salud, comida. Quien abre esta pantalla a las once de la noche no viene a
 * explorar un catálogo.
 *
 * ── LA PANTALLA NO PUEDE MOSTRAR UNA FICHA SIN FUENTE ───────────────────────
 * No hace falta chequearlo acá: `fetchResourceGroups` ya descarta lo que no
 * tenga procedencia verificable, y `<RecursoCard>` la renderiza sin condición.
 * Son tres capas —el NOT NULL de la 0096, el filtro puro y la card— y las tres
 * existen a propósito: es la regla que si se rompe hace que la plataforma
 * parezca estar dando consejos de salud y de migración propios.
 */
export default async function RecursosPage({
  searchParams,
}: {
  searchParams: Promise<{ tema?: string | string[] }>;
}) {
  const { tema } = await searchParams;
  const temaCrudo = Array.isArray(tema) ? tema[0] : tema;
  const topic = isResourceTopic(temaCrudo) ? temaCrudo : null;

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
        icon={<Lifebuoy size={30} weight="fill" aria-hidden="true" />}
        title={topic ? RESOURCE_TOPIC_LABEL[topic] : C.title}
        subtitle={topic ? RESOURCE_TOPIC_HINT[topic] : C.subtitle}
      />

      {topic && (
        <Link
          href="/comunidad/recursos"
          className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          {C.allTopicsCta}
        </Link>
      )}

      <OrigenNota className="mt-5" incluirMigracion />

      <Suspense fallback={<div className="mt-8"><RecursosSkeleton /></div>}>
        <Grupos topic={topic} />
      </Suspense>
    </>
  );
}

async function Grupos({ topic }: { topic: ResourceTopic | null }) {
  const tenant = await getTenant();
  const grupos = await fetchResourceGroups(tenant.id);
  const visibles = topic ? grupos.filter((grupo) => grupo.topic === topic) : grupos;

  if (visibles.length === 0) {
    const vacioDeTema = topic && topicEmptyCopy(topic);
    if (vacioDeTema) {
      // Vacío de UN tema (hay directorio, no hay fichas de éste todavía):
      // nunca el mensaje genérico de abajo, que suena a "no hay nada" cuando
      // en realidad sobra ayuda en los demás temas.
      return (
        <EmptyState
          className="mt-8"
          icon={<Lifebuoy size={32} weight="light" aria-hidden="true" />}
          title={vacioDeTema.title}
          message={vacioDeTema.message}
          action={
            <Link href="/comunidad/recursos" className={buttonVariants({ variant: "primary", size: "md" })}>
              {C.allTopicsCta}
            </Link>
          }
        />
      );
    }

    return (
      <EmptyState
        className="mt-8"
        illustration="/images/empty-state-search.png"
        title={C.emptyTitle}
        message={C.emptyMessage}
        action={
          <Link
            href="/comunidad/guias"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {C.emptyAction}
          </Link>
        }
      />
    );
  }

  return (
    <div className="mt-8 space-y-10">
      {visibles.map((grupo) => (
        <GrupoDeRecursos key={grupo.topic} grupo={grupo} />
      ))}
    </div>
  );
}

function GrupoDeRecursos({ grupo }: { grupo: ResourceGroup }) {
  return (
    <section aria-labelledby={`tema-${grupo.topic}`}>
      <header className="mb-3">
        <h2
          id={`tema-${grupo.topic}`}
          className="font-display text-lg font-bold tracking-tight text-foreground"
        >
          {RESOURCE_TOPIC_LABEL[grupo.topic]}
        </h2>
        <p className="mt-0.5 text-sm text-foreground-muted">
          {RESOURCE_TOPIC_HINT[grupo.topic]}
        </p>
      </header>

      {/* Una ficha por fila en el celular: tienen mucha información y tres
          botones de contacto que no pueden achicarse. Dos columnas desde
          `sm`, donde el shell ya deja ancho suficiente. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {grupo.resources.map((recurso) => (
          <RecursoCard key={recurso.id} recurso={recurso} />
        ))}
      </div>
    </section>
  );
}

/**
 * Copy del vacío ESPECÍFICO de un tema — sólo existe para los temas que
 * tienen entrada propia en la grilla de la portada (comida, voluntariado,
 * acopio — 0105). El resto de los temas se navegan desde la lista completa,
 * que ya resuelve su propio vacío con `C.emptyTitle`/`C.emptyMessage`; si
 * algún día alguno de ellos suma su propia tarjeta, agrega su caso acá.
 */
function topicEmptyCopy(topic: ResourceTopic): { title: string; message: string } | null {
  if (topic === "comida") return C.emptyTopic.comida;
  if (topic === "voluntariado") return C.emptyTopic.voluntariado;
  if (topic === "acopio") return C.emptyTopic.acopio;
  return null;
}
