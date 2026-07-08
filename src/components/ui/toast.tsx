"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  CheckCircle,
  Info,
  WarningCircle,
  X,
  XCircle,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { useMounted } from "@/lib/design/use-overlay";

export type ToastVariant = "default" | "success" | "danger" | "warning" | "info";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /**
   * ms visibles. Default 4500 — 7000 para danger, que suele traer más texto y
   * peor momento para leerlo. `0` = persistente (solo se cierra a mano).
   */
  duration?: number;
}

/** Un aviso de error trae más texto y llega en mal momento: más aire para leerlo. */
const DEFAULT_DURATION_MS = 4500;
const DANGER_DURATION_MS = 7000;

interface ToastItem extends Required<Pick<ToastOptions, "title" | "variant">> {
  id: string;
  description?: string;
  duration: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast debe usarse dentro de <ToastProvider>");
  }
  return context;
}

const VARIANT_ICON: Record<ToastVariant, React.ReactNode> = {
  default: null,
  success: <CheckCircle size={20} weight="fill" className="text-success" />,
  danger: <XCircle size={20} weight="fill" className="text-danger" />,
  warning: <WarningCircle size={20} weight="fill" className="text-warning" />,
  info: <Info size={20} weight="fill" className="text-info" />,
};

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
}) {
  // El aviso se auto-descarta, pero NUNCA debajo de los ojos de quien lo lee:
  // el reloj se pausa con el mouse encima o con el foco dentro (teclado, lector
  // de pantalla) y retoma el tiempo que le quedaba al salir. Sin esto, un error
  // de 7s se le escapa a quien lee despacio — el motivo por el que los danger
  // eran persistentes.
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(item.duration);

  useEffect(() => {
    if (item.duration <= 0 || paused) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(item.id), remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      // Descontamos lo consumido; al reanudar arranca desde el resto.
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
    };
  }, [item.id, item.duration, paused, onDismiss]);

  return (
    <motion.div
      layout
      role={item.variant === "danger" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      // onFocus/onBlur en React son focusin/focusout: burbujean desde el botón cerrar.
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
      transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
      className={cn(
        "pointer-events-auto flex w-full items-start gap-3 rounded-md",
        "bg-surface-raised p-4 shadow-lg",
      )}
    >
      {VARIANT_ICON[item.variant] && (
        <span aria-hidden="true" className="mt-0.5 shrink-0">
          {VARIANT_ICON[item.variant]}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-sm text-foreground-secondary">
            {item.description}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label="Cerrar aviso"
        onClick={() => onDismiss(item.id)}
        className="touch-hitbox -m-1 shrink-0 rounded-full p-1 text-foreground-muted transition-colors duration-(--duration-fast) hover:text-foreground"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </motion.div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const mounted = useMounted();
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    const id = `toast-${++counter.current}`;
    const variant = options.variant ?? "default";
    setItems((current) => [
      ...current.slice(-2), // máximo 3 visibles
      {
        id,
        title: options.title,
        description: options.description,
        variant,
        duration:
          options.duration ??
          (variant === "danger" ? DANGER_DURATION_MS : DEFAULT_DURATION_MS),
      },
    ]);
    return id;
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted &&
        createPortal(
          // Sin aria-live en el contenedor: cada ToastCard gestiona su propio
          // anuncio por-item (role="alert" asertivo para danger, role="status"
          // cortés para el resto). Un aria-live="polite" acá degradaría los
          // avisos críticos anidados a cortés en NVDA/VoiceOver.
          <div
            className={cn(
              "pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-4",
              // por encima del bottom-nav (64px) + safe area
              "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]",
            )}
          >
            <AnimatePresence>
              {items.map((item) => (
                <div key={item.id} className="w-full max-w-sm">
                  <ToastCard item={item} onDismiss={dismiss} />
                </div>
              ))}
            </AnimatePresence>
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
