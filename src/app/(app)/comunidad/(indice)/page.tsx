import { Suspense } from "react";
import {
  BookOpenText,
  ForkKnife,
  HandHeart,
  Lifebuoy,
  MagnifyingGlass,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import { Skeleton, SquareTile } from "@/components/ui";
import {
  COMUNIDAD_ACCENT,
  COMUNIDAD_ACCENT_COMIDA,
  COMUNIDAD_ACCENT_GUIAS,
  COMUNIDAD_ACCENT_PERDIDOS,
  COMUNIDAD_ACCENT_VOLUNTARIOS,
  ComunidadHeading,
  OrigenNota,
} from "@/components/comunidad";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { getTenant } from "@/lib/tenant/resolve";
import { countOpenCases } from "../queries";

export const metadata = { title: "Comunidad" };

const C = COMUNIDAD_COPY.index;

/**
 * ÍNDICE DEL MÓDULO COMUNIDAD.
 *
 * Antes esta ruta redirigía a /feed («la Comunidad ya vive en el feed social»).
 * Ya no: el cliente pidió una sección propia, con información de la comunidad y
 * ayuda mutua. Los enlaces viejos a /comunidad ahora aterrizan acá, que es un
 * destino mejor que el que tenían.
 *
 * ── DE TRES PUERTAS A GRILLA DE CUADRADOS (rediseño 2026-08-13) ─────────────
 * Hasta acá esta pantalla mostraba tres filas apaisadas ("puertas": ícono +
 * texto + flecha), documentado a propósito como "TRES PUERTAS Y NO UNA LISTA"
 * — tres urgencias distintas que mezcladas en un solo listado obligaban a leer
 * todo para encontrar una. Esa razón seguía siendo válida el día que cambió;
 * lo que la superó fue el pedido EXPLÍCITO y textual del cliente, con captura
 * de pantalla adjunta: «mantener los cuadrados iguales en la parte de
 * búsqueda, pero en la sección de comunidad». /buscar ya resolvía el MISMO
 * problema (categorías distintas, cada una con su urgencia y su color) con una
 * grilla de cuadrados — ícono grande arriba, etiqueta abajo, acento pastel
 * propio — y el cliente señaló esa grilla como el molde a copiar acá adentro.
 * Entre "cada sección se escanea sola" (la razón original) y "toda la app usa
 * el mismo lenguaje visual" (el pedido nuevo), gana la consistencia: una
 * grilla de cuadrados sigue separando cada categoría tan bien como las filas
 * lo hacían, y además hace que Comunidad se vea, se toque y se recorra igual
 * que Buscar. El cuadrado en sí no se reimplementó: `SquareTile` es el mismo
 * componente que dibuja /buscar, extraído a `@/components/ui` para esto — ver
 * su cabecera.
 *
 * Dos categorías nuevas (pedido textual: "Bancos de comida gratis" y "Grupo de
 * voluntarios"). Ninguna trajo tabla nueva:
 *   · Bancos de comida YA vivía como tema `comida` de `community_resources`
 *     (0096) — sólo le faltaba una puerta propia. La tarjeta filtra la MISMA
 *     lectura (`fetchResourceGroups`) por `?tema=comida` en
 *     `/comunidad/recursos` — ver ese archivo.
 *   · Voluntarios es tema NUEVO (`voluntariado`, migración 0099) de la MISMA
 *     tabla: directorio de organizaciones que reciben voluntarios, curado por
 *     admins y con fuente obligatoria — el mismo trato que una clínica o un
 *     consulado, no una convocatoria que publica cualquiera. El pedido del
 *     cliente nunca describió "que la gente publique su propia convocatoria";
 *     modelarlo como `listings` hubiese significado construir un flujo de
 *     publicación de dos fases entero (borrador → moderación → publicado,
 *     como Perdido y encontrado) para algo que el directorio curado ya
 *     resuelve con cero tablas nuevas.
 */
export default async function ComunidadPage() {
  return (
    <>
      <ComunidadHeading
        icon={<HandHeart size={30} weight="fill" aria-hidden="true" />}
        title={C.title}
        subtitle={C.subtitle}
      />

      <p className="mt-4 text-sm leading-relaxed text-foreground-secondary">{C.intro}</p>

      <OrigenNota className="mt-5" incluirMigracion />

      {/* Mismas clases de grilla que /buscar (`grid-cols-2 gap-3 sm:grid-cols-3`):
          es el punto que pidió el cliente, no un parecido de casualidad. */}
      <nav aria-label={C.title} className="mt-6">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <li>
            <SquareTile
              href="/comunidad/recursos"
              label={C.cards.recursos.title}
              hint={C.cards.recursos.hint}
              icon={<Lifebuoy size={28} weight="fill" aria-hidden="true" />}
              accent={COMUNIDAD_ACCENT}
            />
          </li>
          <li>
            <SquareTile
              href="/comunidad/guias"
              label={C.cards.guias.title}
              hint={C.cards.guias.hint}
              icon={<BookOpenText size={28} weight="fill" aria-hidden="true" />}
              accent={COMUNIDAD_ACCENT_GUIAS}
            />
          </li>
          <li>
            <SquareTile
              href="/comunidad/perdidos"
              label={C.cards.perdidos.title}
              hint={C.cards.perdidos.hint}
              icon={<MagnifyingGlass size={28} weight="bold" aria-hidden="true" />}
              accent={COMUNIDAD_ACCENT_PERDIDOS}
              badge={
                <Suspense fallback={<Skeleton className="h-5 w-20 rounded-full" />}>
                  <CasosAbiertos />
                </Suspense>
              }
            />
          </li>
          <li>
            <SquareTile
              href="/comunidad/recursos?tema=comida"
              label={C.cards.comida.title}
              hint={C.cards.comida.hint}
              icon={<ForkKnife size={28} weight="fill" aria-hidden="true" />}
              accent={COMUNIDAD_ACCENT_COMIDA}
            />
          </li>
          <li>
            <SquareTile
              href="/comunidad/recursos?tema=voluntariado"
              label={C.cards.voluntarios.title}
              hint={C.cards.voluntarios.hint}
              icon={<UsersThree size={28} weight="fill" aria-hidden="true" />}
              accent={COMUNIDAD_ACCENT_VOLUNTARIOS}
            />
          </li>
        </ul>
      </nav>
    </>
  );
}

/**
 * El contador va en su propio Suspense: es lo único de esta pantalla que
 * consulta la base, y no puede retrasar el render de cinco tarjetas que ya se
 * conocen. Si la consulta falla, el contador no aparece — nunca un cero que
 * mienta diciendo que no hay casos.
 */
async function CasosAbiertos() {
  const tenant = await getTenant();
  const abiertos = await countOpenCases(tenant.id);
  if (abiertos === 0) return null;

  return (
    <span className="inline-flex items-center rounded-full bg-[color-mix(in_oklab,var(--accent-comunidad-perdidos)_18%,var(--color-surface))] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-foreground">
      {abiertos === 1 ? "1 caso abierto" : `${abiertos} casos abiertos`}
    </span>
  );
}
