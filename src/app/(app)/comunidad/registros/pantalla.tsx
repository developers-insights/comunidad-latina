import type { ReactNode } from "react";
import Link from "next/link";
import { SignIn } from "@phosphor-icons/react/dist/ssr";
import { EmptyState, buttonVariants } from "@/components/ui";
import { RegistroAbierto } from "@/components/comunidad";
import { COMUNIDAD_COPY, type RegistrationKind } from "@/lib/comunidad";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/resolve";
import { fetchRegistroAbierto } from "./queries";

const C = COMUNIDAD_COPY.registros;

/**
 * =============================================================================
 * EL MARCO DE LOS CUATRO FORMULARIOS DE REGISTRO (0131)
 * =============================================================================
 *
 * Los cuatro tienen que resolver antes de dibujarse las mismas dos preguntas, y
 * las dos veces contestan igual:
 *
 *   1. ¿Hay sesión? Sin cuenta no se puede: la RLS lo rechazaría igual, y es
 *      mejor decirlo antes de que alguien escriba todo que después de que toque
 *      el botón. Además, pedir cuenta es lo que evita que alguien deje los datos
 *      de OTRA persona — que en una tabla de teléfonos importa más que en un
 *      tablón de texto.
 *   2. ¿Ya se registró en este formulario? Entonces no hay formulario: hay un
 *      «ya tenemos tus datos» con el botón para retirarlos. El cupo lo hacen
 *      cumplir el índice único y el trigger de la 0131; esto sólo evita que la
 *      persona escriba todo de nuevo para que el servidor le diga que no.
 *
 * Escribirlo cuatro veces habría garantizado que en alguna de las cuatro
 * pantallas falte el chequeo — que es la clase de olvido que se nota el día que
 * alguien manda cien registros o que la app deja pasar un formulario sin sesión.
 */
export async function PantallaDeRegistro({
  kind,
  ruta,
  title,
  subtitle,
  abiertoBody,
  aviso,
  children,
}: {
  kind: RegistrationKind;
  /** La propia URL, para volver acá después de entrar. */
  ruta: string;
  title: string;
  subtitle: string;
  /** Qué decirle a quien ya se registró en ESTE formulario. */
  abiertoBody: string;
  /** Aviso propio de la pantalla, arriba del formulario (opcional). */
  aviso?: ReactNode;
  children: ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const cabecera = (
    <header className="mb-5">
      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{title}</h1>
      <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">{subtitle}</p>
    </header>
  );

  if (!user) {
    return (
      <>
        {cabecera}
        <EmptyState
          icon={<SignIn />}
          title={C.needLogin}
          message={C.needLoginHint}
          action={
            <Link
              href={`/entrar?next=${encodeURIComponent(ruta)}`}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              {C.needLogin}
            </Link>
          }
          className="py-16"
        />
      </>
    );
  }

  const tenant = await getTenant();
  const abierto = await fetchRegistroAbierto({ tenantId: tenant.id, viewerId: user.id, kind });

  if (abierto) {
    return (
      <>
        {cabecera}
        <RegistroAbierto
          registroId={abierto.id}
          body={abiertoBody}
          contactoMostrado={abierto.contacto}
        />
      </>
    );
  }

  return (
    <>
      {cabecera}
      {aviso}
      {children}
    </>
  );
}
