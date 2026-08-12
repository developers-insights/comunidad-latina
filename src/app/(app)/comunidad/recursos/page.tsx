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
} from "@/lib/comunidad";
import { getTenant } from "@/lib/tenant/resolve";
import { fetchResourceGroups } from "../queries";

export const metadata = { title: "Dónde pedir ayuda" };

const C = COMUNIDAD_COPY.recursos;

/**
 * DIRECTORIO DE AYUDA — agrupado por tema, con la fuente de cada ficha.
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
export default function RecursosPage() {
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
        title={C.title}
        subtitle={C.subtitle}
      />

      <OrigenNota className="mt-5" incluirMigracion />

      <Suspense fallback={<div className="mt-8"><RecursosSkeleton /></div>}>
        <Grupos />
      </Suspense>
    </>
  );
}

async function Grupos() {
  const tenant = await getTenant();
  const grupos = await fetchResourceGroups(tenant.id);

  if (grupos.length === 0) {
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
      {grupos.map((grupo) => (
        <section key={grupo.topic} aria-labelledby={`tema-${grupo.topic}`}>
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
      ))}
    </div>
  );
}
