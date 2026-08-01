import Link from "next/link";
import { EnvelopeSimple } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";

const COPY = {
  title: "Revisá tu correo",
  messageWithEmail: (email: string) =>
    `Le mandamos un mensaje a ${email}. Abrilo y tocá el botón para activar tu cuenta — con eso ya quedás adentro, sin escribir la contraseña de nuevo.`,
  message:
    "Te mandamos un mensaje. Abrilo y tocá el botón para activar tu cuenta — con eso ya quedás adentro, sin escribir la contraseña de nuevo.",
  patience: "Puede tardar un par de minutos. Si no lo ves, fijate en el correo no deseado.",
  resendPrompt: "¿No te llegó?",
  resendLink: "Entrá con tu email y contraseña y te lo mandamos de nuevo",
} as const;

/**
 * Pantalla de "cuenta creada, falta confirmar" (§ registro).
 *
 * La cuenta ya existe cuando esto se muestra, pero NO hay sesión: hasta que la
 * persona toque el enlace del correo, Supabase rechaza el ingreso. Por eso el
 * único camino que ofrecemos acá es /entrar, que al detectar una cuenta sin
 * confirmar reenvía el enlace solo — nunca un botón que reintente el registro,
 * que chocaría contra "ese email ya está en uso".
 */
export function CheckEmail({ email }: { email?: string }) {
  return (
    <div className="flex flex-col gap-4">
      <EmptyState
        icon={<EnvelopeSimple weight="duotone" aria-hidden="true" />}
        title={COPY.title}
        message={email ? COPY.messageWithEmail(email) : COPY.message}
        className="py-8"
      />
      <p className="text-center text-sm text-foreground-secondary">
        {COPY.patience}
      </p>
      <p className="text-center text-sm text-foreground-secondary">
        {COPY.resendPrompt}{" "}
        <Link
          href="/entrar"
          className="rounded-sm font-semibold text-brand-ink underline-offset-4 hover:underline"
        >
          {COPY.resendLink}
        </Link>
        .
      </p>
    </div>
  );
}
