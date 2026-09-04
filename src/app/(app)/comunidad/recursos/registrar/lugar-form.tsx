"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Storefront } from "@phosphor-icons/react/dist/ssr";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { CampoContacto, ErrorDelRegistro, RegistroHecho } from "@/components/comunidad";
import {
  COMUNIDAD_COPY,
  PLACE_TYPES,
  PLACE_TYPE_HINT,
  PLACE_TYPE_LABEL,
  REGISTRATION_AREA_MAX,
  REGISTRATION_BODY_MAX,
  REGISTRATION_DETAIL_MAX,
  REGISTRATION_NAME_MAX,
  registroDeLugarSchema,
  type PlaceType,
} from "@/lib/comunidad";
import { registrarLugar } from "../../registros/actions";

const C = COMUNIDAD_COPY.registros;
const L = C.lugar;

/**
 * =============================================================================
 * REGISTRAR MI LUGAR — centro de acopio · banco de comida o comedor
 * =============================================================================
 *
 * «Centro de acopio igual: los negocios entran ahí, debe haber una forma de
 *  registrarse.» (Cliente, 2026-09-03, 39:30.)
 *
 * ── ES EL ÚNICO DE LOS CUATRO QUE PUEDE TERMINAR PUBLICADO ──────────────────
 * Y por eso es el único donde la promesa de contacto va al revés: el teléfono
 * que se deja acá es el del LUGAR y aparece en la ficha si el equipo la aprueba.
 * `<CampoContacto>` recibe ese texto por parámetro justamente para poder decir
 * la verdad en cada pantalla en vez de repetir una frase que en ésta sería
 * falsa.
 *
 * ── EL TIPO SE ELIGE PRIMERO Y CON SU EXPLICACIÓN AL LADO ───────────────────
 * «Centro de acopio» y «Banco de comida» se confunden todo el tiempo, y son
 * opuestos: en uno se DEJA una donación y en el otro se RECIBE. Elegir mal manda
 * la ficha a la tarjeta equivocada de la portada, así que la ayuda del campo
 * dice la diferencia con esas dos palabras.
 */
export function LugarForm() {
  const router = useRouter();

  const [tipo, setTipo] = useState<PlaceType>("comida");
  const [nombre, setNombre] = useState("");
  const [direccion, setDireccion] = useState("");
  const [zona, setZona] = useState("");
  const [horarios, setHorarios] = useState("");
  const [que, setQue] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  async function enviar() {
    const payload = {
      name: nombre.trim(),
      areaLabel: zona.trim(),
      body: que.trim(),
      placeType: tipo,
      address: direccion.trim(),
      hoursLabel: horarios.trim(),
      ...(telefono.trim() ? { contactPhone: telefono.trim() } : {}),
      ...(email.trim() ? { contactEmail: email.trim() } : {}),
    };

    const revisado = registroDeLugarSchema.safeParse(payload);
    if (!revisado.success) {
      setError(mensajeDeCampo(String(revisado.error.issues[0]?.path?.[0] ?? "")));
      return;
    }

    setError(null);
    setEnviando(true);
    try {
      const resultado = await registrarLugar(payload);
      if (!resultado.ok) {
        if (resultado.needsAuth) {
          router.push(`/entrar?next=${encodeURIComponent("/comunidad/recursos/registrar")}`);
          return;
        }
        setError(resultado.error);
        return;
      }
      setListo(true);
    } catch {
      setError(C.errores.generic);
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <RegistroHecho
        title={L.done.title}
        body={L.done.body}
        volverHref="/comunidad/recursos"
        volverLabel="Ver el directorio"
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Field htmlFor="lugar-tipo" label={L.tipoLabel} help={PLACE_TYPE_HINT[tipo]}>
        <Select
          id="lugar-tipo"
          value={tipo}
          onChange={(event) => setTipo(event.target.value as PlaceType)}
        >
          {PLACE_TYPES.map((valor) => (
            <option key={valor} value={valor}>
              {PLACE_TYPE_LABEL[valor]}
            </option>
          ))}
        </Select>
      </Field>

      <Field htmlFor="lugar-nombre" label={L.nombreLabel}>
        <Input
          id="lugar-nombre"
          value={nombre}
          onChange={(event) => setNombre(event.target.value)}
          placeholder={L.nombrePlaceholder}
          maxLength={REGISTRATION_NAME_MAX}
          autoComplete="organization"
        />
      </Field>

      <Field htmlFor="lugar-direccion" label={L.direccionLabel}>
        <Input
          id="lugar-direccion"
          value={direccion}
          onChange={(event) => setDireccion(event.target.value)}
          placeholder={L.direccionPlaceholder}
          maxLength={REGISTRATION_DETAIL_MAX}
          autoComplete="street-address"
        />
      </Field>

      <Field htmlFor="lugar-zona" label={C.campos.zonaLabel} help={C.campos.zonaHelp}>
        <Input
          id="lugar-zona"
          value={zona}
          onChange={(event) => setZona(event.target.value)}
          placeholder={C.campos.zonaPlaceholder}
          maxLength={REGISTRATION_AREA_MAX}
          autoComplete="off"
        />
      </Field>

      <Field htmlFor="lugar-horarios" label={L.horariosLabel}>
        <Input
          id="lugar-horarios"
          value={horarios}
          onChange={(event) => setHorarios(event.target.value)}
          placeholder={L.horariosPlaceholder}
          maxLength={REGISTRATION_DETAIL_MAX}
          autoComplete="off"
        />
      </Field>

      <Field htmlFor="lugar-que" label={L.queLabel} help={L.queHelp}>
        <Textarea
          id="lugar-que"
          value={que}
          onChange={(event) => setQue(event.target.value)}
          placeholder={L.quePlaceholder}
          maxLength={REGISTRATION_BODY_MAX}
          rows={4}
        />
      </Field>

      <CampoContacto
        titulo={L.contactoTitulo}
        ayuda={L.contactoAyuda}
        nota={L.aviso}
        telefono={telefono}
        email={email}
        onTelefono={setTelefono}
        onEmail={setEmail}
      />

      {error && <ErrorDelRegistro mensaje={error} />}

      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={enviar}
        disabled={enviando}
        aria-busy={enviando}
        loading={enviando}
      >
        <Storefront size={18} weight="fill" aria-hidden="true" />
        {enviando ? L.submitting : L.submit}
      </Button>
    </div>
  );
}

function mensajeDeCampo(campo: string): string {
  const porCampo: Record<string, string> = {
    name: C.errores.nombre,
    areaLabel: C.errores.zona,
    body: C.errores.detalle,
    address: C.errores.direccion,
    hoursLabel: C.errores.horarios,
    contactPhone: C.errores.contacto,
    contactEmail: C.errores.email,
  };
  return porCampo[campo] ?? C.errores.generic;
}
