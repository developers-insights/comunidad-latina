import Link from "next/link";
import { ArrowLeft, SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { ReglasDeAyuda } from "@/components/comunidad";
import {
  COMUNIDAD_COPY,
  HELP_TOPICS,
  isHelpDirection,
  isHelpTopic,
  type HelpDirection,
  type HelpTopic,
} from "@/lib/comunidad";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { fetchHelpResourceOptions, fetchMyHelpDraft } from "../../queries";
import { AyudaPublishForm, type BorradorInicial } from "./publish-form";

export const metadata = { title: "Publicar un aviso de ayuda" };

const C = COMUNIDAD_COPY.ofrecerse;

const RUTA = "/comunidad/ayuda-mutua/publicar";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function primerValor(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * =============================================================================
 * ALTA DE UN AVISO DE AYUDA MUTUA
 * =============================================================================
 *
 * Server Component: resuelve sesión, tenant, los lugares del directorio que se
 * pueden elegir y —si viene `?editar=`— el borrador que se está corrigiendo.
 * El wizard es cliente y no toca la base: sólo llama a la server action.
 *
 * ── LOS TRES PARÁMETROS QUE ACEPTA, Y DE DÓNDE VIENEN ───────────────────────
 *   ?modo=offer|need  · qué botón se tocó ("Quiero ayudar" / "Necesito manos")
 *   ?tema=…           · desde qué tema se llegó
 *   ?lugar=<uuid>     · desde qué ficha del directorio se llegó
 *
 * Son la parte del pedido del cliente que hace que el botón sirva: quien toca
 * "Quiero ayudar acá" en la ficha de un comedor NO tiene que volver a elegir
 * "ofrecer", ni el tema, ni el comedor. Llega con los tres puestos y arranca
 * escribiendo. Los tres se validan con las MISMAS guardas que usa el resto del
 * módulo — son texto libre de la URL, no un contrato.
 *
 * ── SIN SESIÓN NO SE RENDERIZA EL FORMULARIO ────────────────────────────────
 * La RLS lo rechazaría igual, y es mejor decirlo antes de que alguien escriba
 * todo que después de que toque "enviar".
 */
export default async function PublicarAyudaPage({ searchParams }: { searchParams: SearchParams }) {
  const [tenant, supabase, sp] = await Promise.all([getTenant(), createClient(), searchParams]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <EmptyState
        icon={<SignIn />}
        title={C.needLogin}
        message={C.needLoginHint}
        action={
          <Link
            href={`/entrar?next=${encodeURIComponent(RUTA)}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {C.needLogin}
          </Link>
        }
        className="py-20"
      />
    );
  }

  const modoCrudo = primerValor(sp.modo);
  const temaCrudo = primerValor(sp.tema);
  const lugarCrudo = primerValor(sp.lugar);
  const editarCrudo = primerValor(sp.editar);

  const [lugares, borradorRow] = await Promise.all([
    fetchHelpResourceOptions(tenant.id, HELP_TOPICS),
    UUID_RE.test(editarCrudo)
      ? fetchMyHelpDraft({ avisoId: editarCrudo, tenantId: tenant.id, viewerId: user.id })
      : Promise.resolve(null),
  ]);

  /**
   * El borrador manda sobre los parámetros de la URL: si alguien está
   * corrigiendo un aviso, lo que tiene que ver es lo que escribió, no lo que
   * diga el link por el que llegó.
   */
  const inicial: BorradorInicial | null = borradorRow
    ? {
        avisoId: borradorRow.id,
        direction: isHelpDirection(borradorRow.direction) ? borradorRow.direction : "offer",
        topic: isHelpTopic(borradorRow.topic) ? borradorRow.topic : "voluntariado",
        resourceId: borradorRow.resource_id,
        title: borradorRow.title,
        body: borradorRow.body,
        areaLabel: borradorRow.area_label,
        availability: borradorRow.availability ?? "",
        orgName: borradorRow.org_name ?? "",
        languages: borradorRow.languages ?? [],
      }
    : null;

  const modoInicial: HelpDirection = inicial
    ? inicial.direction
    : isHelpDirection(modoCrudo)
      ? modoCrudo
      : "offer";
  const temaInicial: HelpTopic = inicial
    ? inicial.topic
    : isHelpTopic(temaCrudo)
      ? temaCrudo
      : "voluntariado";
  // El lugar de la URL sólo vale si de verdad existe en ese tema: un uuid a
  // mano no puede convertirse en una opción del selector.
  const lugarInicial =
    inicial?.resourceId ??
    (lugares.some((lugar) => lugar.id === lugarCrudo && lugar.topic === temaInicial)
      ? lugarCrudo
      : null);

  return (
    <>
      <Link
        href="/comunidad/ayuda-mutua"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {COMUNIDAD_COPY.ayudaMutua.title}
      </Link>

      <header className="mb-4 mt-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {C.title}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{C.subtitle}</p>
      </header>

      <ReglasDeAyuda className="mb-5" />

      <AyudaPublishForm
        lugares={lugares}
        modoInicial={modoInicial}
        temaInicial={temaInicial}
        lugarInicial={lugarInicial}
        borrador={inicial}
      />
    </>
  );
}
