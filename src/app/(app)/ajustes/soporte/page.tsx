import Link from "next/link";
import {
  CaretRight,
  CheckCircle,
  LockKey,
} from "@phosphor-icons/react/dist/ssr";
import { getShellContext } from "@/components/shell/shell-context";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import type { SupportContext } from "@/lib/support/contact";
import { cn } from "@/lib/utils";
import { SupportComposer } from "./support-composer";
import { SOPORTE_COPY as COPY } from "./copy";

export const metadata = { title: COPY.title };

/**
 * Ajustes › Soporte.
 *
 * Vive justo debajo de los legales, en "Ayuda y comunidad": quien baja hasta
 * las normas y la política de privacidad ya está buscando a un humano.
 *
 * ── ANÓNIMO TAMBIÉN ENTRA ────────────────────────────────────────────────────
 * Y no es un detalle: la persona que NO puede entrar a su cuenta es justamente
 * la que más necesita escribir a soporte. Mandarla a /entrar sería cerrarle la
 * única puerta que le queda. Sin sesión simplemente no se agregan los datos de
 * cuenta al pie del correo — no hay nada que agregar.
 *
 * ── EL CONTEXTO SE ARMA EN EL SERVIDOR ───────────────────────────────────────
 * El correo de la cuenta sale de `auth.getUser()`, no de `profiles` (la app
 * nunca guarda el correo en la tabla pública — minimización de PII). Viaja al
 * cliente sólo para escribirlo en el borrador que la persona va a mandar desde
 * su propia casilla: es su dato, en su correo, a la vista y borrable.
 */
export default async function SoportePage() {
  const [shell, supabase, tenant] = await Promise.all([
    getShellContext(),
    createClient(),
    getTenant(),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const context: SupportContext = {
    displayName: shell.user?.displayName ?? null,
    accountEmail: user?.email ?? null,
    accountId: user?.id ?? null,
    // `isFallback` = la fila del tenant no vino de la base (§7). Poner el
    // nombre placeholder en el correo mandaría a soporte a buscar una
    // comunidad que no existe: mejor no decir nada que decir algo falso.
    community: tenant.isFallback ? null : tenant.name,
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {COPY.title}
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">{COPY.subtitle}</p>
      </header>

      <SupportComposer context={context} />

      {/* Qué pasa después: la ansiedad de quien escribe a soporte no es si el
          correo salió, es si alguien lo va a leer. Se contesta antes de que la
          pregunta aparezca. */}
      <section className="rounded-xl border border-border-subtle bg-surface p-5">
        <h2 className="font-display text-base font-bold text-foreground">
          {COPY.expectations.title}
        </h2>
        <ul className="mt-3 flex flex-col gap-2.5">
          {COPY.expectations.items.map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <CheckCircle
                size={18}
                weight="fill"
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-success"
              />
              <span className="text-sm leading-relaxed text-foreground-secondary">
                {item}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Atajos al final y no arriba: primero se le da la puerta a la persona,
          después se le sugiere que quizás no le hace falta cruzarla. Al revés
          se lee como "resolvelo solo". */}
      <section>
        <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
          {COPY.shortcuts.title}
        </h2>
        <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface">
          {COPY.shortcuts.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-h-14 items-center gap-3 px-4",
                "transition-colors duration-(--duration-fast) hover:bg-surface-hover",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus-ring",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">
                  {item.title}
                </span>
                <span className="block text-xs text-foreground-secondary">
                  {item.description}
                </span>
              </span>
              <CaretRight
                size={14}
                aria-hidden="true"
                className="shrink-0 text-foreground-muted"
              />
            </Link>
          ))}
        </div>
      </section>

      <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-foreground-muted">
        <LockKey size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
        {COPY.privacy}
      </p>
    </div>
  );
}
