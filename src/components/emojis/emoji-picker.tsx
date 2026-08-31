"use client";

import { useDeferredValue, useId, useMemo, useState } from "react";
import { ArrowClockwise, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  EMOJI_TILE_MIN_PX,
  filterEmojis,
  groupByCategory,
  type CommunityEmoji,
} from "@/lib/emojis/catalog";
import type { CommunityEmojiLoadState } from "@/lib/emojis/use-community-emojis";
import { CommunityEmojiImage } from "./community-emoji-image";
import { EMOJI_COPY } from "./copy";

/**
 * EL PICKER DE EMOJIS — uno solo para las tres superficies.
 *
 * Es un PANEL, no una hoja ni una caja con fondo propio: no trae ancho, borde
 * ni margen exterior. Así el mismo componente entra en la pestaña "Emojis" del
 * editor de fotos (donde va inline, dentro del panel que ya scrollea) y en el
 * globo que se abre sobre el campo de comentario (donde va flotando y con alto
 * topado). Un picker que se pinta su propia tarjeta no se puede montar en los
 * dos lados sin pelearse con el layout de uno.
 *
 * ─── LA DECISIÓN DE RENDIMIENTO ─────────────────────────────────────────────
 * Son 60 imágenes. No se cargan las 60. Tres cosas, en este orden:
 *
 *  1. UNA CATEGORÍA POR VEZ. Las pestañas son las de `components/ui/tabs.tsx`,
 *     que renderizan `{selected && children}`: el panel que no está activo NO
 *     ESTÁ EN EL DOM, así que sus `<img>` no existen y el navegador no las
 *     pide. Abrir el picker baja una categoría (~10-15), no el pack entero.
 *  2. `loading="lazy"` DENTRO de la categoría (ver `CommunityEmojiImage`): de
 *     esas 15, el navegador baja las que entran en la ventana.
 *  3. EL CATÁLOGO SE PIDE UNA VEZ POR PESTAÑA DEL NAVEGADOR
 *     (`useCommunityEmojis`), no una vez por apertura.
 *
 * SE DESCARTÓ EL SPRITE, que ahorraría pedidos: el editor de fotos tiene que
 * DIBUJAR cada emoji en un canvas, y recortar un sprite en canvas obliga a
 * llevar las coordenadas de cada dibujo en el código, sincronizadas a mano con
 * el archivo del sprite. Serían dos fuentes de verdad para algo que ya es una
 * fila en la base — y cuando se desincronizan, el emoji sale cortado en la foto
 * publicada, que es irreversible. Con HTTP/2 los 15 pedidos de una categoría
 * viajan por la misma conexión; el sprite compraría poco y pagaría caro.
 *
 * ─── ACCESIBILIDAD ──────────────────────────────────────────────────────────
 * Las pestañas traen el patrón WAI-ARIA completo (roles, `aria-selected`,
 * flechas ← →, roving tabindex) porque son las del repo. Cada emoji es un
 * `<button>` real, tabulable, con nombre accesible que dice el NOMBRE y la
 * DESCRIPCIÓN del dibujo — de ahí que `alt_text` sea obligatorio en la base:
 * sin él, el botón se anuncia como "imagen" y no hay forma de elegir.
 */

export interface UnicodeEmojiGroup {
  label: string;
  emojis: readonly string[];
}

export interface EmojiPickerProps {
  /** Estado del catálogo propio (`useCommunityEmojis`). */
  community: CommunityEmojiLoadState;
  onRetry: () => void;
  onPickCommunity: (emoji: CommunityEmoji) => void;
  /**
   * Los emojis del teclado, agrupados. Van todos en UNA pestaña ("Clásicos")
   * con sus grupos adentro: con una pestaña por grupo, un catálogo completo
   * daría diez pestañas para deslizar en 375 px antes de ver un solo dibujo.
   */
  unicodeGroups?: readonly UnicodeEmojiGroup[];
  onPickUnicode?: (emoji: string) => void;
  /**
   * CÓMO SE ANUNCIA CADA BOTÓN. Es un prop y no una constante porque la ACCIÓN
   * cambia con la superficie: en un comentario el emoji "se agrega", en el
   * editor de fotos "se pone sobre la foto" y después se arrastra. Un nombre
   * accesible genérico ("KLK") deja a quien no ve la pantalla sin saber qué va
   * a pasar cuando lo toque.
   */
  labelForCommunity?: (label: string, alt: string) => string;
  labelForUnicode?: (emoji: string) => string;
  /**
   * `true` cuando el picker flota (globo del comentario) y necesita alto
   * topado. En el editor de fotos va en `false`: el panel de la hoja YA
   * scrollea, y una región con scroll adentro de otra es la forma más rápida
   * de que el dedo mueva la equivocada.
   */
  scrollable?: boolean;
  className?: string;
}

const CLASSIC_TAB = "clasicos";

export function EmojiPicker({
  community,
  onRetry,
  onPickCommunity,
  unicodeGroups,
  onPickUnicode,
  labelForCommunity = EMOJI_COPY.add,
  labelForUnicode = (emoji: string) => emoji,
  scrollable = false,
  className,
}: EmojiPickerProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  /**
   * El filtro corre sobre hasta 60 fichas por tecla. `useDeferredValue` deja
   * que la letra se pinte primero y la grilla se recalcule después: en un
   * teléfono de gama media es la diferencia entre escribir fluido y escribir a
   * los saltos.
   */
  const deferredQuery = useDeferredValue(query);

  const emojis = community.status === "ready" ? community.emojis : EMPTY;
  const grupos = useMemo(() => groupByCategory(emojis), [emojis]);
  const resultados = useMemo(
    () => (deferredQuery.trim() ? filterEmojis(emojis, deferredQuery) : null),
    [emojis, deferredQuery],
  );

  const hayClasicos = Boolean(unicodeGroups?.length && onPickUnicode);
  const hayPropios = grupos.length > 0;

  // La primera pestaña es la primera categoría propia si hay; si no, los
  // clásicos. Los emojis de la comunidad son el pedido del cliente: entran
  // primeros, no escondidos detrás de los de siempre.
  const primeraPestana = hayPropios ? grupos[0]!.category : CLASSIC_TAB;

  /**
   * LAS PESTAÑAS VAN CONTROLADAS, y no con `defaultValue`.
   *
   * `defaultValue` se lee UNA vez, al montar. Pero acá el catálogo llega
   * después: en el primer render no hay categorías propias todavía, así que la
   * única pestaña posible es "Clásicos" — y con `defaultValue` quedaba fijada
   * ahí. Cuando el catálogo aterrizaba, la pestaña de la comunidad aparecía
   * pero NO seleccionada: los emojis que el cliente pidió quedaban escondidos a
   * un toque de distancia, detrás de los de siempre.
   *
   * `elegida` es null hasta que la persona toca una pestaña. Mientras tanto
   * manda `primeraPestana`, que se recalcula sola cuando llega el catálogo. Si
   * la elegida deja de existir (un reintento trajo otro catálogo), se cae a la
   * primera en vez de dejar el panel en blanco.
   */
  const [elegida, setElegida] = useState<string | null>(null);
  const disponibles = [...grupos.map((grupo) => grupo.category), ...(hayClasicos ? [CLASSIC_TAB] : [])];
  const pestanaActiva = elegida && disponibles.includes(elegida) ? elegida : primeraPestana;

  const cuerpoGrilla = cn(
    scrollable && "max-h-56 overflow-y-auto overscroll-contain pr-0.5",
  );

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* ── BUSCADOR ────────────────────────────────────────────────────────
          Sólo con catálogo propio cargado: buscar entre los emojis del teclado
          no se puede (no tienen nombre en nuestros datos) y un campo que no
          encuentra nada es peor que no tenerlo. */}
      {hayPropios && (
        <div className="relative">
          <label htmlFor={searchId} className="sr-only">
            {EMOJI_COPY.searchLabel}
          </label>
          <MagnifyingGlass
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted"
          />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={EMOJI_COPY.searchPlaceholder}
            // `text-base` y no `text-sm`: por debajo de 16 px iOS hace zoom
            // solo al enfocar el campo, y el globo se sale de la pantalla.
            className={cn(
              "min-h-11 w-full rounded-full border border-border bg-surface-raised py-2 pl-9 pr-3 text-base",
              "text-foreground placeholder:text-foreground-muted",
              "focus:outline-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
            )}
          />
        </div>
      )}

      {/* ── ESTADOS DEL CATÁLOGO PROPIO ─────────────────────────────────────
          Cada uno tiene su salida. Una sesión vencida no se arregla
          reintentando, y decir "revisá la conexión" haría perder el tiempo. */}
      {/* ── AVISOS: `aria-live` y NUNCA `role="status"` ────────────────────
          Este panel se MONTA DENTRO de otra pantalla que puede tener su propia
          región de estado — el editor de fotos avisa ahí el cupo lleno de
          emojis, justo arriba de acá. Con el rol puesto, el picker aportaría
          una segunda región "status" y "el estado de la pantalla" pasaría a ser
          ambiguo. `aria-live="polite"` + `aria-atomic` es lo que `role="status"`
          significa, palabra por palabra, sin reclamar el rol. */}
      {community.status === "loading" && (
        <div aria-live="polite" aria-atomic="true" aria-busy="true">
          <span className="sr-only">{EMOJI_COPY.loading}</span>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6" aria-hidden="true">
            {SKELETON_KEYS.map((key) => (
              <Skeleton key={key} className="aspect-square rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {community.status === "error" && (
        <div
          aria-live="polite"
          aria-atomic="true"
          className="flex flex-col items-start gap-1.5 rounded-xl border border-border-subtle bg-surface-subtle p-3"
        >
          <p className="text-sm font-medium text-foreground">
            {community.code === "unauthenticated"
              ? EMOJI_COPY.signedOut
              : EMOJI_COPY.errorTitle}
          </p>
          {community.code !== "unauthenticated" && (
            <p className="text-xs leading-relaxed text-foreground-muted">
              {community.message ?? EMOJI_COPY.errorBody}
            </p>
          )}
          {community.code === "error" && (
            <button
              type="button"
              onClick={onRetry}
              className={cn(
                "mt-0.5 flex min-h-11 items-center gap-1.5 text-xs font-medium text-brand",
                "underline-offset-2 hover:underline",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
              )}
            >
              <ArrowClockwise size={14} aria-hidden="true" />
              {EMOJI_COPY.retry}
            </button>
          )}
        </div>
      )}

      {community.status === "ready" && !hayPropios && (
        <div className="rounded-xl border border-border-subtle bg-surface-subtle p-3">
          <p className="text-sm font-medium text-foreground">{EMOJI_COPY.emptyTitle}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">
            {hayClasicos ? EMOJI_COPY.emptyBody : EMOJI_COPY.emptyBodyAlone}
          </p>
        </div>
      )}

      {/* ── BÚSQUEDA ACTIVA: una sola grilla plana, sin pestañas ────────────
          Buscar es justamente no saber en qué categoría está. */}
      {resultados ? (
        <div className={cuerpoGrilla}>
          {resultados.length === 0 ? (
            <p
              aria-live="polite"
              aria-atomic="true"
              className="py-4 text-center text-xs leading-relaxed text-foreground-muted"
            >
              {EMOJI_COPY.noResults(query.trim())}
              <br />
              {EMOJI_COPY.noResultsHint}
            </p>
          ) : (
            <CommunityGrid emojis={resultados} onPick={onPickCommunity} label={labelForCommunity} />
          )}
        </div>
      ) : (
        (hayPropios || hayClasicos) && (
          <Tabs value={pestanaActiva} onValueChange={setElegida}>
            <TabsList aria-label={EMOJI_COPY.tabsLabel}>
              {grupos.map((grupo) => (
                <TabsTrigger key={grupo.category} value={grupo.category} className={TAB_FOCUS}>
                  {grupo.label}
                </TabsTrigger>
              ))}
              {hayClasicos && (
                <TabsTrigger value={CLASSIC_TAB} className={TAB_FOCUS}>
                  {EMOJI_COPY.classicTab}
                </TabsTrigger>
              )}
            </TabsList>

            {grupos.map((grupo) => (
              <TabsContent key={grupo.category} value={grupo.category} className={cn("pt-2", cuerpoGrilla)}>
                <CommunityGrid emojis={grupo.emojis} onPick={onPickCommunity} label={labelForCommunity} />
              </TabsContent>
            ))}

            {hayClasicos && (
              <TabsContent value={CLASSIC_TAB} className={cn("pt-2", cuerpoGrilla)}>
                <div className="flex flex-col gap-3">
                  {unicodeGroups!.map((grupo) => (
                    <fieldset key={grupo.label}>
                      <legend className="text-xs font-medium uppercase tracking-wider text-foreground-muted">
                        {grupo.label}
                      </legend>
                      <div className="mt-1.5 grid grid-cols-6 gap-1.5 sm:grid-cols-8">
                        {grupo.emojis.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => onPickUnicode!(emoji)}
                            aria-label={labelForUnicode(emoji)}
                            className={cn(TILE_BASE, "text-2xl leading-none")}
                          >
                            <span aria-hidden="true">{emoji}</span>
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
              </TabsContent>
            )}
          </Tabs>
        )
      )}
    </div>
  );
}

/** Referencia estable: evita re-memoizar la grilla en cada render. */
const EMPTY: readonly CommunityEmoji[] = [];

const SKELETON_KEYS = ["a", "b", "c", "d", "e", "f", "g", "h"];

const TAB_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring";

/**
 * La celda. `active:scale-90` y no un cambio de color: en un teléfono el dedo
 * TAPA la celda que acaba de tocar, así que la única confirmación que se ve es
 * la que ocurre alrededor del dedo. La escala no mueve a los vecinos (es
 * `transform`), así que la grilla no salta.
 */
const TILE_BASE = cn(
  "grid aspect-square place-items-center rounded-xl p-1",
  "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
  "hover:bg-surface-hover active:scale-90",
  "motion-reduce:transition-none motion-reduce:active:scale-100",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

/**
 * 4 columnas en 375 px y no 6: estos dibujos traen PALABRAS adentro ("KLK",
 * "QUÉ LO QUÉ"). A 50 px la palabra no se lee y elegir se vuelve adivinar —
 * distinto de un glifo del teclado, que a 44 px se reconoce igual y por eso su
 * grilla sí va a 6.
 */
function CommunityGrid({
  emojis,
  onPick,
  label,
}: {
  emojis: readonly CommunityEmoji[];
  onPick: (emoji: CommunityEmoji) => void;
  label: (label: string, alt: string) => string;
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
      {emojis.map((emoji) => (
        <button
          key={emoji.id}
          type="button"
          onClick={() => onPick(emoji)}
          aria-label={label(emoji.label, emoji.alt)}
          style={{ minHeight: EMOJI_TILE_MIN_PX, minWidth: EMOJI_TILE_MIN_PX }}
          className={TILE_BASE}
        >
          <CommunityEmojiImage emoji={emoji} decorative className="w-full" />
        </button>
      ))}
    </div>
  );
}
