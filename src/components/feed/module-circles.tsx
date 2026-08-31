"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { m, useReducedMotion, type Transition } from "motion/react";
import type { Icon } from "@phosphor-icons/react";
import { bubbleStyle } from "@/components/ui";
import { MODULES } from "@/components/shell/modules";
import { visibleModules, type VisibleModuleState } from "@/components/shell/module-access";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { COPY } from "./copy";
import { esTabSocial, type FeedTabId } from "./helpers";

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
 * ─── LA FILA HACE UNA SOLA COSA (cliente, 2026-08-26) ───────────────────────
 *
 * Este archivo tenía anotada, desde el día uno, la tensión que el cliente
 * terminó señalando: la fila mezclaba círculos que FILTRABAN el feed (`?tab=`:
 * Vivienda, Eventos, Negocios, Profesionales) con círculos que NAVEGABAN a su
 * sección (Empleos, Marketplace, Influencers, Comunidad), separados por un
 * hairline. Los rodeó a todos con un círculo verde y pidió: «que tengan las
 * mismas funciones que en el buscador».
 *
 * En /buscar, tocar "Vivienda" te deja en /propiedades: la sección completa,
 * con su buscador y sus filtros ("apartamento, cuarto, de cuánto a cuánto").
 * Acá, tocar "Vivienda" te dejaba en `/feed?tab=propiedades`: una lista de
 * avisos de vivienda en orden cronológico, SIN buscador y SIN un solo filtro.
 * Dos círculos con el mismo nombre, el mismo ícono y el mismo color, en la
 * misma app, entregando cosas distintas — y el peor de los dos ganaba, porque
 * está en la pantalla donde la gente abre la app.
 *
 * La resolución es la que el cliente pidió y la que el docblock viejo ya
 * apuntaba como única salida honesta: **un círculo = un módulo = su sección**.
 * Todos los círculos hacen lo mismo, van adonde dice su nombre, y ese destino
 * es EXACTAMENTE el mismo `item.href` que usa la burbuja de /buscar
 * (`ModuleBubble`) — no una ruta parecida escrita al lado.
 *
 * Consecuencias, dichas de frente:
 *  · Desaparecen los dos grupos y el hairline: ya no hay dos clases de círculo
 *    que distinguir, así que no hay nada que separar. La `<nav>` vuelve a ser
 *    una sola lista con un solo nombre accesible.
 *  · Los tabs verticales del feed (`?tab=propiedades|negocios|profesionales|
 *    eventos`) dejan de tener puerta en la UI. NO se borran: `parseTab` los
 *    sigue entendiendo y `load-more.ts` los sigue sirviendo, así que un link
 *    viejo —compartido, guardado, indexado— muestra lo mismo que mostraba.
 *    Sacarles la entrada visual no es romperlos.
 *  · El círculo del propio feed (`/feed`) se queda, y es el único que puede
 *    marcarse: es el "estás acá" de esta pantalla. "Siguiendo" sigue entrando
 *    por el conmutador (`feed-mode-toggle.tsx`), que es donde corresponde — es
 *    un modo del mismo feed, no un módulo.
 *  · Ningún círculo prefetchea. Antes los filtros sí, porque eran esta misma
 *    pantalla; ahora todos llevan a una sección entera, y traerse media app
 *    cada vez que alguien abre el feed sería peor que el toque. Es el mismo
 *    criterio que ya había tomado `ModuleBubble` en /buscar.
 *
 * Lo que NO cambia, y es la regla que sostiene todo esto: **qué círculos se ven
 * lo decide el panel** (`tenants.modules` / `modules_soon`, vía
 * `visibleModules`), nunca una lista de nombres escrita acá.
 *
 * Todo es `<a>`: no hay `role="tablist"` porque no hay paneles que se muestren
 * y se oculten en el cliente — cada círculo es una URL server-rendered, y
 * anunciar tabs falsos rompería la promesa del rol.
 */

/** Módulo con pestaña propia en el bottom nav: no repite lugar acá. */
const VIDEOS_HREF = "/videos";

/** El feed mismo: el círculo que devuelve al "para vos" sin filtrar. */
const FEED_HREF = "/feed";

/**
 * URL de un tab del feed. "para-ti" es el feed pelado: sin query que ensucie el
 * link.
 *
 * LA FILA YA NO CONSTRUYE NINGUNA DE ESTAS URLs (ver la cabecera): los círculos
 * llevan a la sección de su módulo. Sigue acá —y sigue exportada— porque los
 * `?tab=` no dejaron de existir: `parseTab` los entiende, `load-more.ts` los
 * sirve y un link viejo los abre. Esta función es DÓNDE ESTÁ ESCRITA su forma,
 * con su test al lado; si alguna pantalla vuelve a necesitar armar uno, sale de
 * acá y no de una plantilla suelta.
 */
export function feedTabHref(tab: FeedTabId): string {
  return tab === "para-ti" ? FEED_HREF : `${FEED_HREF}?tab=${tab}`;
}

export interface ModuleCircle {
  /** `href` del módulo en el registro — único, sirve de key. */
  key: string;
  label: string;
  /** Adónde lleva el círculo: la ruta del módulo, la misma que usa /buscar. */
  href: string;
  /** Ícono 3D del set del menú; ausente = cae al Phosphor de `icon`. */
  image?: string;
  icon: Icon;
  /** `var(--accent-*)` del módulo. */
  accent: string;
  /** `true` sólo para el círculo del propio feed: el "estás acá" de la fila. */
  esElFeed: boolean;
  state: VisibleModuleState;
}

/**
 * Alias de retrocompatibilidad del barril (`components/feed/index.ts`, que este
 * archivo no puede editar). La fila ya no tiene grupos: es una sola lista.
 */
export type ModuleCircleGroups = ModuleCircle[];

/**
 * La fila, armada desde el REGISTRO de módulos y la configuración del tenant —
 * nunca desde una lista de nombres escrita acá. Un módulo que el panel
 * (/admin/dominio) apagó no aparece, y uno en "muy pronto" aparece con su
 * etiqueta y sigue siendo un enlace real (su ruta tiene la pantalla que avisa).
 *
 * El destino de cada círculo es `item.href` TAL CUAL: el mismo valor que la
 * burbuja de /buscar le da a su enlace. Que salga del registro y no de una
 * transformación local es lo que garantiza «las mismas funciones que en el
 * buscador» — si mañana un módulo cambia de ruta, las dos superficies cambian
 * juntas o ninguna.
 *
 * Videos queda afuera y es lo único que se excluye a mano: ya es una pestaña del
 * bottom nav, y repetirlo acá le enseña a la gente que hay dos caminos para lo
 * mismo. Es el mismo criterio con el que `BROWSE_MODULES` lo saca de /buscar.
 * (Y por eso mismo esta fila NO usa `BROWSE_MODULES`: aquella lista saca también
 * el feed —que acá es el ancla de "estás acá"— y suma Boost, que es una compra,
 * no una vertical que se navegue.)
 */
export function moduleCircles(
  modules: Record<string, boolean> | null | undefined,
  modulesSoon: Record<string, boolean> | null | undefined,
): ModuleCircle[] {
  const circles: ModuleCircle[] = [];

  for (const { item, state } of visibleModules(MODULES, modules, modulesSoon)) {
    if (item.href === VIDEOS_HREF) continue;

    circles.push({
      key: item.href,
      // El círculo del feed no nombra el destino ("Feed") sino lo que se ve al
      // entrar: al lado de "Vivienda" o "Eventos" tiene que nombrar la misma
      // clase de cosa. Y NO puede llamarse "Comunidad": ese nombre es del
      // módulo de ayuda mutua, que está en esta misma fila.
      label: item.href === FEED_HREF ? COPY.modules.paraTi : item.label,
      href: item.href,
      image: item.image,
      icon: item.icon,
      accent: item.palette.icon,
      esElFeed: item.href === FEED_HREF,
      state,
    });
  }

  return circles;
}

/**
 * Resorte del anillo, en función de cuántos círculos saltó (heredado de los tabs
 * viejos, donde el pedido del cliente —2026-07-20— fue explícito: que "se pase
 * un poquitín y vuelva", y que cuanto más lejos salte, un poquitín más).
 * `bounce` es la amplitud del sobrepaso y `visualDuration` el tiempo percibido
 * hasta asentarse; los topes están puestos para que el efecto se note pero nunca
 * se lea como "rebotó".
 *
 * Desde que los círculos navegan a su sección (ver la cabecera) el anillo ya no
 * SALTA de un círculo a otro dentro de la misma pantalla: marca el feed, que es
 * donde estás. Así que la fila lo usa con distancia 1 —la entrada más suave del
 * rango— y la curva sigue viviendo acá, con su test, porque es la misma que
 * usan el resto de los indicadores de estado de la app.
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
  /**
   * Tab vigente según la URL (`?tab=`). Ya no elige círculo —ninguno filtra—:
   * sirve para saber si estamos parados en el feed social, que es lo que marca
   * el anillo del primer círculo.
   */
  active: FeedTabId;
  /** `tenants.modules` tal cual lo resuelve el server. */
  modules: Record<string, boolean> | null | undefined;
  /** `tenants.modules_soon`, su hermana. */
  modulesSoon: Record<string, boolean> | null | undefined;
}

export function ModuleCircles({ active, modules, modulesSoon }: ModuleCirclesProps) {
  const reduceMotion = useReducedMotion();
  const activeItemRef = useRef<HTMLLIElement>(null);
  /** El carril horizontal: es lo ÚNICO que se puede mover acá adentro. */
  const railRef = useRef<HTMLDivElement>(null);

  const circles = moduleCircles(modules, modulesSoon);

  /**
   * El anillo marca el círculo del FEED mientras estemos en un modo social del
   * feed ("Para ti" o "Siguiendo"): esta fila sólo se pinta ahí, y los dos son
   * la misma pantalla vista con otro lente.
   *
   * `aria-current="page"` es más estricto que el anillo a propósito: sólo con
   * la URL exacta (`/feed`, o sea "para-ti"). Estando en `?tab=siguiendo` la
   * página NO es /feed pelado, y quien la anuncia ya tiene el conmutador
   * marcado. La distinción entre "marcado en la UI" y "esta ES la página" ya
   * existía en este componente y se conserva tal cual.
   */
  const enElFeed = esTabSocial(active);

  /**
   * El círculo marcado siempre visible: si quedó fuera del scroll horizontal,
   * entra solo. Imperativo a propósito (no toca estado de React).
   *
   * ── POR QUÉ NO ES `scrollIntoView` (cliente 2026-08-20) ─────────────────
   * Era `activeItemRef.current.scrollIntoView({ block: "nearest", inline:
   * "nearest" })`, y tenía un efecto que nadie pidió: `block: "nearest"` mira
   * también el eje VERTICAL, así que cuando la fila de módulos había quedado
   * fuera de vista —o sea, cada vez que alguien venía scrolleando el feed— el
   * click en un círculo pegaba un salto vertical de toda la página.
   *
   * Y ese salto se veía, además, como un defecto raro: el anillo se anima con
   * `layoutId`, o sea midiendo la posición ANTES y DESPUÉS del cambio. Si
   * entremedio la página se movió en vertical, esa diferencia entra en la
   * medición y el anillo cruza la pantalla en diagonal — el cliente lo
   * describió como "una barrita del color del tema que viene desde abajo del
   * todo". No era el anillo: era el scroll de la página metiéndose en la
   * medición.
   *
   * Se mueve SÓLO el carril, con su propio `scrollLeft`. Un scroll horizontal
   * de un contenedor no puede tocar el scroll vertical del documento, así que
   * el defecto no puede volver por otro camino.
   */
  useEffect(() => {
    const rail = railRef.current;
    const item = activeItemRef.current;
    if (!rail || !item) return;

    const railBox = rail.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    // El mismo respiro que el `px-4` del carril: el círculo marcado no queda
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
  }, [enElFeed, reduceMotion]);

  return (
    <nav aria-label={COPY.modules.ariaLabel} className="-mx-4">
      {/* Un carril, una lista. `snap-x` sin `mandatory` — el snap acomoda el
          gesto, no lo pelea (con `mandatory` no se puede dejar medio círculo
          asomando, que es justo la pista de "hay más"). */}
      <div
        ref={railRef}
        className="flex snap-x items-start gap-1 overflow-x-auto px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex items-start gap-1">
          {circles.map((circle) => {
            const isCurrent = circle.esElFeed && enElFeed;
            return (
              <li
                key={circle.key}
                ref={isCurrent ? activeItemRef : undefined}
                className="shrink-0 snap-start"
              >
                <ModuleCircleLink
                  circle={circle}
                  isCurrent={isCurrent}
                  isActivePage={circle.esElFeed && active === "para-ti"}
                  ringTransition={reduceMotion ? { duration: 0 } : ringSpring(1)}
                />
              </li>
            );
          })}
        </ul>
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
}: {
  circle: ModuleCircle;
  /** Marcado en la UI: el módulo en el que estás parado. */
  isCurrent: boolean;
  /** La URL YA es exactamente esta: recién ahí se puede decir `aria-current`. */
  isActivePage: boolean;
  ringTransition?: Transition;
}) {
  const IconComponent = circle.icon;
  const soon = circle.state === "soon";

  return (
    <Link
      href={circle.href}
      // Sin prefetch, igual que la burbuja de /buscar: cada círculo lleva a una
      // SECCIÓN entera, y prefetchear ocho secciones cada vez que alguien abre
      // el feed le cuesta datos a un público que los cuenta.
      prefetch={false}
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
