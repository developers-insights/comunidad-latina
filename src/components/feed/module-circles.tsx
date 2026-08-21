"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { m, useReducedMotion, type Transition } from "motion/react";
import type { Icon } from "@phosphor-icons/react";
import { bubbleStyle } from "@/components/ui";
import { MODULES } from "@/components/shell/modules";
import { visibleModules, type VisibleModuleState } from "@/components/shell/module-access";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { type FeedTabId } from "./helpers";

/**
 * FILA DE MÓDULOS DEL FEED — círculo con el ícono del módulo y el nombre debajo.
 *
 * Reemplaza a los tabs de texto que encabezaban el feed. El pedido del cliente
 * (video 2026-08-12, con captura anotada) fue la FORMA de una app de referencia
 * —«tienen un círculo con un gráfico de lo que representa cada módulo y en la
 * parte de abajo del círculo tiene el nombre»— pero con NUESTROS gráficos: los
 * íconos 3D que ya usan el menú y /buscar («esos gráficos de los módulos no
 * están tan bonitos, sería algo un poquito más simple»). De ahí que acá no haya
 * ni gradientes ni sombras propias: el ícono ya trae su color, y todo lo demás
 * es un anillo y una palabra.
 *
 * ─── La decisión difícil: la fila mezcla DOS cosas ───
 *
 * En la captura conviven "Eventos / Vivienda / Negocios / Profesionales", que
 * son FILTROS del feed (`?tab=`, la misma pantalla con otro contenido), con
 * "Trabajos / Creator Marketplace", que son SECCIONES aparte (`/empleos`,
 * `/creadores`). Dibujarlas iguales y hacer que se comporten distinto sin
 * avisar es lo único que no se podía hacer: un círculo no puede mentir sobre a
 * dónde lleva.
 *
 * La resolución: cada círculo va adonde su nombre promete, y la fila lo dice
 * con su estructura en vez de con un cartel.
 *
 *  · Los módulos que TIENEN tab de feed (Todo, Vivienda, Eventos,
 *    Negocios, Profesionales) filtran el feed y te dejan donde estabas. Van en
 *    el primer grupo, y son los únicos que pueden quedar marcados como activos
 *    —porque el estado que marcan es el de ESTA pantalla.
 *  · Los que no tienen tab (Empleos, Marketplace, Influencers) navegan a su
 *    sección. Van en el segundo grupo, después de un hairline, y nunca se
 *    marcan activos.
 *
 * Los dos grupos son `<ul>` con su propio nombre accesible dentro de un mismo
 * `<nav>`: quien escucha la pantalla oye "Filtrar el feed" antes de los cinco
 * primeros y "Otras secciones" antes de los otros, que es exactamente la
 * diferencia que el hairline dibuja para quien ve.
 *
 * Todo es `<a>`: no hay `role="tablist"` porque no hay paneles que se muestren
 * y se oculten en el cliente — cada filtro es una URL server-rendered, igual
 * que antes (`?tab=`), y anunciar tabs falsos rompería la promesa del rol.
 */

/** Módulo con pestaña propia en el bottom nav: no repite lugar acá. */
const VIDEOS_HREF = "/videos";

/** El feed mismo: el círculo que devuelve al "para vos" sin filtrar. */
const FEED_HREF = "/feed";

/**
 * Puente entre los dos espacios de identificadores: el `href` del registro de
 * módulos y el `id` del tab del feed. Es la ÚNICA lista escrita a mano de este
 * archivo, y está cubierta por test en los dos sentidos (ningún href fantasma;
 * ningún tab del feed sin su círculo).
 */
const FEED_TAB_BY_HREF: Record<string, FeedTabId> = {
  [FEED_HREF]: "para-ti",
  "/propiedades": "propiedades",
  "/negocios": "negocios",
  "/profesionales": "profesionales",
  "/eventos": "eventos",
};

/** URL del filtro. "para-ti" es el feed pelado: sin query que ensucie el link. */
export function feedTabHref(tab: FeedTabId): string {
  return tab === "para-ti" ? FEED_HREF : `${FEED_HREF}?tab=${tab}`;
}

export interface ModuleCircle {
  /** `href` del módulo en el registro — único, sirve de key. */
  key: string;
  label: string;
  /** Adónde lleva de verdad el círculo. */
  href: string;
  /** Ícono 3D del set del menú; ausente = cae al Phosphor de `icon`. */
  image?: string;
  icon: Icon;
  /** `var(--accent-*)` del módulo. */
  accent: string;
  /** Tab que filtra, o null si el círculo navega a otra sección. */
  tab: FeedTabId | null;
  state: VisibleModuleState;
}

export interface ModuleCircleGroups {
  /** Filtran el feed y te dejan en esta pantalla. */
  filters: ModuleCircle[];
  /** Llevan a otra sección de la plataforma. */
  sections: ModuleCircle[];
}

/**
 * La fila, armada desde el REGISTRO de módulos y la configuración del tenant —
 * nunca desde una lista de nombres escrita acá. Un módulo que el panel
 * (/admin/dominio) apagó no aparece, y uno en "muy pronto" aparece con su
 * etiqueta.
 *
 * Un módulo en "muy pronto" pierde su condición de filtro aunque tenga tab: el
 * filtro mostraría avisos de una sección que todavía no abrió. Se va al segundo
 * grupo y apunta a su ruta, que es donde vive la pantalla de "Muy pronto".
 */
export function moduleCircles(
  modules: Record<string, boolean> | null | undefined,
  modulesSoon: Record<string, boolean> | null | undefined,
): ModuleCircleGroups {
  const filters: ModuleCircle[] = [];
  const sections: ModuleCircle[] = [];

  for (const { item, state } of visibleModules(MODULES, modules, modulesSoon)) {
    if (item.href === VIDEOS_HREF) continue;

    const tab = state === "active" ? (FEED_TAB_BY_HREF[item.href] ?? null) : null;
    const circle: ModuleCircle = {
      key: item.href,
      // El círculo del feed no nombra el destino /feed sino el filtro SIN
      // filtrar, así que al lado de "Vivienda" o "Eventos" tiene que nombrar la
      // misma clase de cosa. Y NO puede llamarse "Comunidad": ese nombre es del
      // módulo de ayuda mutua, que está en esta misma fila.
      label: item.href === FEED_HREF ? COPY.modules.paraTi : item.label,
      href: tab ? feedTabHref(tab) : item.href,
      image: item.image,
      icon: item.icon,
      accent: item.palette.icon,
      tab,
      state,
    };
    (tab ? filters : sections).push(circle);
  }

  return { filters, sections };
}

/**
 * Resorte del anillo activo, en función de cuántos círculos saltó (heredado de
 * los tabs viejos, donde el pedido del cliente —2026-07-20— fue explícito: que
 * "se pase un poquitín y vuelva", y que cuanto más lejos salte, un poquitín
 * más). `bounce` es la amplitud del sobrepaso y `visualDuration` el tiempo
 * percibido hasta asentarse; los topes están puestos para que el efecto se note
 * pero nunca se lea como "rebotó".
 */
export function ringSpring(distance: number) {
  const d = Math.min(Math.max(distance, 1), 4);
  return {
    type: "spring" as const,
    visualDuration: 0.24 + d * 0.028, // 0.27s → 0.35s
    bounce: 0.06 + d * 0.035, // 0.10 → 0.20
  };
}

export interface ModuleCirclesProps {
  /** Tab vigente según la URL (`?tab=`) — la verdad, no el optimismo. */
  active: FeedTabId;
  /** `tenants.modules` tal cual lo resuelve el server. */
  modules: Record<string, boolean> | null | undefined;
  /** `tenants.modules_soon`, su hermana. */
  modulesSoon: Record<string, boolean> | null | undefined;
}

export function ModuleCircles({ active, modules, modulesSoon }: ModuleCirclesProps) {
  const reduceMotion = useReducedMotion();
  const activeItemRef = useRef<HTMLLIElement>(null);
  /** El carril horizontal: es lo ÚNICO que se mueve al cambiar de filtro. */
  const railRef = useRef<HTMLDivElement>(null);

  const { filters, sections } = moduleCircles(modules, modulesSoon);

  // Optimista + de dónde venía (para graduar el salto del anillo). La URL manda:
  // cuando la navegación aterriza, el optimista se descarta. Estas rutas son
  // server-rendered con queries a la base y tardan; atado sólo al server, el
  // anillo saltaba recién al terminar de cargar y se sentía tosco.
  const [optimistic, setOptimistic] = useState<FeedTabId | null>(null);
  const [lastActive, setLastActive] = useState<FeedTabId>(active);
  const [from, setFrom] = useState<FeedTabId>(active);

  if (active !== lastActive) {
    setFrom(lastActive);
    setLastActive(active);
    setOptimistic(null);
  }

  const current = optimistic ?? active;
  const indexOf = (tab: FeedTabId) => filters.findIndex((circle) => circle.tab === tab);
  const distance = Math.abs(indexOf(current) - indexOf(from));

  /**
   * El círculo elegido siempre visible: si quedó fuera del scroll horizontal,
   * entra solo. Imperativo a propósito (no toca estado de React).
   *
   * ── POR QUÉ NO ES `scrollIntoView` (cliente 2026-08-20) ─────────────────
   * Era `activeItemRef.current.scrollIntoView({ block: "nearest", inline:
   * "nearest" })`, y tenía un efecto que nadie pidió: `block: "nearest"` mira
   * también el eje VERTICAL, así que cuando la fila de módulos había quedado
   * fuera de vista —o sea, cada vez que alguien venía scrolleando el feed— el
   * click en un filtro pegaba un salto vertical de toda la página.
   *
   * Y ese salto se veía, además, como un defecto raro: el anillo del módulo
   * activo se anima con `layoutId`, o sea midiendo la posición ANTES y DESPUÉS
   * del cambio. Si entremedio la página se movió en vertical, esa diferencia
   * entra en la medición y el anillo cruza la pantalla en diagonal — el
   * cliente lo describió como "una barrita del color del tema que viene desde
   * abajo del todo". No era el anillo: era el scroll de la página metiéndose
   * en la medición.
   *
   * Ahora se mueve SÓLO el carril, con su propio `scrollLeft`. Un scroll
   * horizontal de un contenedor no puede tocar el scroll vertical del
   * documento, así que el defecto no puede volver por otro camino.
   */
  useEffect(() => {
    const rail = railRef.current;
    const item = activeItemRef.current;
    if (!rail || !item) return;

    const railBox = rail.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    // El mismo respiro que el `px-4` del carril: el círculo elegido no queda
    // pegado al borde, así se sigue viendo que hay más a los costados.
    const margin = 16;

    let delta = 0;
    if (itemBox.left < railBox.left + margin) {
      delta = itemBox.left - railBox.left - margin;
    } else if (itemBox.right > railBox.right - margin) {
      delta = itemBox.right - railBox.right + margin;
    }
    if (delta === 0) return;

    // `scrollBy` puede no existir en jsdom: el ajuste es cosmético y no vale
    // romper un test por él.
    rail.scrollBy?.({ left: delta, behavior: reduceMotion ? "auto" : "smooth" });
  }, [current, reduceMotion]);

  return (
    <nav aria-label={COPY.modules.ariaLabel} className="-mx-4">
      {/* Un solo carril de scroll para los dos grupos: la fila se lee como una
          sola cosa aunque por dentro sean dos listas. `snap-x` sin `mandatory`
          — el snap acomoda el gesto, no lo pelea (con `mandatory` no se puede
          dejar medio círculo asomando, que es justo la pista de "hay más"). */}
      <div
        ref={railRef}
        className="flex snap-x items-start gap-1 overflow-x-auto px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ul aria-label={COPY.modules.filtersLabel} className="flex items-start gap-1">
          {filters.map((circle) => {
            const isCurrent = circle.tab === current;
            return (
              <li
                key={circle.key}
                ref={isCurrent ? activeItemRef : undefined}
                className="shrink-0 snap-start"
              >
                <ModuleCircleLink
                  circle={circle}
                  isCurrent={isCurrent}
                  isActivePage={circle.tab === active}
                  ringTransition={reduceMotion ? { duration: 0 } : ringSpring(distance)}
                  onSelect={() => {
                    if (!circle.tab || circle.tab === current) return;
                    setFrom(current);
                    setOptimistic(circle.tab);
                  }}
                />
              </li>
            );
          })}
        </ul>

        {sections.length > 0 && (
          // Hairline: la única marca de que a partir de acá los círculos SALEN
          // del feed. Es decorativa —el nombre de cada lista ya lo dice para
          // quien escucha— así que no entra en el árbol de accesibilidad.
          <span
            aria-hidden="true"
            className="mx-1 mt-6 h-8 w-px shrink-0 bg-border-subtle"
          />
        )}

        {sections.length > 0 && (
          <ul aria-label={COPY.modules.sectionsLabel} className="flex items-start gap-1">
            {sections.map((circle) => (
              <li key={circle.key} className="shrink-0 snap-start">
                <ModuleCircleLink circle={circle} isCurrent={false} isActivePage={false} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}

/**
 * Un círculo. El ancho fijo (76px) es lo que hace que en 375px se vean cuatro
 * enteros y medio: se ve que la fila sigue y que se puede deslizar, sin
 * degradados ni flechas encima.
 */
function ModuleCircleLink({
  circle,
  isCurrent,
  isActivePage,
  ringTransition,
  onSelect,
}: {
  circle: ModuleCircle;
  /** Marcado en la UI (puede ir adelantado a la navegación). */
  isCurrent: boolean;
  /** La URL YA está en este filtro: recién ahí se puede decir `aria-current`. */
  isActivePage: boolean;
  ringTransition?: Transition;
  onSelect?: () => void;
}) {
  const IconComponent = circle.icon;
  const soon = circle.state === "soon";

  return (
    <Link
      href={circle.href}
      onClick={onSelect}
      // Los filtros se prefetchean (es la misma pantalla y el cambio tiene que
      // sentirse inmediato); las secciones no, para no traerse media app cada
      // vez que alguien abre el feed.
      prefetch={circle.tab ? undefined : false}
      aria-current={isActivePage ? "page" : undefined}
      style={bubbleStyle(circle.accent)}
      className={cn(
        "group flex w-19 flex-col items-center gap-1.5 rounded-xl px-1 py-1",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
      )}
    >
      <span aria-hidden="true" className="relative flex size-14 shrink-0 items-center justify-center">
        <span
          className={cn(
            "flex size-full items-center justify-center overflow-hidden rounded-full",
            "transition-transform duration-(--duration-fast) ease-(--ease-spring)",
            "group-active:scale-95",
            // El ícono es lo único que se atenúa en "muy pronto": es decorativo,
            // así que bajarlo no le cuesta contraste a nadie. El nombre se queda
            // entero — el público incluye gente mayor.
            soon && "opacity-70",
          )}
          style={{ backgroundColor: "var(--bubble-fill)" }}
        >
          {circle.image ? (
            /* Set premium 3D (Meshy): la imagen trae su propio fondo pastel del
               acento — full-bleed dentro del círculo. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={circle.image}
              alt=""
              width={56}
              height={56}
              loading="lazy"
              className="size-full object-cover"
            />
          ) : (
            <IconComponent size={26} weight="regular" style={{ color: circle.accent }} />
          )}
        </span>
        {isCurrent && (
          // layoutId: Motion mide las dos posiciones y anima el salto — no hay
          // que calcular offsets a mano ni guardarlos en estado. El anillo va
          // SEPARADO del círculo (no `border`) para que nada cambie de tamaño
          // al activarse y la fila no se corra bajo el dedo.
          <m.span
            layoutId="feed-module-ring"
            className="pointer-events-none absolute -inset-[3px] rounded-full"
            style={{ boxShadow: "0 0 0 2px var(--bubble-line-strong)" }}
            transition={ringTransition}
          />
        )}
      </span>

      <span className="flex min-w-0 flex-col items-center text-center leading-tight">
        <span
          className={cn(
            // El estado NO se juega al color: el anillo lo dibuja y el peso lo
            // acompaña, así que se lee igual en escala de grises. Y el nombre
            // se queda siempre en `text-foreground` — es la etiqueta principal,
            // nunca el dato que se apaga.
            "line-clamp-2 text-[11px] text-foreground",
            isCurrent ? "font-semibold" : "font-medium",
          )}
        >
          {circle.label}
        </span>
        {soon && (
          // Texto, no sólo color: el estado llega igual a quien no distingue el
          // matiz y a quien escucha la pantalla ("Marketplace Muy pronto, enlace").
          <span className="mt-0.5 text-[10px] font-semibold text-foreground-secondary">
            {t("nav", "moduleSoonBadge")}
          </span>
        )}
      </span>
    </Link>
  );
}
