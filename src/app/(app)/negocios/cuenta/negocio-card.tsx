import { SealCheck, ShieldWarning, Storefront } from "@phosphor-icons/react/dist/ssr";
import { Avatar, BezelCard, Chip } from "@/components/ui";
import type { IdentidadNegocio } from "@/lib/perfil-activo/identidad";
import { PERFIL_ACTIVO_COPY } from "@/lib/perfil-activo/copy";
import { businessCategoryLabel } from "../categories";
import { COPY } from "./copy";
import { UsarPerfil } from "./usar-perfil";

/**
 * =============================================================================
 * UNA TARJETA DE NEGOCIO — pensada para una lista de 1 a 10
 * =============================================================================
 *
 * Vive en su propio archivo desde que la lista puede tener diez filas: una
 * tarjeta que se repite diez veces merece poder mirarse (y testearse) sola.
 *
 * ── TRES COSAS QUE ESTABAN MAL Y POR QUÉ SE ARREGLARON ASÍ ──────────────────
 *
 * 1. CAJA ADENTRO DE CAJA. El estado se pintaba como un rectángulo de color a
 *    ancho completo, flotando en el medio de una tarjeta que ya tiene marco
 *    propio (el bisel). Ahora es un `Chip`: del tamaño de su texto, alineado
 *    con el resto, y sin competir con el borde de la tarjeta. Lo que sí ocupa
 *    todo el ancho es el color del BISEL (`variant="featured"`), que es el
 *    recurso que el design system ya tiene para decir "ésta".
 *
 * 2. TODO DEL MISMO TAMAÑO. Nombre, rubro y estado medían casi lo mismo, así
 *    que nada decía qué mirar primero. Ahora hay tres escalones claros: foto de
 *    56px → nombre en 16px display bold → metadatos en 12px.
 *
 * 3. DOS BLOQUES DE COLOR PEGADOS. El estado y el botón se tocaban (el `gap`
 *    que debía separarlos estaba puesto en el marco, no en el contenido: no
 *    hacía nada). Ahora los chips son metadatos y el botón queda debajo de una
 *    línea divisoria, que es lo que lo ancla en vez de dejarlo flotando.
 *
 * ── ÍCONO + PALABRA, NUNCA SÓLO COLOR ──────────────────────────────────────
 * Los dos chips llevan ícono Y texto. Es la regla de §3.2 y acá pesa doble: la
 * verificación de un negocio es exactamente el dato que alguien puede leer mal
 * y decidir mandar plata.
 */
export function NegocioCard({
  negocio,
  activo,
  nombrePersonal,
}: {
  negocio: IdentidadNegocio;
  /** ¿Es el perfil con el que la persona está actuando ahora mismo? */
  activo: boolean;
  /** Cómo se llama la persona — para nombrar el perfil al que vuelve. */
  nombrePersonal: string;
}) {
  const rubro = businessCategoryLabel(negocio.categoria);
  const meta = [rubro, PERFIL_ACTIVO_COPY.roles[negocio.rol]].filter(Boolean).join(" · ");

  return (
    <BezelCard
      variant={activo ? "featured" : "default"}
      coreClassName="flex flex-col gap-3 p-4"
    >
      <div className="flex items-center gap-3">
        <Avatar size="lg" name={negocio.nombre} src={negocio.avatarUrl} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-bold text-foreground">
            {negocio.nombre}
          </p>
          {meta && <p className="truncate text-xs text-foreground-secondary">{meta}</p>}
        </div>
      </div>

      {/* Estado y verificación: metadatos, no titulares. Envuelven solos si el
          nombre del rubro es largo o si el texto del sistema está agrandado. */}
      <div className="flex flex-wrap items-center gap-2">
        {activo && (
          <Chip
            variant="brand"
            size="sm"
            icon={<Storefront weight="fill" />}
          >
            {COPY.card.activeNow}
          </Chip>
        )}
        <Chip
          variant={negocio.verificada ? "success" : "neutral"}
          size="sm"
          icon={negocio.verificada ? <SealCheck weight="fill" /> : <ShieldWarning />}
        >
          {negocio.verificada ? COPY.verificacion.verified : COPY.verificacion.pending}
        </Chip>
      </div>

      {/* La acción, anclada a una línea. Es lo que le faltaba: antes quedaba
          suelta contra el bloque de color de arriba, sin nada que la separara. */}
      <div className="border-t border-border-subtle pt-3">
        <UsarPerfil
          businessId={negocio.businessId}
          nombre={negocio.nombre}
          nombrePersonal={nombrePersonal}
          activo={activo}
        />
      </div>
    </BezelCard>
  );
}
