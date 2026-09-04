"use client";

import { useActionState, useId, useState } from "react";
import Link from "next/link";
import {
  Clock,
  FloppyDisk,
  Plus,
  SealCheck,
  X,
} from "@phosphor-icons/react/dist/ssr";
import {
  Banner,
  BezelCard,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  buttonVariants,
} from "@/components/ui";
import { BUSINESS_CATEGORIES } from "@/app/(app)/negocios/categories";
import {
  MAX_LARGO_DESCRIPCION,
  MAX_LARGO_SERVICIO,
  MAX_LARGO_TITULO,
  MAX_SERVICIOS,
  normalizarServicios,
} from "@/lib/negocios/pagina";
import { guardarPaginaDeNegocioAction } from "@/app/(app)/negocios/[id]/editar/actions";
import {
  EDITAR_PAGINA_INICIAL,
  type EditarPaginaState,
} from "@/app/(app)/negocios/[id]/editar/estado";
import { EDITAR_NEGOCIO_COPY as C } from "@/app/(app)/negocios/[id]/editar/copy";
import { FotoDeNegocioField } from "./foto-de-negocio-field";

/**
 * =============================================================================
 * EDITAR LA PÁGINA DEL NEGOCIO
 * =============================================================================
 *
 * Call del 3/9 (59:00–1:00:30): usando la app como su empresa, al cliente le
 * faltaba «editar la información del negocio, agregar la foto y los servicios
 * que da». Las tres cosas viven acá, en ese orden, porque ése es el orden en
 * que se completan: primero la cara, después quién sos, después qué hacés.
 *
 * ── LO QUE NO SE DUPLICA ────────────────────────────────────────────────────
 * Los HORARIOS ya tienen su editor (`/negocios/[id]/horario`, 0093) con siete
 * días, tramos y zona horaria. Meter una segunda versión acá sería tener dos
 * pantallas que guardan lo mismo y se van a desincronizar. Se enlaza el que ya
 * existe, con su propia fila y su explicación.
 *
 * ── LOS BOTONES DE CONTACTO NO SE OFRECEN EN VANO ───────────────────────────
 * En tier `free` el CHECK `listings_cta_premium_only` (0048) prohíbe GUARDARLOS:
 * en free el único contacto es el chat de Comunidad Latina. Un formulario que
 * sólo puede terminar en error no es una función, es una trampa — el mismo
 * criterio que ya aplica /negocios/cuenta cuando no quedan lugares. Así que en
 * free no se muestran los campos: se dice qué son y dónde se consiguen.
 *
 * ── LOS SERVICIOS SE ARMAN ACÁ Y VIAJAN COMO JSON ───────────────────────────
 * Agregar y quitar sin recargar ya necesita JavaScript, así que serializar la
 * lista en un campo oculto es honesto con eso (mismo criterio que el editor de
 * horarios). Del otro lado hay un zod, después `normalizarServicios` y al final
 * el CHECK de la base: el JSON es transporte, no confianza.
 */

export interface EditarPaginaFormProps {
  listingId: string;
  inicial: {
    title: string;
    description: string;
    category: string;
    areaLabel: string;
    phone: string;
    whatsapp: string;
    website: string;
    address: string;
    servicios: string[];
    logoUrl: string | null;
    coverUrl: string | null;
  };
  /** `tier === "premium"`: sin esto, los botones de contacto no se pueden guardar. */
  esPremium: boolean;
}

export function EditarPaginaForm({ listingId, inicial, esPremium }: EditarPaginaFormProps) {
  const ids = {
    title: useId(),
    description: useId(),
    category: useId(),
    area: useId(),
    servicio: useId(),
    phone: useId(),
    whatsapp: useId(),
    website: useId(),
    address: useId(),
  };

  const [state, formAction, pending] = useActionState(
    guardarPaginaDeNegocioAction,
    EDITAR_PAGINA_INICIAL,
  );
  const [nombre, setNombre] = useState(inicial.title);
  const [servicios, setServicios] = useState<string[]>(inicial.servicios);
  const [borrador, setBorrador] = useState("");
  const [avisoServicio, setAvisoServicio] = useState<string | null>(null);

  const lleno = servicios.length >= MAX_SERVICIOS;

  function agregarServicio() {
    const [limpio] = normalizarServicios([borrador]);
    if (!limpio) return;
    if (limpio.length > MAX_LARGO_SERVICIO) {
      setAvisoServicio(C.servicios.muyLargo(MAX_LARGO_SERVICIO));
      return;
    }
    if (lleno) {
      setAvisoServicio(C.servicios.lleno(MAX_SERVICIOS));
      return;
    }
    const siguiente = normalizarServicios([...servicios, limpio]);
    if (siguiente.length === servicios.length) {
      setAvisoServicio(C.servicios.repetido);
      return;
    }
    setServicios(siguiente);
    setBorrador("");
    setAvisoServicio(null);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Las FOTOS van fuera del <form>: se guardan solas al elegirlas (ver el
          docblock de FotoDeNegocioField). Dejarlas adentro haría creer que
          esperan al botón de abajo. */}
      <BezelCard coreClassName="flex flex-col gap-5 p-4">
        <SeccionTitulo>{C.fotos.heading}</SeccionTitulo>
        <FotoDeNegocioField
          listingId={listingId}
          tipo="logo"
          nombre={nombre || inicial.title}
          urlInicial={inicial.logoUrl}
        />
        <FotoDeNegocioField
          listingId={listingId}
          tipo="portada"
          nombre={nombre || inicial.title}
          urlInicial={inicial.coverUrl}
        />
      </BezelCard>

      <form action={formAction} className="flex flex-col gap-5">
        <input type="hidden" name="listingId" value={listingId} />
        <input type="hidden" name="services" value={JSON.stringify(servicios)} />

        <BezelCard coreClassName="flex flex-col gap-4 p-4">
          <SeccionTitulo>{C.datos.heading}</SeccionTitulo>

          <Field
            htmlFor={ids.title}
            label={C.datos.nombreLabel}
            help={C.datos.nombreHelp}
            error={errorDe(state, "title")}
          >
            <Input
              id={ids.title}
              name="title"
              value={nombre}
              onChange={(evento) => setNombre(evento.target.value)}
              maxLength={MAX_LARGO_TITULO}
              required
              aria-invalid={errorDe(state, "title") ? true : undefined}
            />
          </Field>

          <Field
            htmlFor={ids.description}
            label={C.datos.descripcionLabel}
            help={C.datos.descripcionHelp}
            error={errorDe(state, "description")}
            optional
          >
            <Textarea
              id={ids.description}
              name="description"
              rows={5}
              maxLength={MAX_LARGO_DESCRIPCION}
              defaultValue={inicial.description}
              placeholder={C.datos.descripcionPlaceholder}
            />
          </Field>

          <Field
            htmlFor={ids.category}
            label={C.datos.rubroLabel}
            help={C.datos.rubroHelp}
            optional
          >
            <Select id={ids.category} name="category" defaultValue={inicial.category}>
              <option value="">{C.datos.rubroVacio}</option>
              {BUSINESS_CATEGORIES.map((opcion) => (
                <option key={opcion.value} value={opcion.value}>
                  {opcion.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            htmlFor={ids.area}
            label={C.datos.zonaLabel}
            help={C.datos.zonaHelp}
            error={errorDe(state, "areaLabel")}
            optional
          >
            <Input
              id={ids.area}
              name="areaLabel"
              defaultValue={inicial.areaLabel}
              placeholder={C.datos.zonaPlaceholder}
              maxLength={80}
            />
          </Field>
        </BezelCard>

        {/* SERVICIOS */}
        <BezelCard coreClassName="flex flex-col gap-3 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <SeccionTitulo>{C.servicios.heading}</SeccionTitulo>
            <span className="text-xs text-foreground-muted">
              {C.servicios.contador(servicios.length, MAX_SERVICIOS)}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-foreground-secondary">
            {C.servicios.intro}
          </p>

          {servicios.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {servicios.map((servicio) => (
                <li key={servicio}>
                  {/* Chip con su propia X: no es un `Chip` del sistema porque
                      éste tiene un control adentro, y un chip clickeable entero
                      borraría de un toque accidental. */}
                  <span className="flex items-center gap-1 rounded-full border border-border-subtle bg-surface-subtle py-1 pl-3 pr-1 text-sm text-foreground">
                    <span className="max-w-[18ch] truncate">{servicio}</span>
                    <button
                      type="button"
                      aria-label={C.servicios.quitarAria(servicio)}
                      onClick={() => {
                        setServicios((previos) =>
                          previos.filter((item) => item !== servicio),
                        );
                        setAvisoServicio(null);
                      }}
                      className="flex size-6 items-center justify-center rounded-full text-foreground-muted transition-colors duration-(--duration-fast) hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring"
                    >
                      <X size={12} weight="bold" aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-foreground-muted">{C.servicios.vacio}</p>
          )}

          <Field
            htmlFor={ids.servicio}
            label={C.servicios.inputLabel}
            error={avisoServicio ?? errorDe(state, "services")}
          >
            <div className="flex gap-2">
              <Input
                id={ids.servicio}
                value={borrador}
                onChange={(evento) => {
                  setBorrador(evento.target.value);
                  setAvisoServicio(null);
                }}
                onKeyDown={(evento) => {
                  // Enter agrega el servicio, NUNCA manda el formulario: en una
                  // lista se escribe ítem tras ítem y un submit acá sería el
                  // final sorpresa de la carga.
                  if (evento.key !== "Enter") return;
                  evento.preventDefault();
                  agregarServicio();
                }}
                maxLength={MAX_LARGO_SERVICIO}
                placeholder={C.servicios.inputPlaceholder}
                disabled={lleno}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={agregarServicio}
                disabled={lleno || borrador.trim().length === 0}
              >
                <Plus size={16} weight="bold" aria-hidden="true" />
                {C.servicios.agregar}
              </Button>
            </div>
          </Field>
        </BezelCard>

        {/* CONTACTO — sólo si el plan lo permite guardar (ver el docblock). */}
        <BezelCard coreClassName="flex flex-col gap-4 p-4">
          <SeccionTitulo>{C.contacto.heading}</SeccionTitulo>

          {esPremium ? (
            <>
              <Field htmlFor={ids.phone} label={C.contacto.telefonoLabel} optional>
                <Input
                  id={ids.phone}
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  defaultValue={inicial.phone}
                  maxLength={120}
                />
              </Field>
              <Field htmlFor={ids.whatsapp} label={C.contacto.whatsappLabel} optional>
                <Input
                  id={ids.whatsapp}
                  name="whatsapp"
                  type="tel"
                  inputMode="tel"
                  defaultValue={inicial.whatsapp}
                  maxLength={120}
                />
              </Field>
              <Field htmlFor={ids.website} label={C.contacto.webLabel} optional>
                <Input
                  id={ids.website}
                  name="website"
                  type="url"
                  inputMode="url"
                  defaultValue={inicial.website}
                  maxLength={120}
                />
              </Field>
              <Field
                htmlFor={ids.address}
                label={C.contacto.direccionLabel}
                help={C.contacto.direccionHelp}
                optional
              >
                <Input
                  id={ids.address}
                  name="address"
                  defaultValue={inicial.address}
                  maxLength={120}
                />
              </Field>
            </>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm leading-relaxed text-foreground-secondary">
                {C.contacto.soloPremium}
              </p>
              <Link
                href="/negocios/presencia"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <SealCheck size={16} aria-hidden="true" />
                {C.contacto.verPlanes}
              </Link>
            </div>
          )}
        </BezelCard>

        {/* HORARIOS — se enlaza el editor que ya existe, no se duplica. */}
        <BezelCard coreClassName="flex flex-col items-start gap-2 p-4">
          <SeccionTitulo>{C.horarios.heading}</SeccionTitulo>
          <p className="text-sm leading-relaxed text-foreground-secondary">
            {C.horarios.body}
          </p>
          <Link
            href={`/negocios/${listingId}/horario`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Clock size={16} aria-hidden="true" />
            {C.horarios.cta}
          </Link>
        </BezelCard>

        {/* `Banner` sólo tiene info/warning/offline (§3.4): el éxito va como
            info y el error como warning — nunca como un rojo que este sistema
            no define para banners. Los dos con `role` para que un lector de
            pantalla los anuncie sin tener que volver a leer el formulario. */}
        {state.estado === "ok" && (
          <Banner variant="info" role="status" className="rounded-lg">
            {state.mensaje}
          </Banner>
        )}
        {state.estado === "error" && !state.campo && (
          <Banner variant="warning" role="alert" className="rounded-lg">
            {state.mensaje}
          </Banner>
        )}

        <Button type="submit" size="md" loading={pending} className="w-full">
          <FloppyDisk size={18} aria-hidden="true" />
          {pending ? C.guardando : C.guardar}
        </Button>
      </form>
    </div>
  );
}

function SeccionTitulo({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-base font-bold text-foreground">{children}</h2>;
}

/** El error del estado sólo si es de ESTE campo (si no, va al banner de abajo). */
function errorDe(state: EditarPaginaState, campo: string): string | undefined {
  return state.estado === "error" && state.campo === campo ? state.mensaje : undefined;
}
