import Image from "next/image";
import Link from "next/link";
import { ChatCircle } from "@phosphor-icons/react/dist/ssr";
import type { Tenant } from "@/lib/tenant/resolve";
import { BRAND_NAME } from "@/lib/brand";
import { Avatar } from "@/components/ui";
import { HeaderActions } from "@/components/shell/header-actions";
import { IdentitySwitcher } from "@/components/shell/identity-switcher";
import { NotificationBell } from "@/components/notifications";
import { getShellContext } from "@/components/shell/shell-context";
import { getZonaActiva } from "@/lib/zona/server";
import {
  getIdentidadActiva,
  listarIdentidadesDeNegocio,
} from "@/lib/perfil-activo/identidad";
import { t } from "@/lib/i18n";

const COPY = {
  profile: "Tu perfil",
  signIn: "Entrar",
} as const;

const SUPABASE_ORIGIN = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");

/** ¿El src puede pasar por next/image? (local o del Storage de Supabase). */
function isOptimizableSrc(src: string): boolean {
  return (
    src.startsWith("/") ||
    (SUPABASE_ORIGIN.length > 0 && src.startsWith(`${SUPABASE_ORIGIN}/`))
  );
}

/**
 * Header del shell autenticado: zona de logo del tenant (única zona de marca
 * masiva permitida), el selector de "Tu zona", Mensajes y el avatar de perfil.
 *
 * El selector de zona dejó de ser un placeholder el 2026-08-25: elige de verdad
 * qué zona ver y los seis módulos de directorio la respetan. Ver
 * `header-actions.tsx` y `@/lib/zona`.
 *
 * Historia de esta esquina derecha, porque cambió dos veces:
 *  · 2026-07-20 — el rail de módulos, el toggle de tema y la campana se fueron
 *    adentro de UN botón de menú, para que el header respirara.
 *  · 2026-07-29 — ese menú se eliminó (pedido de Manuel): su contenido se
 *    repartió entre /buscar (los módulos) y /ajustes (cuenta, notificaciones,
 *    tema, sesión), y su lugar lo tomó el avatar. Mensajes subió acá al mismo
 *    tiempo, porque salió del bottom nav.
 *
 * Superficie elevada: `bg-surface/85` (no canvas) + firma tricolor abajo,
 * que voltean solas con el tema.
 *
 * El `sticky top-0 z-40` vive en el wrapper de `(app)/layout.tsx`, NO acá.
 */
export async function Header({ tenant, className }: { tenant: Tenant; className?: string }) {
  // `cache()`-eada por request y compartida con <HeaderActions>: no agrega
  // consulta, sólo decide quién se queda con el ancho a 375px.
  const zonaActiva = await getZonaActiva();
  const hayZona = zonaActiva.label !== null;
  // La identidad activa se resuelve en el SERVIDOR (0103): el cliente no elige
  // con qué nombre publica, solo pide el cambio. Las tres lecturas están
  // `cache()`-eadas por request, así que Ajustes las reusa sin repetir consultas.
  const [menu, negocios, identidad] = await Promise.all([
    getShellContext(),
    listarIdentidadesDeNegocio(),
    getIdentidadActiva(),
  ]);
  // Single-community: si el tenant no trae logo propio, cae al logo de la
  // plataforma (las tres figuras azul·amarillo·rojo).
  const logoSrc = tenant.logoUrl ?? "/brand/logo-mark.png";
  const headerClass = ["bg-surface/85 backdrop-blur-md", className]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={headerClass}>
      <div className="mx-auto flex h-14 w-full max-w-lg items-center gap-2 px-4">
        {/* El LOGO no cede nunca: `min-w-8` es exactamente su ancho, así que el
            isotipo sigue entero pase lo que pase. Antes acá había `min-w-0` y,
            con "Tu zona" mostrando una etiqueta a la derecha, este link se
            comprimía a 26px y recortaba el propio logo.

            ── QUIÉN CEDE EL TEXTO A 375px, Y POR QUÉ CAMBIÓ ──────────────────
            "Los dos ceden un poco" sonaba justo y medido dio lo contrario: con
            una zona activa, el nombre de la marca quedaba en 41px de los 135
            que necesita y la etiqueta de zona en 38px. Dos rótulos cortados a
            tres letras cada uno son peor que uno solo bien puesto — y encima
            ninguno de los dos se puede leer.

            Ahora la prioridad se invierte según haya zona elegida o no:

              · CON zona activa, el wordmark se esconde (`max-sm:hidden`) y la
                zona se queda con el ancho. El isotipo ya dice de qué app se
                trata —está a la izquierda, es la marca— mientras que la zona es
                un estado que la persona acaba de elegir y que no puede leer en
                ningún otro lado de la pantalla.
              · SIN zona (toda la comunidad, el default), manda el wordmark y es
                la etiqueta de zona la que se colapsa a su ícono. O sea: quien
                no toca nada ve exactamente lo de siempre. Cero regresión.

            La regla vieja —"la marca tiene prioridad sobre el rótulo de un
            placeholder"— era correcta cuando eso era un placeholder de "muy
            pronto". Dejó de serlo. */}
        <Link
          href="/feed"
          className="flex min-h-11 min-w-8 items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          aria-label={BRAND_NAME}
        >
          {isOptimizableSrc(logoSrc) ? (
            <Image
              src={logoSrc}
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- logo en un dominio ajeno al allowlist de next/image (tenant custom)
            <img
              src={logoSrc}
              alt=""
              className="h-8 w-8 shrink-0 object-contain"
            />
          )}
          {/* La MARCA, no el nombre del tenant: el header dice siempre
              "Comunidad Latina", sirva la comunidad que sirva. Ver
              @/lib/brand. */}
          <span
            className={`truncate text-base font-bold tracking-tight text-brand-ink${
              hayZona ? " max-sm:hidden" : ""
            }`}
          >
            {BRAND_NAME}
          </span>
        </Link>

        <HeaderActions />

        <NotificationBell />

        {/* Mensajes: bajó del menú lateral y subió acá porque es adonde apunta
            CADA CTA de contacto de la app (la tarjeta de un negocio, la de una
            propiedad, el mensaje inline del feed) y salió del bottom nav para
            hacerle lugar a Ajustes. Sin globito de "sin leer": la tabla
            `messages` no guarda estado de lectura (0006), y un punto que no
            responde a nada es peor que ninguno. */}
        <Link
          href="/mensajes"
          aria-label={t("nav", "messages")}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-foreground-secondary transition-colors duration-(--duration-fast) hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
        >
          <ChatCircle size={24} aria-hidden="true" />
        </Link>

        {/* Perfil, en el lugar donde estaba el botón de menú (pedido de Manuel,
            2026-07-29). El avatar es el control de identidad más reconocible que
            existe en una app social: dice de quién es la sesión ANTES de tocarlo,
            cosa que un ícono de hamburguesa nunca hizo. Sin sesión, la misma
            posición invita a entrar.

            Desde la 0103 ese mismo avatar dice además CON QUÉ PERFIL estás
            actuando: quien tiene cuenta de negocio lo toca y elige (ver
            identity-switcher.tsx). Quien no tiene ninguna no nota el cambio —
            el avatar sigue siendo el link de siempre a /perfil, porque un menú
            de una sola opción es un menú que estorba. */}
        {menu.user && negocios.length > 0 ? (
          <IdentitySwitcher
            personal={menu.user}
            negocios={negocios.map((negocio) => ({
              businessId: negocio.businessId,
              nombre: negocio.nombre,
              rol: negocio.rol,
            }))}
            activeBusinessId={
              identidad.tipo === "negocio" ? identidad.negocio.businessId : null
            }
          />
        ) : menu.user ? (
          <Link
            href="/perfil"
            aria-label={COPY.profile}
            className="flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-(--duration-fast) hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            <Avatar size="sm" name={menu.user.displayName} src={menu.user.avatarUrl} />
          </Link>
        ) : (
          <Link
            href="/entrar"
            className="flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-brand-ink transition-colors duration-(--duration-fast) hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          >
            {COPY.signIn}
          </Link>
        )}
      </div>
      {/* Firma tricolor de la marca: azul · amarillo · rojo (del logo). Reemplaza
          el hairline inferior del header y aparece en toda pantalla autenticada. */}
      <div
        aria-hidden="true"
        className="h-[3px] w-full"
        style={{
          background:
            "linear-gradient(90deg, var(--brand-blue) 0 33.34%, var(--brand-yellow) 33.34% 66.67%, var(--brand-red) 66.67% 100%)",
        }}
      />
    </header>
  );
}
