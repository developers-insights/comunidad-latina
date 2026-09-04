"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BookmarkSimple, DotsThree, ShareNetwork } from "@phosphor-icons/react/dist/ssr";
import { BottomSheet, useToast } from "@/components/ui";
import { SectionTopBar } from "@/components/shell";
import { ReportScamButton, ReportSheet } from "@/components/trust";
import { cn } from "@/lib/utils";
import {
  recordListingShareAction,
  recordListingViewAction,
  toggleSaveAction,
} from "@/app/(app)/feed/engagement-actions";
import { COPY } from "./copy";

const iconButtonClass = cn(
  "flex size-11 items-center justify-center rounded-full text-foreground-secondary",
  "transition-[background-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
  "hover:bg-surface-subtle active:scale-[0.94]",
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
);

export interface DetailTopBarProps {
  title: string;
  listingId: string;
  /**
   * Estado inicial de "Guardar" (tabla `saves`, 0038), resuelto por la página.
   *
   * OPCIONAL a propósito: si el caller todavía no lo consulta, el botón NO se
   * muestra — preferimos la ausencia antes que un marcador que arranca siempre
   * vacío y le miente al usuario sobre lo que ya tenía guardado. Cada detalle lo
   * habilita cuando pasa este dato.
   */
  initialSaved?: boolean;
  /**
   * A dónde volver cuando NO hay historial de la app detrás (link compartido,
   * PWA recién abierta). Por defecto, la ruta padre: `/propiedades/abc` vuelve
   * a `/propiedades`, `/negocios/abc/editar` a `/negocios/abc`. Es el default
   * correcto para los ocho detalles que montan esta barra, y queda el prop por
   * si algún día uno necesita otra salida.
   */
  fallbackHref?: string;
}

/**
 * Ruta padre de un pathname. `/empleos/123` → `/empleos`. Sin padre (una ruta
 * de un solo segmento, que hoy ningún detalle es) cae a /buscar, que es el mapa
 * de la app y nunca un callejón.
 */
function parentPath(pathname: string): string {
  const parent = pathname.replace(/\/+$/, "").split("/").slice(0, -1).join("/");
  return parent.length > 1 ? parent : "/buscar";
}

/**
 * Barra superior del detalle (§4.d): volver + guardar + compartir + menú "⋯"
 * con "Reportar" SIEMPRE como primera opción (§3.3 — la consistencia
 * posicional es en sí misma una señal de seguridad). El reporte usa el
 * ReportSheet unificado (2 taps) contra el propio aviso.
 *
 * "Guardar" es optimista con la misma tolerancia a errores que el del feed: se
 * pinta al instante y se revierte si el server dice que no.
 *
 * ADEMÁS ES EL SENSOR DE "VISTAS" Y "COMPARTIDOS" del aviso (0050), y está acá
 * por una razón de cobertura, no de comodidad: los seis detalles de aviso
 * (propiedades, negocios, profesionales, eventos, marketplace, empleos) montan
 * esta barra, así que un vertical nuevo hereda la métrica sin que nadie se
 * acuerde de agregársela. Un tracker suelto que hay que recordar poner en cada
 * página es un contador que en algún momento va a estar mintiendo por omisión.
 */
export function DetailTopBar({
  title,
  listingId,
  initialSaved,
  fallbackHref,
}: DetailTopBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [saved, setSaved] = useState(initialSaved ?? false);
  const [, startSaveTransition] = useTransition();
  const viewedRef = useRef<string | null>(null);

  /**
   * Vista del aviso, una sola vez por aviso y por montaje.
   *
   * El `ref` no es una optimización: en desarrollo el StrictMode monta dos
   * veces, y aunque la PK de `listing_views` deduplica por día del lado de la
   * base (el segundo insert vuelve como 23505 tolerado), mandar dos veces el
   * mismo round-trip por cada apertura es ruido gratis. Se guarda el id y no un
   * booleano para que navegar de un aviso a otro sin desmontar la barra cuente
   * el segundo aviso.
   */
  useEffect(() => {
    if (viewedRef.current === listingId) return;
    viewedRef.current = listingId;
    void recordListingViewAction({ listingId }).catch(() => undefined);
  }, [listingId]);

  function toggleSave() {
    const next = !saved;
    setSaved(next);
    try {
      navigator.vibrate?.(10);
    } catch {
      // sin soporte háptico: nada que hacer
    }

    startSaveTransition(async () => {
      const result = await toggleSaveAction({
        subjectKind: "listing",
        subjectId: listingId,
        save: next,
      });
      if (result.ok) {
        setSaved(result.saved);
        return;
      }
      setSaved(!next); // revertimos: la UI no puede mentir sobre lo guardado
      if (result.code === "unauthenticated") {
        router.push(`/entrar?next=${encodeURIComponent(pathname || "/")}`);
        return;
      }
      toast({
        title: COPY.detail.saveErrorTitle,
        description: COPY.detail.saveErrorBody,
        variant: "danger",
      });
    });
  }

  /**
   * Compartir. El contador se suma DESPUÉS de que el share nativo o el
   * copiar-link resolvieron bien, nunca antes: cancelar el diálogo del sistema
   * lanza, y contarlo igual convertiría cada arrepentimiento en una compartida
   * que no pasó. La métrica nunca se espera (`void`) — compartir no puede
   * quedar esperando a un contador.
   */
  async function handleShare() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        void recordListingShareAction({ listingId }).catch(() => undefined);
        return;
      }
      await navigator.clipboard.writeText(url);
      void recordListingShareAction({ listingId }).catch(() => undefined);
      toast({
        title: COPY.detail.shareCopiedTitle,
        description: COPY.detail.shareCopiedBody,
        variant: "success",
      });
    } catch {
      // El usuario canceló el share nativo — no es un error.
    }
  }

  return (
    <>
      {/* El "Volver" es el MISMO control que en las portadas de sección y en los
          formularios (`SectionTopBar`): mismo lugar, misma palabra, y con
          fallback cuando alguien abrió este aviso desde un link compartido y
          atrás no hay app sino el chat de donde vino. */}
      <SectionTopBar
        fallbackHref={fallbackHref ?? parentPath(pathname || "/")}
        actions={
          <>
            {initialSaved !== undefined && (
              <button
                type="button"
                aria-label={saved ? COPY.detail.unsave : COPY.detail.save}
                aria-pressed={saved}
                onClick={toggleSave}
                className={cn(iconButtonClass, saved && "text-brand")}
              >
                <BookmarkSimple
                  size={22}
                  weight={saved ? "fill" : "regular"}
                  aria-hidden="true"
                />
              </button>
            )}
            <button
              type="button"
              aria-label={COPY.detail.share}
              onClick={handleShare}
              className={iconButtonClass}
            >
              <ShareNetwork size={22} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={COPY.detail.moreActions}
              aria-haspopup="dialog"
              onClick={() => setMenuOpen(true)}
              className={iconButtonClass}
            >
              <DotsThree size={26} weight="bold" aria-hidden="true" />
            </button>
          </>
        }
      />

      {/* Menú "⋯" — Reportar SIEMPRE primera opción (§3.3) */}
      <BottomSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        ariaLabel={COPY.detail.moreActions}
      >
        <div className="-mx-4 pb-2">
          <ReportScamButton
            variant="menu-item"
            onReport={() => {
              setMenuOpen(false);
              setReportOpen(true);
            }}
          />
        </div>
      </BottomSheet>

      <ReportSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        targetKind="listing"
        targetId={listingId}
        contextLabel={title}
      />
    </>
  );
}
