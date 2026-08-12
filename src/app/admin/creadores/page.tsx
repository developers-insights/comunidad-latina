import Link from "next/link";
import { Info, UserCheck } from "@phosphor-icons/react/dist/ssr";
import { EligibilityConfigForm } from "@/components/creators/eligibility-config-form";
import { configFromRow } from "@/lib/creators/eligibility";
import { getTenant } from "@/lib/tenant/resolve";
import { requireStaff } from "../guard";
import { fetchEligibilitySnapshots } from "./snapshots";

export const metadata = { title: "Requisitos de creador" };

/**
 * =============================================================================
 * PANEL: REQUISITOS PARA SER CREADOR (domain_admin+)
 * =============================================================================
 *
 * El pliego exige que los umbrales sean "configurables desde el panel, no
 * colocados permanentemente en el código". La migración 0064 los sacó del
 * código; esta pantalla es el panel.
 *
 * GATE: `requireStaff("domain_admin")` corre ANTES de renderizar nada y valida
 * el token contra Supabase Auth, no contra la cookie. Un moderator o un miembro
 * no ve esta página; y aunque la viera, la server action y la RLS de 0064 lo
 * frenan igual (permisos en el backend, no escondiendo botones).
 *
 * TENANT: el de verdad es el del JWT. El Host header acá es cosmético — mismo
 * criterio que /admin/dominio.
 * =============================================================================
 */

const COPY = {
  title: "Requisitos para ser creador",
  intro:
    "Estos son los cortes que decide tu comunidad para dejar que alguien reciba trabajos pagos. Los podés cambiar cuando quieras: rigen desde el momento en que guardás, para toda solicitud nueva.",
  scopeNote:
    "Los requisitos valen solo para tu comunidad. Otras comunidades de la plataforma tienen los suyos y no se tocan desde acá.",
  loadError:
    "No pudimos leer los requisitos guardados, así que abajo ves los que trae el sistema por defecto. Recargá la página antes de guardar: si guardás ahora, podrías pisar valores que tu comunidad ya había configurado.",
  queueLink: "Ver solicitudes pendientes",
  queueHint: "Acá definís los requisitos; las solicitudes que ya llegaron se aprueban del otro lado.",
} as const;

export default async function AdminCreadoresPage() {
  const { supabase, tenantId: jwtTenantId } = await requireStaff("domain_admin");
  const tenant = await getTenant();
  const tenantId = jwtTenantId ?? tenant.id;

  const { data: row, error } = await supabase
    .from("creator_eligibility_config")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  /**
   * OJO con el fallback (misma trampa que los módulos en /admin/dominio): "no
   * hay fila" y "la lectura falló" se ven igual desde acá y significan cosas
   * opuestas. Sin fila, los defaults SON lo vigente y mostrarlos es correcto.
   * Con error de lectura, mostrar defaults y dejar guardar pisaría la
   * configuración real del tenant — así que el error se avisa en pantalla.
   */
  const saved = configFromRow(row);

  const editorId = row?.updated_by ?? null;
  const [{ data: editor }, snapshots] = await Promise.all([
    editorId
      ? supabase.from("profiles").select("display_name").eq("id", editorId).maybeSingle()
      : Promise.resolve({ data: null as { display_name: string } | null }),
    fetchEligibilitySnapshots(supabase, tenantId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-display text-2xl font-bold text-foreground">{COPY.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">{COPY.intro}</p>
        <p className="mt-2 flex items-start gap-1.5 text-sm text-foreground-muted">
          <Info size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-info" />
          {COPY.scopeNote}
        </p>
        {/* Las dos mitades del mismo trabajo: acá se fijan los requisitos, allá
            se resuelven las solicitudes que ya entraron. Sin este link la cola
            existe pero no la encuentra nadie: el nav sólo llega hasta acá. */}
        <Link
          href="/admin/creadores/solicitudes"
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors duration-(--duration-fast) hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          <UserCheck size={16} aria-hidden="true" />
          {COPY.queueLink}
        </Link>
        <p className="mt-0.5 text-xs text-foreground-muted">{COPY.queueHint}</p>
      </header>

      {error && (
        <p role="alert" className="rounded-md bg-warning-bg px-3 py-2.5 text-sm leading-relaxed text-warning-ink">
          {COPY.loadError}
        </p>
      )}

      <EligibilityConfigForm
        saved={saved}
        subjects={snapshots.subjects}
        blindSpots={snapshots.blindSpots}
        editorName={editor?.display_name ?? null}
        updatedAt={row?.updated_at ?? null}
        locale={tenant.locale}
      />
    </div>
  );
}
