import Link from "next/link";
import {
  ArrowSquareOut,
  Gear,
  ImageSquare,
  Info,
  Storefront,
} from "@phosphor-icons/react/dist/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { BezelCard, buttonVariants } from "@/components/ui";
import { PerfilCambiarIdentidad } from "@/components/shell/identity-switcher";
import { PERFIL_ACTIVO_COPY } from "@/lib/perfil-activo/copy";
import type { IdentidadNegocio } from "@/lib/perfil-activo/identidad";
import { businessCategoryLabel } from "@/app/(app)/negocios/categories";
import { cn } from "@/lib/utils";
import { ProfileHeader } from "./profile-header";

/**
 * =============================================================================
 * "TU PERFIL" MIENTRAS ACTUÁS COMO TU NEGOCIO
 * =============================================================================
 *
 * El reclamo que trajo esta pantalla: «cambio a la cuenta de dueño y lo que se
 * ve en mi foto de perfil y mi nombre tendrían que ser los del dueño».
 *
 * Tenía razón y era el peor de los síntomas: /perfil es literalmente la pantalla
 * que contesta "quién sos acá". Mientras se actuaba como negocio seguía diciendo
 * el nombre y la foto de la persona, o sea que la app afirmaba una cosa arriba
 * (el avatar del header, con la insignia del local) y la contraria en el medio.
 * Ante dos respuestas distintas, la que gana es la más grande.
 *
 * ── POR QUÉ NO ES UN CLON DEL PERFIL PERSONAL ───────────────────────────────
 * Porque un negocio no tiene las mismas cosas que una persona y fingir que sí
 * sería inventar datos: no tiene Trust Score (lo tiene su DUEÑO, y ya se ve en
 * la página pública del negocio), no tiene país de origen ni idiomas, y su
 * "completá tu perfil" es otra lista. Lo que sí tiene —y es lo que se muestra—
 * es nombre, foto, rubro, publicaciones, seguidores y una página pública.
 *
 * ── LO PERSONAL NO DESAPARECE, SE VUELVE UN TOQUE ───────────────────────────
 * Volver a ser vos es un CAMBIO DE ESTADO, no una navegación: por eso vive en
 * el mismo cambiador de siempre (`PerfilCambiarIdentidad`) y no en un link que
 * te lleve a otra pantalla dejándote igual de "en modo negocio" que antes. Un
 * link a "/perfil personal" que no cambie la identidad sería la trampa perfecta:
 * verías tu cara y seguirías publicando como el local.
 *
 * ── LA FICHA ES LA CARA, Y SE PUEDE COMPLETAR ───────────────────────────────
 * Desde la 0116 toda cuenta de negocio nace con su ficha del directorio, que es
 * de dónde salen el nombre y la foto. Nace SIN foto (a propósito: ninguna imagen
 * sin moderar entra al directorio por la puerta del alta), así que esta pantalla
 * tiene que decir cómo ponerle una — si no, el negocio se queda para siempre con
 * la inicial en un círculo y nadie sabe por qué.
 */

const COPY = {
  statPosts: "Publicaciones",
  statFollowers: "Seguidores",
  viewPublic: "Ver la página",
  avisoTitle: (nombre: string) => `Estás usando la app como ${nombre}`,
  avisoBody:
    "Lo que publiques y comentes va a salir con este nombre. Tu perfil personal queda intacto: cambiá cuando quieras desde el botón de arriba.",
  fotoTitle: "Ponele una foto a tu negocio",
  fotoBody:
    "Es lo primero que ve la gente en el directorio y en cada cosa que publiques. Se sube desde la página del negocio.",
  fotoCta: "Subir la foto",
  manageTitle: "Administrar tu cuenta de negocio",
  manageDesc: "Cambiar de perfil, ver tu rol y la presencia verificada.",
  settingsTitle: "Ajustes de tu cuenta",
  settingsDesc: "Guardados, notificaciones, personas bloqueadas, tema y cerrar sesión.",
  sinFicha:
    "Este negocio todavía no tiene su página pública. Creala para poder publicar con su nombre.",
  sinFichaCta: "Crear la página del negocio",
} as const;

export interface PerfilDeNegocioProps {
  negocio: IdentidadNegocio;
  /** Todas las identidades disponibles, para el cambiador (nunca un segundo). */
  negocios: IdentidadNegocio[];
  /** Nombre y foto de la persona, para la opción "vos" del cambiador. */
  personal: { displayName: string; avatarUrl: string | null };
  postsCount: number;
  followersCount: number;
  /** Ya tiene al menos una foto en su ficha. */
  tieneFoto: boolean;
}

export function PerfilDeNegocio({
  negocio,
  negocios,
  personal,
  postsCount,
  followersCount,
  tieneFoto,
}: PerfilDeNegocioProps) {
  const rubro = businessCategoryLabel(negocio.categoria);
  const subtitulo = [rubro, PERFIL_ACTIVO_COPY.roles[negocio.rol]]
    .filter(Boolean)
    .join(" · ");
  const paginaHref = negocio.listingId ? `/negocios/${negocio.listingId}` : null;

  return (
    <div className="flex flex-col gap-8">
      <ProfileHeader
        displayName={negocio.nombre}
        avatarUrl={negocio.avatarUrl}
        // Un negocio no verifica identidad como una persona: su sello es
        // `store_verified` y vive en su página pública, donde significa algo.
        identityVerified={false}
        location={subtitulo || null}
        stats={[
          { label: COPY.statPosts, value: postsCount },
          { label: COPY.statFollowers, value: followersCount },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {paginaHref && (
              <Link
                href={paginaHref}
                className={cn(
                  buttonVariants({ variant: "secondary", size: "md" }),
                  "flex-1",
                )}
              >
                <ArrowSquareOut size={16} aria-hidden="true" />
                {COPY.viewPublic}
              </Link>
            )}
            <PerfilCambiarIdentidad
              personal={personal}
              negocios={negocios.map((item) => ({
                businessId: item.businessId,
                nombre: item.nombre,
                avatarUrl: item.avatarUrl,
                rol: item.rol,
              }))}
              activeBusinessId={negocio.businessId}
            />
          </div>
        }
      />

      {/* El estado, con todas las letras — mismo criterio que /negocios/cuenta:
          que alguien no sepa con qué nombre está publicando es peor que no
          tener la función. */}
      <BezelCard coreClassName="flex items-start gap-3 p-4">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
        >
          <Storefront size={20} weight="fill" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-base font-semibold text-foreground">
            {COPY.avisoTitle(negocio.nombre)}
          </span>
          <span className="mt-0.5 block text-sm text-foreground-secondary">
            {COPY.avisoBody}
          </span>
        </span>
      </BezelCard>

      {/* Sin ficha no hay con qué firmar: la 0116 la crea sola en el alta, así
          que llegar acá significa que algo salió mal (o que la ficha se
          despublicó). Se dice, y se ofrece la salida. */}
      {!paginaHref && (
        <BezelCard coreClassName="flex flex-col items-start gap-3 p-4">
          <p className="flex items-start gap-2 text-sm text-foreground">
            <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
            {COPY.sinFicha}
          </p>
          <Link
            href="/publicar?kind=business"
            className={buttonVariants({ variant: "primary", size: "sm" })}
          >
            {COPY.sinFichaCta}
          </Link>
        </BezelCard>
      )}

      {paginaHref && !tieneFoto && (
        <BezelCard coreClassName="flex items-start gap-3 p-4">
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-secondary"
          >
            <ImageSquare size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">
              {COPY.fotoTitle}
            </span>
            <span className="mt-0.5 block text-sm text-foreground-secondary">
              {COPY.fotoBody}
            </span>
            <Link
              href={paginaHref}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}
            >
              {COPY.fotoCta}
            </Link>
          </span>
        </BezelCard>
      )}

      <section className="flex flex-col gap-2">
        <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface">
          <Fila
            href="/negocios/cuenta"
            icon={<Storefront size={20} />}
            title={COPY.manageTitle}
            description={COPY.manageDesc}
          />
          <Fila
            href="/ajustes"
            icon={<Gear size={20} />}
            title={COPY.settingsTitle}
            description={COPY.settingsDesc}
          />
        </div>
      </section>
    </div>
  );
}

/** Misma fila que usan Ajustes y /negocios/cuenta: ícono, dos líneas, chevron. */
function Fila({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-14 items-center gap-3 px-3 py-2",
        "transition-colors duration-(--duration-fast) hover:bg-surface-hover",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-foreground-secondary"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="block text-xs text-foreground-secondary">{description}</span>
      </span>
    </Link>
  );
}

/**
 * Los dos contadores del negocio y si su ficha ya tiene foto, en una consulta
 * cada uno y ninguna bloqueante: esta pantalla no puede caerse porque el conteo
 * de seguidores falle. Vive acá y no en la página para que el componente y su
 * lectura se lean juntos.
 */
export async function fetchNegocioPerfilData(
  supabase: SupabaseClient<Database>,
  { tenantId, listingId }: { tenantId: string; listingId: string | null },
): Promise<{ postsCount: number; followersCount: number; tieneFoto: boolean }> {
  if (!listingId) return { postsCount: 0, followersCount: 0, tieneFoto: false };

  try {
    const [posts, followers, ficha] = await Promise.all([
      supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("entity_listing_id", listingId)
        .eq("status", "published"),
      supabase
        .from("follows")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("target_kind", "listing")
        .eq("target_id", listingId),
      supabase.from("listings").select("photos").eq("id", listingId).maybeSingle(),
    ]);

    const photos = (ficha.data as { photos?: string[] } | null)?.photos ?? [];
    return {
      postsCount: posts.count ?? 0,
      followersCount: followers.count ?? 0,
      tieneFoto: photos.some((path) => path && path.trim().length > 0),
    };
  } catch {
    return { postsCount: 0, followersCount: 0, tieneFoto: false };
  }
}
