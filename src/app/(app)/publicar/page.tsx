import Link from "next/link";
import { SignIn, Storefront } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { COPY } from "@/components/listings";
import { moduleAvailability } from "@/components/shell/module-access";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { PublishForm, type Kind } from "./publish-form";

export const metadata = { title: "Publicar" };

// Next 16: searchParams llega como Promise (mismo contrato que src/app/(app)/feed/page.tsx).
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Duplicado deliberado de publish-form.tsx (mismo patrón que ya usan
// src/app/(app)/publicar/actions.ts y src/app/admin/dominio/page.tsx): es un
// literal de 5 strings, no vale la pena cruzar el límite "use client" por él.
const VALID_KINDS = ["property", "business", "professional", "event", "job"] as const;

/**
 * Qué vertical vive en qué módulo de `tenants.modules`.
 *
 * El menú "+" (create-menu.tsx) ya filtra sus tiles con estas mismas claves;
 * acá se repiten porque el DESTINO tiene que aplicar la misma regla que la
 * puerta. Con Eventos apagado, el tile no aparece — pero `/publicar?kind=event`
 * seguía funcionando desde un link viejo, desde el historial del navegador o
 * escrito a mano, y el aviso nacía en un módulo que no lo muestra en ninguna
 * parte. Esconder la puerta no es cerrar la habitación.
 */
const KIND_MODULE_KEY: Record<Kind, string> = {
  property: "propiedades",
  business: "negocios",
  professional: "profesionales",
  event: "eventos",
  job: "empleos",
};

/** ?kind= del menú crear-post (feed) → Kind válido, o null si falta/no matchea. */
function parseInitialKind(raw: string | string[] | undefined): Kind | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && (VALID_KINDS as readonly string[]).includes(value) ? (value as Kind) : null;
}

export default async function PublicarPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [tenant, supabase, sp] = await Promise.all([getTenant(), createClient(), searchParams]);

  // Los verticales que ESTA comunidad tiene abiertos. "soon" y "hidden" quedan
  // los dos afuera: un módulo anunciado como "muy pronto" todavía no recibe
  // avisos, y publicar en uno sería llenarlo antes de abrirlo.
  const allowedKinds = VALID_KINDS.filter(
    (kind) =>
      moduleAvailability(KIND_MODULE_KEY[kind], tenant.modules, tenant.modulesSoon) ===
      "active",
  );

  // Un ?kind= de un módulo apagado NO preselecciona nada: la persona cae en el
  // paso 0 con las opciones que sí existen, en vez de en un formulario para un
  // vertical que su comunidad no tiene.
  const requestedKind = parseInitialKind(sp.kind);
  const initialKind =
    requestedKind && allowedKinds.includes(requestedKind) ? requestedKind : null;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Conserva el ?kind= a través del login (si no, el preselect se pierde
    // apenas el usuario anónimo tiene que entrar primero).
    const next = initialKind ? `/publicar?kind=${initialKind}` : "/publicar";
    return (
      <EmptyState
        icon={<SignIn />}
        title={COPY.publish.needLoginTitle}
        message={COPY.publish.needLoginMessage}
        action={
          <Link
            href={`/entrar?next=${encodeURIComponent(next)}`}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COPY.publish.needLoginCta}
          </Link>
        }
        className="py-20"
      />
    );
  }

  // Ningún vertical abierto: no hay nada que ofrecer y el wizard no puede
  // inventarlo. Antes esto era imposible de ver porque el selector ignoraba los
  // módulos; ahora que los respeta, el caso existe y tiene que decir algo.
  if (allowedKinds.length === 0) {
    return (
      <EmptyState
        icon={<Storefront />}
        title={COPY.publish.noVerticalsTitle}
        message={COPY.publish.noVerticalsMessage}
        action={
          <Link
            href="/feed"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COPY.publish.noVerticalsCta}
          </Link>
        }
        className="py-20"
      />
    );
  }

  /**
   * Fichas de negocio PROPIAS y PUBLICADAS — el desplegable «Organiza» del
   * evento (0117). Las dos condiciones son las mismas que exige
   * `app.check_business_listing_link()`: ofrecer en la lista algo que el trigger
   * va a rechazar sería armar una trampa. Un borrador todavía no es una ficha
   * que alguien pueda visitar.
   *
   * Sólo se pide si Eventos está abierto en esta comunidad: con el módulo
   * apagado no hay evento que organizar y la consulta sería trabajo tirado.
   */
  const businessRows = allowedKinds.includes("event")
    ? (
        await supabase
          .from("listings")
          .select("id, title")
          .eq("tenant_id", tenant.id)
          .eq("created_by", user.id)
          .eq("kind", "business")
          .eq("status", "published")
          .order("title")
          .limit(20)
      ).data
    : null;

  return (
    <>
      <h1 className={cn("mb-6 font-display text-2xl font-bold tracking-tight text-foreground")}>
        {COPY.publish.title}
      </h1>
      <PublishForm
        businesses={businessRows ?? []}
        tenantId={tenant.id}
        initialKind={initialKind}
        allowedKinds={allowedKinds}
      />
    </>
  );
}
