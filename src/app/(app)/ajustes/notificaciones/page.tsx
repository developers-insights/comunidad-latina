import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DeviceMobile } from "@phosphor-icons/react/dist/ssr";
import { Badge, Banner } from "@/components/ui";
import { CategoryIcon, PrefRow, PREFS_COPY } from "@/components/notifications";
import {
  ALWAYS_ON_CATEGORIES,
  CATEGORY_META,
  NOTIFICATION_CATEGORIES,
  isAlwaysOnCategory,
} from "@/lib/notifications/categories";
import { prefsFromRows, resolvePref, type NotificationPrefRow } from "@/lib/notifications/prefs";
import { createClient, getAuthUserId } from "@/lib/supabase/server";

export const metadata: Metadata = { title: PREFS_COPY.title };

/**
 * /ajustes/notificaciones — de qué te avisamos y por dónde.
 *
 * Dos secciones, no una lista con excepciones adentro:
 *
 * 1. Las diez categorías que se configuran.
 * 2. Seguridad, pagos y cuenta: **SIN INTERRUPTOR** y con la razón escrita. La
 *    spec lo pide así y tiene razón — un interruptor deshabilitado se lee como
 *    un bug ("¿por qué no anda?"), mientras que la ausencia con una explicación
 *    se lee como una decisión. La base opina lo mismo: el CHECK
 *    `notification_prefs_critical_always_on` (0045) rechaza guardarlas apagadas.
 *
 * La ausencia de fila significa TODO PRENDIDO: no se siembran trece filas por
 * persona al registrarse, y `resolvePref` devuelve el default cuando no hay.
 */
export default async function AjustesNotificacionesPage() {
  const userId = await getAuthUserId();
  if (!userId) redirect("/entrar?next=/ajustes/notificaciones");

  const supabase = await createClient();
  const { data } = await supabase
    .from("notification_prefs")
    .select("category, in_app, email, push, frequency");

  const prefs = prefsFromRows((data ?? []) as NotificationPrefRow[]);
  const configurable = NOTIFICATION_CATEGORIES.filter(
    (category) => !isAlwaysOnCategory(category),
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-foreground">
          {PREFS_COPY.title}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{PREFS_COPY.subtitle}</p>
      </header>

      {/* Push: degradación elegante (§7). Se dice UNA vez acá y no trece veces
          con un interruptor muerto en cada fila. */}
      <Banner variant="info" icon={<DeviceMobile size={18} />}>
        <span className="font-semibold">
          {PREFS_COPY.channels.push} · {PREFS_COPY.channels.pushSoon}
        </span>{" "}
        {PREFS_COPY.channels.pushHint}
      </Banner>

      <section>
        <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
          {PREFS_COPY.channels.legend}
        </h2>
        <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface">
          {configurable.map((category) => (
            <PrefRow key={category} category={category} pref={resolvePref(prefs, category)} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
          {PREFS_COPY.alwaysOn.badge}
        </h2>
        <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface">
          {ALWAYS_ON_CATEGORIES.map((category) => (
            <div key={category} className="flex items-start gap-3 px-3 py-4">
              <CategoryIcon category={category} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {CATEGORY_META[category].label}
                  </h3>
                  <Badge variant="success">{PREFS_COPY.alwaysOn.badge}</Badge>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-foreground-secondary">
                  {CATEGORY_META[category].description}
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 px-1 text-xs leading-relaxed text-foreground-muted">
          {PREFS_COPY.alwaysOn.reason}
        </p>
      </section>
    </div>
  );
}
