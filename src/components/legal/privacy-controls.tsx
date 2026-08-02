"use client";

import { useCallback, useEffect, useState } from "react";
import { Broom, ClockCounterClockwise, SlidersHorizontal } from "@phosphor-icons/react/dist/ssr";
import { Button, Dialog, useToast } from "@/components/ui";
import {
  categoriesNeedingConsent,
  clearCachedMedia,
  clearLocalData,
  listLocalData,
  subscribe,
  useConsent,
  type LocalEntry,
} from "@/lib/consent";
import { ConsentPreferences } from "./consent-preferences";
import { CONSENT_COPY as COPY } from "./consent-copy";

/**
 * Controles de privacidad de Ajustes › Privacidad.
 *
 * Es la vía de REVOCACIÓN permanente que exige el RGPD: retirar el
 * consentimiento tiene que ser tan accesible como darlo, y no puede depender de
 * que vuelva a aparecer un banner. Vive en una ruta fija, siempre alcanzable.
 *
 * Muestra lo que hay DE VERDAD en este navegador —leído en vivo, no una lista
 * escrita a mano— porque el objetivo es que la persona pueda comprobar lo que
 * decimos en vez de creernos.
 */
export function PrivacyControls() {
  const { record, revoke } = useConsent();
  const { toast } = useToast();
  const [showPreferences, setShowPreferences] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const entries = useLocalData();
  const pending = categoriesNeedingConsent();

  const doClear = useCallback(async () => {
    const removed = clearLocalData();
    await clearCachedMedia();
    setConfirmClear(false);
    // El toast confirma Y aclara qué NO se tocó: el miedo real de alguien que
    // toca "borrar" en una app donde tiene su vivienda y su trabajo es perder
    // la cuenta.
    toast({
      title: removed > 0 ? COPY.settings.localData.cleared : COPY.settings.localData.empty,
      variant: "success",
    });
  }, [toast]);

  return (
    <div className="flex flex-col gap-6">
      {/* Cuando no hay nada que consentir se DICE, en vez de mostrar una
          pantalla de interruptores vacíos que sugiere que sí lo hay. */}
      {pending.length === 0 && (
        <section className="rounded-xl border border-border-subtle bg-surface p-4">
          <h2 className="font-display text-base font-bold text-foreground">
            {COPY.settings.nothingToConsent.title}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">
            {COPY.settings.nothingToConsent.body}
          </p>
        </section>
      )}

      <section className="rounded-xl border border-border-subtle bg-surface p-4">
        <h2 className="font-display text-base font-bold text-foreground">
          {COPY.settings.decision.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">
          {record
            ? COPY.settings.decision.savedOn(formatDate(record.decidedAt))
            : COPY.settings.decision.never}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowPreferences(true)}>
            <SlidersHorizontal size={16} aria-hidden="true" />
            {COPY.settings.decision.change}
          </Button>
          {record && (
            <Button
              variant="ghost"
              onClick={() => {
                revoke();
                toast({ title: COPY.settings.decision.revoked });
              }}
            >
              <ClockCounterClockwise size={16} aria-hidden="true" />
              {COPY.settings.decision.revoke}
            </Button>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border-subtle bg-surface p-4">
        <h2 className="font-display text-base font-bold text-foreground">
          {COPY.settings.localData.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground-secondary">
          {COPY.settings.localData.body}
        </p>

        {entries.length === 0 ? (
          <p className="mt-3 text-sm text-foreground-muted">
            {COPY.settings.localData.empty}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5">
            {entries.map((entry) => (
              <li
                key={`${entry.store}:${entry.key}`}
                className="flex items-baseline justify-between gap-3 rounded-md bg-surface-subtle px-3 py-2"
              >
                <span className="min-w-0 break-all font-mono text-xs text-foreground-secondary">
                  {entry.key}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-foreground-muted">
                  {formatSize(entry.size)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {entries.length > 0 && (
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setConfirmClear(true)}
          >
            <Broom size={16} aria-hidden="true" />
            {COPY.settings.localData.clear}
          </Button>
        )}
      </section>

      <ConsentPreferences
        open={showPreferences}
        onClose={() => setShowPreferences(false)}
      />

      <Dialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={COPY.settings.localData.confirmTitle}
        description={COPY.settings.localData.confirmBody}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              {COPY.settings.localData.confirmCancel}
            </Button>
            <Button variant="primary" onClick={doClear}>
              {COPY.settings.localData.confirmCta}
            </Button>
          </>
        }
      />
    </div>
  );
}

/**
 * Lee lo que hay AHORA en el storage de este navegador.
 *
 * POR QUÉ NO ES `useSyncExternalStore`
 * ------------------------------------
 * Lo era, y estaba roto: al entrar, la pantalla decía "no hay nada guardado"
 * aunque hubiera cinco claves. Con `getServerSnapshot` devolviendo una lista
 * vacía —que es lo correcto, el servidor no puede saber qué hay en tu
 * teléfono— React se quedaba con el valor de la hidratación y no volvía a leer
 * hasta que algo notificara al store. O sea que la lista aparecía recién
 * después de tocar un botón. Verificado en el navegador: la lista salía vacía y
 * con un evento `storage` disparado a mano aparecían las cinco claves.
 *
 * Acá el dato es client-only por naturaleza y no tiene equivalente en el
 * servidor, así que se lee en un efecto de montaje —que corre siempre, después
 * de hidratar— y se mantiene al día con la misma suscripción de siempre. Menos
 * elegante, pero determinista.
 */
function useLocalData(): LocalEntry[] {
  const [entries, setEntries] = useState<LocalEntry[]>([]);

  useEffect(() => {
    const read = () => setEntries(listLocalData());
    read();
    return subscribe(read);
  }, []);

  return entries;
}

/** Fecha en el formato que usa el resto de la app (es-US, zona de Nueva York). */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}
