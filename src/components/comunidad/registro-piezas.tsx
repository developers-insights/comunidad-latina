"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle,
  Envelope,
  LockKey,
  Phone,
} from "@phosphor-icons/react/dist/ssr";
import { BezelCard, Bubble, Button, Field, Input, buttonVariants } from "@/components/ui";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { cn } from "@/lib/utils";
import { retirarRegistro } from "@/app/(app)/comunidad/registros/actions";

const C = COMUNIDAD_COPY.registros;

/**
 * =============================================================================
 * LAS PIEZAS COMPARTIDAS DE LOS CUATRO REGISTROS (0131)
 * =============================================================================
 *
 * Anotarse de voluntario, pedir voluntarios, registrar un lugar y ofrecer un
 * espacio son cuatro formularios distintos, pero cuatro veces la misma promesa:
 * «esto no se publica, lo ve el equipo y te llamamos». Estas piezas existen para
 * que esa promesa se vea IGUAL en los cuatro — si cada pantalla la escribiera a
 * su manera, en dos de ellas se leería como letra chica.
 *
 * Lo que NO se comparte son los campos propios de cada formulario: están en su
 * pantalla, donde se entienden.
 *
 * ── DE DÓNDE SALEN LAS DECISIONES DE ESTA PANTALLA ──────────────────────────
 * Investigación en Mobbin, citada donde corresponde:
 *  · `<PasosDelRegistro>` — «Steps to enroll» de Visible
 *    (mobbin.com/screens/2159d2bd-343b-46d2-9668-648ae3f5a453): antes de pedir
 *    un solo dato, tres líneas con ícono que cuentan qué va a pasar.
 *  · `<AceptarReglas>` — la pantalla de comunidad de Lex
 *    (mobbin.com/screens/64fda9f4-e87b-4d27-b2a9-006414b4759c): las reglas
 *    LISTADAS en la página y una sola casilla debajo.
 *  · `<CampoContacto>` — la nota bajo el campo en el registro de Meetup
 *    (mobbin.com/screens/d8087767-4565-4a00-900e-8e3f1a8821fc), que dice quién
 *    va a ver la respuesta ahí mismo y no en un aviso general.
 *
 * Lo que NO salió de Mobbin y es criterio propio: los chips de selección
 * múltiple (Mobbin da capturas estáticas, no interacción), el estado «ya
 * tenemos tus datos» con el botón para retirarlos, y el uso de los tokens y las
 * primitivas de este repo en todo lo anterior.
 */

// ---------------------------------------------------------------------------
// Qué va a pasar con esto
// ---------------------------------------------------------------------------

export function PasosDelRegistro({
  pasos,
  accent,
  className,
}: {
  pasos: readonly string[];
  accent: string;
  className?: string;
}) {
  return (
    <Bubble
      accent={accent}
      tone="accentSoft"
      shape="tile"
      size="none"
      className={cn("space-y-2.5 p-4", className)}
    >
      <ol className="space-y-2.5">
        {pasos.map((paso, indice) => (
          <li key={paso} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--bubble-ink)] text-[11px] font-bold tabular-nums text-surface"
            >
              {indice + 1}
            </span>
            <p className="text-sm leading-relaxed text-foreground-secondary">{paso}</p>
          </li>
        ))}
      </ol>
    </Bubble>
  );
}

// ---------------------------------------------------------------------------
// Chips de selección múltiple
// ---------------------------------------------------------------------------

/**
 * Un grupo de opciones donde se puede marcar varias.
 *
 * Es un `<fieldset>` con checkboxes de verdad —visualmente ocultos, no
 * `display:none`— y no una lista de `<button>`: un lector de pantalla tiene que
 * poder decir «casilla, Repartir comida, marcada», y el teclado tiene que poder
 * recorrerlas con Tab. El chip es la etiqueta.
 */
export function ChipsDeOpciones<T extends string>({
  legend,
  help,
  error,
  opciones,
  etiquetas,
  seleccion,
  onToggle,
  accent,
  name,
}: {
  legend: string;
  help?: string;
  error?: string;
  opciones: readonly T[];
  etiquetas: Readonly<Record<T, string>>;
  seleccion: readonly T[];
  onToggle: (valor: T) => void;
  accent: string;
  name: string;
}) {
  const errorId = `${name}-error`;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      {help && !error && <p className="text-sm text-foreground-muted">{help}</p>}

      <div className="flex flex-wrap gap-2" style={{ "--chip-accent": accent } as React.CSSProperties}>
        {opciones.map((opcion) => {
          const marcado = seleccion.includes(opcion);
          return (
            <label
              key={opcion}
              className={cn(
                "inline-flex min-h-11 cursor-pointer select-none items-center rounded-full border px-3.5 text-sm font-medium",
                "transition-[background-color,border-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
                "active:scale-[0.97]",
                "has-[:focus-visible]:outline-none has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-focus-ring",
                marcado
                  ? "border-[color-mix(in_oklab,var(--chip-accent)_55%,transparent)] bg-[color-mix(in_oklab,var(--chip-accent)_16%,var(--color-surface))] text-foreground"
                  : "border-border-subtle bg-surface text-foreground-secondary hover:border-border hover:text-foreground",
              )}
            >
              <input
                type="checkbox"
                name={name}
                value={opcion}
                checked={marcado}
                onChange={() => onToggle(opcion)}
                className="sr-only"
                aria-describedby={error ? errorId : undefined}
              />
              {etiquetas[opcion]}
            </label>
          );
        })}
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Contacto
// ---------------------------------------------------------------------------

/**
 * Teléfono y correo, con la promesa AL LADO del campo.
 *
 * La frase «esto no se publica» aparece acá y no sólo en la cabecera de la
 * pantalla porque es acá donde alguien duda: el segundo justo antes de escribir
 * su número es el segundo en el que se necesita leerla.
 *
 * En «Registrar mi lugar» la promesa es la contraria —ese teléfono SÍ se publica
 * si el equipo aprueba la ficha— y por eso el texto es un parámetro: mentir
 * ahí sería peor que no decir nada.
 */
export function CampoContacto({
  titulo = C.campos.contactoTitulo,
  ayuda = C.campos.contactoAyuda,
  nota = C.noSePublica,
  telefono,
  email,
  onTelefono,
  onEmail,
  error,
}: {
  titulo?: string;
  ayuda?: string;
  nota?: string;
  telefono: string;
  email: string;
  onTelefono: (valor: string) => void;
  onEmail: (valor: string) => void;
  error?: string;
}) {
  return (
    <section className="rounded-lg border border-border-subtle bg-surface-subtle p-4">
      <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
      <p className="mt-0.5 text-sm text-foreground-muted">{ayuda}</p>

      <div className="mt-3 flex flex-col gap-3">
        <Field htmlFor="registro-telefono" label={C.campos.telefonoLabel}>
          <Input
            id="registro-telefono"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={telefono}
            onChange={(event) => onTelefono(event.target.value)}
            placeholder={C.campos.telefonoPlaceholder}
            maxLength={40}
            aria-invalid={error ? true : undefined}
          />
        </Field>

        <Field htmlFor="registro-email" label={C.campos.emailLabel} optional>
          <Input
            id="registro-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => onEmail(event.target.value)}
            placeholder={C.campos.emailPlaceholder}
            maxLength={160}
            aria-invalid={error ? true : undefined}
          />
        </Field>
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-foreground-muted">
        <LockKey size={14} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" />
        {nota}
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Las reglas del voluntario
// ---------------------------------------------------------------------------

export function AceptarReglas({
  titulo,
  reglas,
  label,
  checked,
  onChange,
  error,
  accent,
}: {
  titulo: string;
  reglas: readonly string[];
  label: string;
  checked: boolean;
  onChange: (valor: boolean) => void;
  error?: string;
  accent: string;
}) {
  return (
    <Bubble accent={accent} tone="accentSoft" shape="tile" size="none" className="p-4">
      <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4">
        {reglas.map((regla) => (
          <li key={regla} className="text-sm leading-relaxed text-foreground-secondary">
            {regla}
          </li>
        ))}
      </ul>

      <label
        htmlFor="registro-reglas"
        className="mt-3 flex cursor-pointer items-start gap-3 border-t border-[color-mix(in_oklab,var(--bubble-ink)_18%,transparent)] pt-3 text-sm font-medium text-foreground"
      >
        <input
          id="registro-reglas"
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "registro-reglas-error" : undefined}
        />
        <span>{label}</span>
      </label>

      {error && (
        <p id="registro-reglas-error" role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      )}
    </Bubble>
  );
}

// ---------------------------------------------------------------------------
// Después de mandar
// ---------------------------------------------------------------------------

export function RegistroHecho({
  title,
  body,
  volverHref = "/comunidad",
  volverLabel = "Volver a Comunidad",
}: {
  title: string;
  body: string;
  volverHref?: string;
  volverLabel?: string;
}) {
  return (
    <BezelCard coreClassName="p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <CheckCircle size={40} weight="fill" aria-hidden="true" className="text-success" />
        <h2 className="font-display text-xl font-bold tracking-tight text-foreground">{title}</h2>
        <p className="text-sm leading-relaxed text-foreground-secondary">{body}</p>
        <Link
          href={volverHref}
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "mt-2 w-full")}
        >
          {volverLabel}
        </Link>
      </div>
    </BezelCard>
  );
}

/**
 * «Ya tenemos tus datos» — lo que ve quien vuelve a abrir el formulario con un
 * registro abierto.
 *
 * Con el botón para retirarlos, que es el único camino que tiene la persona para
 * corregir algo: un registro no se edita (lo congela el trigger de la 0131), así
 * que retirarlo y volver a mandarlo ES la edición. Y de paso es lo que hace que
 * el cupo de uno abierto no se sienta una trampa.
 */
export function RegistroAbierto({
  registroId,
  body,
  contactoMostrado,
}: {
  registroId: string;
  body: string;
  /** Teléfono o correo con el que quedó anotado, para que se pueda verificar. */
  contactoMostrado?: string | null;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [retirado, setRetirado] = useState(false);

  if (retirado) {
    return (
      <BezelCard coreClassName="p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <CheckCircle size={40} weight="fill" aria-hidden="true" className="text-success" />
          <p className="text-sm leading-relaxed text-foreground-secondary">{C.abierto.retirado}</p>
          <Button variant="outline" size="md" onClick={() => router.refresh()} className="mt-1 w-full">
            Volver a anotarme
          </Button>
        </div>
      </BezelCard>
    );
  }

  function retirar() {
    setError(null);
    startTransition(async () => {
      const resultado = await retirarRegistro({ registroId });
      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }
      setRetirado(true);
      router.refresh();
    });
  }

  return (
    <BezelCard coreClassName="p-6">
      <div className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-foreground">
          <CheckCircle size={22} weight="fill" aria-hidden="true" className="text-success" />
          {C.abierto.title}
        </h2>
        <p className="text-sm leading-relaxed text-foreground-secondary">{body}</p>

        {contactoMostrado && (
          <p className="flex items-center gap-1.5 text-sm text-foreground-muted">
            {contactoMostrado.includes("@") ? (
              <Envelope size={16} weight="fill" aria-hidden="true" />
            ) : (
              <Phone size={16} weight="fill" aria-hidden="true" />
            )}
            {contactoMostrado}
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-md bg-danger-bg px-3 py-2.5 text-sm text-danger-ink">
            {error}
          </p>
        )}

        <div className="mt-1 flex flex-col gap-2">
          <Link
            href="/comunidad"
            className={cn(buttonVariants({ variant: "primary", size: "md" }), "w-full")}
          >
            Volver a Comunidad
          </Link>
          <Button
            variant="ghost"
            size="md"
            onClick={retirar}
            disabled={pendiente}
            aria-busy={pendiente}
            loading={pendiente}
            className="w-full text-danger"
          >
            {pendiente ? C.abierto.retirando : C.abierto.retirar}
          </Button>
        </div>
      </div>
    </BezelCard>
  );
}

/** El error de envío, siempre en el mismo lugar: arriba del botón. */
export function ErrorDelRegistro({ mensaje }: { mensaje: string }) {
  return (
    <p
      role="alert"
      className="rounded-md bg-danger-bg px-3 py-2.5 text-sm leading-relaxed text-danger-ink"
    >
      {mensaje}
    </p>
  );
}
