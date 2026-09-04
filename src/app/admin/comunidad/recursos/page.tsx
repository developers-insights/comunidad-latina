import { BookBookmark, Info } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { getTenant } from "@/lib/tenant/resolve";
import { requireStaff } from "../../guard";
import { fetchRecursosDelPanel } from "./queries";
import { NuevoRecurso } from "./nuevo-recurso";
import { RecursoFila } from "./recurso-fila";

export const metadata = { title: "Directorio de ayuda" };

/**
 * =============================================================================
 * EL DIRECTORIO DE AYUDA, CARGADO A MANO (domain_admin+)
 * =============================================================================
 *
 * `community_resources` existe desde la 0096 y hasta hoy no tenía pantalla: la
 * única forma de cargar una ficha era por SQL. Por eso el directorio está vacío
 * en producción y las tarjetas «Bancos de comida», «Voluntarios» y «Centro de
 * acopio» llevan a una lista sin nada.
 *
 * Esta pantalla es la que faltaba, y el trabajo concreto que la pide lo dijo el
 * cliente: «ahí va el listado de todos los bancos de comida del área de Nueva
 * York; esa información la sacamos de la alcaldía» (2026-09-03, 45:20). Son
 * decenas de fichas cargadas una por una, así que la lista y el formulario viven
 * en la MISMA pantalla: cargar treinta cosas yendo y volviendo a un detalle es
 * treinta veces el mismo viaje.
 *
 * ── LA OTRA PUERTA DEL MISMO DIRECTORIO ─────────────────────────────────────
 * Un lugar aprobado en /admin/comunidad/registros también crea una ficha acá. La
 * diferencia es quién escribió los datos: allá los escribió el propio lugar y el
 * equipo confirma la fuente; acá los escribe el equipo desde la fuente. Las dos
 * terminan en la misma tabla y con la misma regla — sin procedencia no hay ficha.
 *
 * ── INPUT PENDIENTE ─────────────────────────────────────────────────────────
 * De dónde sale el listado de bancos de comida de la ciudad (NYC Open Data, el
 * listado de la alcaldía) lo define el cliente. Esta pantalla no lo necesita
 * para funcionar: carga lo que le den, con su fuente.
 * =============================================================================
 */

const COPY = {
  title: "Directorio de ayuda",
  intro:
    "Las fichas que ve tu comunidad en Bancos de comida, Centro de acopio, Voluntarios y el resto de los temas. Cada una muestra siempre quién publica el dato y cuándo lo revisaste.",
  queueError:
    "No pudimos leer el directorio en este momento. No es que esté vacío: es que la consulta falló. Recargá la página.",
  globalesTitle: "Qué no aparece en esta lista",
  globales:
    "Las fichas compartidas entre todas las comunidades (consulados, líneas nacionales) las administra Comunidad Latina de forma central: se ven en el directorio público pero no se editan desde acá.",
  empty: {
    title: "El directorio de tu comunidad está vacío",
    message:
      "Todo lo que agregues acá aparece en Comunidad, en la tarjeta del tema que elijas. Empezá por los lugares que la gente pregunta más: bancos de comida y centros de acopio.",
  },
} as const;

export default async function RecursosAdminPage() {
  const { supabase, tenantId: jwtTenantId } = await requireStaff("domain_admin");
  const tenant = await getTenant();
  const tenantId = jwtTenantId ?? tenant.id;

  const { items, failed } = await fetchRecursosDelPanel(supabase, tenantId);

  return (
    <section aria-labelledby="recursos-title" className="flex flex-col gap-4">
      <header>
        <h2
          id="recursos-title"
          className="flex items-center gap-2 font-display text-2xl font-bold text-foreground"
        >
          <BookBookmark size={24} weight="fill" aria-hidden="true" className="text-brand-ink" />
          {COPY.title}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">{COPY.intro}</p>
      </header>

      <NuevoRecurso />

      {failed && (
        <p
          role="alert"
          className="rounded-md bg-danger-bg px-3 py-2.5 text-sm leading-relaxed text-danger-ink"
        >
          {COPY.queueError}
        </p>
      )}

      {items.length === 0 && !failed ? (
        <EmptyState
          icon={<BookBookmark />}
          title={COPY.empty.title}
          message={COPY.empty.message}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((recurso) => (
            <RecursoFila
              key={recurso.id}
              topicValido={recurso.topicValido !== null}
              recurso={{
                id: recurso.id,
                topic: recurso.topic,
                name: recurso.name,
                description: recurso.description,
                phone: recurso.phone,
                website: recurso.website,
                address: recurso.address,
                area_label: recurso.area_label,
                hours_note: recurso.hours_note,
                cost_note: recurso.cost_note,
                requirements_note: recurso.requirements_note,
                source_name: recurso.source_name,
                source_url: recurso.source_url,
                source_checked_at: recurso.source_checked_at,
                status: recurso.status,
              }}
            />
          ))}
        </div>
      )}

      <section className="rounded-lg border border-border-subtle px-3 py-2.5">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          <Info size={14} weight="fill" aria-hidden="true" className="text-info" />
          {COPY.globalesTitle}
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-foreground-secondary">{COPY.globales}</p>
      </section>
    </section>
  );
}
