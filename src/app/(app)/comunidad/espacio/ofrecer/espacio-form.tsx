"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HouseLine } from "@phosphor-icons/react/dist/ssr";
import { Button, Field, Input, Textarea } from "@/components/ui";
import {
  COMUNIDAD_ACCENT_MANOS,
  CampoContacto,
  ChipsDeOpciones,
  ErrorDelRegistro,
  RegistroHecho,
} from "@/components/comunidad";
import {
  COMUNIDAD_COPY,
  REGISTRATION_AREA_MAX,
  REGISTRATION_BODY_MAX,
  REGISTRATION_DETAIL_MAX,
  REGISTRATION_NAME_MAX,
  SPACE_ACTIVITIES,
  SPACE_ACTIVITY_LABEL,
  ofrecimientoDeEspacioSchema,
  type SpaceActivity,
} from "@/lib/comunidad";
import { ofrecerEspacio } from "../../registros/actions";

const C = COMUNIDAD_COPY.registros;
const E = C.espacio;

/**
 * =============================================================================
 * OFRECER MI ESPACIO
 * =============================================================================
 *
 * «Un sábado a la mañana, un warehouse vacío el domingo… para clases de música
 *  para los chicos, inglés para las madres, charlas de inmigración.» (Cliente,
 *  2026-09-03, 1:00:45–1:06:00.)
 *
 * El cliente sabe que esto arranca sin nadie («al principio no se van a
 * registrar, pero por lo menos ya tenemos el botón»), así que el formulario está
 * hecho para el primero que llegue: corto, sin condiciones y sin pedir papeles.
 * Lo único que necesita el equipo para poder llamar es qué hay, dónde, cuándo y
 * a quién llamar.
 */
export function EspacioForm() {
  const router = useRouter();

  const [nombre, setNombre] = useState("");
  const [direccion, setDireccion] = useState("");
  const [zona, setZona] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [capacidad, setCapacidad] = useState("");
  const [dias, setDias] = useState("");
  const [actividades, setActividades] = useState<SpaceActivity[]>([]);
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  async function enviar() {
    const payload = {
      name: nombre.trim(),
      areaLabel: zona.trim(),
      body: descripcion.trim(),
      address: direccion.trim(),
      capacity: capacidad.trim(),
      daysLabel: dias.trim(),
      activities: actividades,
      ...(telefono.trim() ? { contactPhone: telefono.trim() } : {}),
      ...(email.trim() ? { contactEmail: email.trim() } : {}),
    };

    const revisado = ofrecimientoDeEspacioSchema.safeParse(payload);
    if (!revisado.success) {
      setError(mensajeDeCampo(String(revisado.error.issues[0]?.path?.[0] ?? "")));
      return;
    }

    setError(null);
    setEnviando(true);
    try {
      const resultado = await ofrecerEspacio(payload);
      if (!resultado.ok) {
        if (resultado.needsAuth) {
          router.push(`/entrar?next=${encodeURIComponent("/comunidad/espacio/ofrecer")}`);
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

  if (listo) return <RegistroHecho title={E.done.title} body={E.done.body} />;

  return (
    <div className="flex flex-col gap-5">
      <Field htmlFor="espacio-nombre" label={E.nombreLabel}>
        <Input
          id="espacio-nombre"
          value={nombre}
          onChange={(event) => setNombre(event.target.value)}
          placeholder={E.nombrePlaceholder}
          maxLength={REGISTRATION_NAME_MAX}
          autoComplete="organization"
        />
      </Field>

      <Field htmlFor="espacio-direccion" label={E.direccionLabel}>
        <Input
          id="espacio-direccion"
          value={direccion}
          onChange={(event) => setDireccion(event.target.value)}
          placeholder={E.direccionPlaceholder}
          maxLength={REGISTRATION_DETAIL_MAX}
          autoComplete="street-address"
        />
      </Field>

      <Field htmlFor="espacio-zona" label={C.campos.zonaLabel} help={C.campos.zonaHelp}>
        <Input
          id="espacio-zona"
          value={zona}
          onChange={(event) => setZona(event.target.value)}
          placeholder={C.campos.zonaPlaceholder}
          maxLength={REGISTRATION_AREA_MAX}
          autoComplete="off"
        />
      </Field>

      <Field htmlFor="espacio-descripcion" label={E.descripcionLabel} help={E.descripcionHelp}>
        <Textarea
          id="espacio-descripcion"
          value={descripcion}
          onChange={(event) => setDescripcion(event.target.value)}
          placeholder={E.descripcionPlaceholder}
          maxLength={REGISTRATION_BODY_MAX}
          rows={4}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor="espacio-capacidad" label={E.capacidadLabel} help={E.capacidadHelp}>
          <Input
            id="espacio-capacidad"
            type="number"
            inputMode="numeric"
            min={1}
            max={2000}
            value={capacidad}
            onChange={(event) => setCapacidad(event.target.value)}
            placeholder="30"
          />
        </Field>

        <Field htmlFor="espacio-dias" label={E.diasLabel}>
          <Input
            id="espacio-dias"
            value={dias}
            onChange={(event) => setDias(event.target.value)}
            placeholder={E.diasPlaceholder}
            maxLength={REGISTRATION_DETAIL_MAX}
            autoComplete="off"
          />
        </Field>
      </div>

      <ChipsDeOpciones
        name="espacio-actividades"
        legend={E.actividadesLabel}
        help={E.actividadesHelp}
        opciones={SPACE_ACTIVITIES}
        etiquetas={SPACE_ACTIVITY_LABEL}
        seleccion={actividades}
        onToggle={(valor) =>
          setActividades(
            actividades.includes(valor)
              ? actividades.filter((item) => item !== valor)
              : [...actividades, valor],
          )
        }
        accent={COMUNIDAD_ACCENT_MANOS}
      />

      <CampoContacto telefono={telefono} email={email} onTelefono={setTelefono} onEmail={setEmail} />

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
        <HouseLine size={18} weight="fill" aria-hidden="true" />
        {enviando ? E.submitting : E.submit}
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
    capacity: C.errores.capacidad,
    daysLabel: C.errores.horarios,
    activities: C.errores.chips,
    contactPhone: C.errores.contacto,
    contactEmail: C.errores.email,
  };
  return porCampo[campo] ?? C.errores.generic;
}
