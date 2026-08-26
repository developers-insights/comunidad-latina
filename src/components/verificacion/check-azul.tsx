import { SealCheck } from "@phosphor-icons/react/dist/ssr";
import { IdentityBadge } from "@/components/auth/identity-badge";
import { COPY_VERIFICACION } from "./copy";

/**
 * =============================================================================
 * EL CHECK AZUL — insignia de la suscripción paga (0101)
 * =============================================================================
 *
 * ⚠️ NO ES `IdentityBadge` Y NO PUEDE PARECERSE A ÉL. Son dos insignias que
 * significan cosas distintas y conviven en el mismo avatar:
 *
 *   · `IdentityBadge` (src/components/auth/identity-badge.tsx) — ESCUDO VERDE.
 *     Identidad confirmada con documento. GRATIS. Es un hecho comprobado.
 *   · Esta — SELLO AZUL con tilde. Suscripción paga al día. Se compra.
 *
 * La diferencia es de FORMA y de COLOR a propósito, no sólo de color: dos
 * insignias que se distinguen únicamente por el tono son la misma insignia para
 * quien tiene daltonismo, para quien mira en una pantalla al sol, y para quien
 * simplemente no las está comparando lado a lado. Escudo ≠ sello dentado, verde
 * ≠ azul. Y cada una lleva su propio `aria-label` completo: quien navega con
 * lector de pantalla escucha la diferencia entera, no un "verificado" ambiguo.
 *
 * POR QUÉ EL AZUL ES `info` Y NO UN AZUL ELEGIDO A OJO
 * `--cl-info` ya está calculado para cumplir AA sobre las cinco superficies del
 * tema, en claro y en oscuro, con su `on-info` correspondiente (#2b6cb0 con
 * texto claro en light, #6fa6e0 con texto oscuro en dark). Un `#1d9bf0` copiado
 * de otra red social daría 2.9:1 sobre blanco y sería ilegible en el tema claro
 * justo en el elemento más chico de la pantalla.
 *
 * `cl-print-fill` (`print-color-adjust: exact`) por el mismo motivo que el
 * escudo verde: el navegador no imprime `background-color`, así que sin este
 * hook el tilde salía blanco sobre papel blanco — 1.00:1. Con el relleno impreso
 * conserva su contraste. Hay un test de contrato de impresión que lo verifica.
 *
 * -----------------------------------------------------------------------------
 * LO QUE ESTE COMPONENTE NO HACE
 * No decide si mostrarse. Quien lo renderiza ya leyó `profiles.verified_badge`
 * —el espejo público que mantiene el trigger de 0101— y decidió. Mezclar la
 * consulta con el dibujo haría que cada insignia del feed fuera una consulta.
 * -----------------------------------------------------------------------------
 */
export function CheckAzul({ size = 24 }: { size?: 20 | 24 }) {
  return (
    <span
      className={`cl-print-fill flex items-center justify-center rounded-full bg-info text-on-info ring-2 ring-surface ${
        size === 20 ? "size-5" : "size-6"
      }`}
      role="img"
      aria-label={COPY_VERIFICACION.insignia.ariaLabel}
      title={COPY_VERIFICACION.insignia.tooltip}
    >
      <SealCheck size={size === 20 ? 12 : 14} weight="fill" aria-hidden="true" />
    </span>
  );
}

/**
 * La versión EN LÍNEA, para ir pegada a un nombre en una lista o un encabezado.
 *
 * Sin anillo ni relleno: al lado de un texto, un círculo sólido de 24px compite
 * con el nombre en vez de acompañarlo. Acá el sello va en tinta `info-ink` —la
 * variante pensada para usarse COMO TEXTO, que es AA sobre las superficies del
 * tema; el fill `bg-info` como color de texto daría 3.6:1 y fallaría.
 *
 * `shrink-0` porque el nombre de al lado sí se puede cortar con ellipsis y la
 * insignia no: una insignia aplastada a 4px de ancho es ruido, no información.
 */
export function CheckAzulInline({ className = "" }: { className?: string }) {
  return (
    <SealCheck
      size={16}
      weight="fill"
      className={`inline-block shrink-0 text-info-ink ${className}`}
      role="img"
      aria-label={COPY_VERIFICACION.insignia.ariaLabel}
    >
      <title>{COPY_VERIFICACION.insignia.tooltip}</title>
    </SealCheck>
  );
}

/**
 * =============================================================================
 * QUÉ INSIGNIA VA EN EL AVATAR — el resolvedor, en un solo lugar
 * =============================================================================
 *
 * El avatar tiene UN espacio para insignia (`Avatar badge=…`, esquina inferior
 * derecha). Con dos verificaciones distintas hay que decidir, y la decisión no
 * puede tomarse suelta en cada pantalla: cinco call sites decidiendo por su
 * cuenta es cómo se termina con el escudo verde en el feed y el sello azul en el
 * perfil para la misma persona.
 *
 * LA REGLA: gana el check azul cuando está, y el escudo verde cuando no.
 *
 * POR QUÉ ESO NO ESCONDE INFORMACIÓN. Porque el check azul IMPLICA la identidad
 * verificada —es su requisito previo (0101)— y su `aria-label` lo dice entero:
 * "Check azul: identidad confirmada con documento y suscripción al día", con el
 * tooltip explicando las dos partes. No se pierde nada: se dice lo mismo con una
 * sola marca en vez de dos.
 *
 * POR QUÉ NO SE APILAN LAS DOS. Porque no entran: dos círculos de 24px en la
 * misma esquina se superponen o empujan el avatar. Y porque dos marcas de
 * "verificado" pegadas es exactamente la confusión que todo este módulo existe
 * para evitar — quien las viera no sabría cuál de las dos es la que importa.
 *
 * El caso de una insignia paga SIN identidad no existe por diseño: la action lo
 * corta antes del Checkout y el webhook lo vuelve a cortar antes de conceder. Si
 * alguna vez apareciera, esta función igual haría lo correcto (mostrar el check,
 * que es el estado de facturación real) y el problema estaría en la fila, no acá.
 */
export function InsigniaDePerfil({
  checkAzul,
  identityVerified,
}: {
  /** `profiles.verified_badge` — el espejo público de la suscripción (0101). */
  checkAzul: boolean;
  /** `profiles.identity_verified` — Stripe Identity, gratis (§5.4). */
  identityVerified: boolean;
}) {
  if (checkAzul) return <CheckAzul />;
  if (identityVerified) return <IdentityBadge />;
  return null;
}
