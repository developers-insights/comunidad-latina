import Link from "next/link";
import { SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { ReglasDeAyuda } from "@/components/comunidad";
import { COMUNIDAD_COPY, isHelpTopic, type HelpTopic } from "@/lib/comunidad";
import { createClient } from "@/lib/supabase/server";
import { PedidoForm } from "./pedido-form";

export const metadata = { title: "Escribir un pedido" };

const C = COMUNIDAD_COPY.escribirPedido;

const RUTA = "/comunidad/pedir-ayuda/publicar";

/** El tema por defecto: el que más se pide, según lo que contó el cliente. */
const TEMA_POR_DEFECTO: HelpTopic = "tramites";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function primerValor(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * =============================================================================
 * ALTA DE UN PEDIDO
 * =============================================================================
 *
 * Server Component: resuelve sesión y el tema con el que se llega. El
 * formulario es cliente y no toca la base: sólo llama a la server action.
 *
 * ── EL ÚNICO PARÁMETRO QUE ACEPTA ───────────────────────────────────────────
 *   ?tema=…  · desde qué tema se llegó (el chip del tablón, o el puente que
 *              está en la cabecera de cada tema del directorio de recursos).
 *
 * Se valida con la MISMA guarda que usa el resto del módulo — es texto libre de
 * la URL, no un contrato.
 *
 * ── SIN SESIÓN NO SE RENDERIZA EL FORMULARIO ────────────────────────────────
 * La RLS lo rechazaría igual, y es mejor decirlo antes de que alguien escriba
 * todo que después de que toque "publicar".
 */
export default async function EscribirPedidoPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [supabase, sp] = await Promise.all([createClient(), searchParams]);
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

  const temaCrudo = primerValor(sp.tema);
  const temaInicial: HelpTopic = isHelpTopic(temaCrudo) ? temaCrudo : TEMA_POR_DEFECTO;

  return (
    <>
      <header className="mb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {C.title}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{C.subtitle}</p>
      </header>

      {/* Las tres reglas ANTES del formulario y no después: la que dice "no
          dejes tus datos" tiene que leerse antes de que alguien escriba su
          teléfono, no cuando el servidor se lo rebota. */}
      <ReglasDeAyuda className="mb-5" />

      <PedidoForm temaInicial={temaInicial} />
    </>
  );
}
