import { Prohibit, Timer } from "@phosphor-icons/react/dist/ssr";
import { signOutAction } from "@/app/(app)/perfil/actions";
import { Button } from "@/components/ui";

/**
 * Pantalla completa para cuentas sancionadas (0021_account_sanctions.sql).
 * Reemplaza TODO el shell de la app: una cuenta suspendida o dada de baja no
 * navega, no publica y no escribe — la DB ya lo bloquea con triggers
 * (app.enforce_account_active); esto es la cara humana de ese bloqueo.
 */

const COPY = {
  suspended: {
    title: "Tu cuenta está suspendida",
    bodyUntil: (until: string) =>
      `Por no cumplir las normas de la comunidad, tu cuenta queda en pausa hasta el ${until}. Después de esa fecha vas a poder volver a entrar como siempre.`,
    bodyNoDate:
      "Por no cumplir las normas de la comunidad, tu cuenta está en pausa por ahora.",
    hint: "Si creés que es un error, escribile al equipo de tu comunidad.",
  },
  banned: {
    title: "Tu cuenta fue dada de baja",
    body: "Esta cuenta rompió las normas de la comunidad de forma repetida y ya no puede usarse.",
    hint: "Si creés que es un error, escribile al equipo de tu comunidad.",
  },
  signOut: "Cerrar sesión",
} as const;

export interface AccountGateProps {
  kind: "suspended" | "banned";
  /** ISO timestamptz de profiles.suspended_until (solo para suspended). */
  suspendedUntil?: string | null;
}

export function AccountGate({ kind, suspendedUntil }: AccountGateProps) {
  const copy = COPY[kind];
  const until =
    kind === "suspended" && suspendedUntil
      ? new Date(suspendedUntil).toLocaleDateString("es", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : null;
  const body =
    kind === "banned"
      ? COPY.banned.body
      : until
        ? COPY.suspended.bodyUntil(until)
        : COPY.suspended.bodyNoDate;
  const Icon = kind === "banned" ? Prohibit : Timer;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-danger-bg">
        <Icon size={32} aria-hidden="true" className="text-danger" />
      </div>
      <h1 className="mt-5 font-display text-xl font-bold text-foreground">
        {copy.title}
      </h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-foreground-secondary">
        {body}
      </p>
      <p className="mt-4 max-w-sm text-xs text-foreground-muted">{copy.hint}</p>
      <form action={signOutAction} className="mt-8">
        <Button type="submit" variant="secondary">
          {COPY.signOut}
        </Button>
      </form>
    </main>
  );
}
