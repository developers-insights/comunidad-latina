"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HandHeart } from "@phosphor-icons/react/dist/ssr";
import { Button, Field, Input, Textarea } from "@/components/ui";
import {
  AceptarReglas,
  COMUNIDAD_ACCENT_VOLUNTARIOS,
  CampoContacto,
  ChipsDeOpciones,
  ErrorDelRegistro,
  PasosDelRegistro,
  RegistroHecho,
} from "@/components/comunidad";
import {
  COMUNIDAD_COPY,
  REGISTRATION_AREA_MAX,
  REGISTRATION_BODY_MAX,
  REGISTRATION_NAME_MAX,
  VOLUNTEER_AVAILABILITY,
  VOLUNTEER_AVAILABILITY_LABEL,
  VOLUNTEER_SKILLS,
  VOLUNTEER_SKILL_LABEL,
  registroVoluntarioSchema,
  type VolunteerAvailability,
  type VolunteerSkill,
} from "@/lib/comunidad";
import { registrarVoluntario } from "../../registros/actions";

const C = COMUNIDAD_COPY.registros;
const V = C.voluntario;

/**
 * =============================================================================
 * ME ANOTO COMO VOLUNTARIO — un solo paso
 * =============================================================================
 *
 * Sin wizard. Son seis cosas y entran en una pantalla: quién sos, en qué podés
 * ayudar, cuándo, algo más si querés, cómo te contactamos y las reglas. Partirlo
 * en pasos haría que alguien que quiere dar una mano tenga que adivinar cuánto
 * le falta.
 *
 * ── EL ORDEN NO ES CASUAL ───────────────────────────────────────────────────
 * Primero los tres pasos que cuentan qué va a pasar con los datos, después lo
 * fácil (nombre, zona), después las opciones, y el contacto y las reglas AL
 * FINAL. Quien llega hasta abajo ya entendió de qué se trata; pedir el teléfono
 * en la primera línea es pedirlo antes de haber dado ninguna razón para darlo.
 *
 * ── LA VALIDACIÓN DE ACÁ ES CORTESÍA, LA DEL SERVIDOR ES LA REGLA ───────────
 * `registroVoluntarioSchema` es el MISMO esquema que corre en la action (por eso
 * vive en `lib/comunidad/registros.ts` y no dentro del archivo `"use server"`).
 * Corre acá para que el problema se vea con el campo a la vista; abajo de los
 * dos está el trigger de la 0131.
 *
 * ── QUÉ PASA CON LO ESCRITO SI ALGO FALLA ───────────────────────────────────
 * Nada se pierde: el estado vive en este componente hasta que el envío sale
 * bien.
 */
export function VoluntarioForm() {
  const router = useRouter();

  const [nombre, setNombre] = useState("");
  const [zona, setZona] = useState("");
  const [skills, setSkills] = useState<VolunteerSkill[]>([]);
  const [disponibilidad, setDisponibilidad] = useState<VolunteerAvailability[]>([]);
  const [detalle, setDetalle] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [acepta, setAcepta] = useState(false);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  function alternar<T extends string>(valor: T, lista: T[], set: (valores: T[]) => void) {
    set(lista.includes(valor) ? lista.filter((item) => item !== valor) : [...lista, valor]);
  }

  async function enviar() {
    const payload = {
      name: nombre.trim(),
      areaLabel: zona.trim(),
      body: detalle.trim(),
      skills,
      availability: disponibilidad,
      aceptaReglas: acepta,
      ...(telefono.trim() ? { contactPhone: telefono.trim() } : {}),
      ...(email.trim() ? { contactEmail: email.trim() } : {}),
    };

    const revisado = registroVoluntarioSchema.safeParse(payload);
    if (!revisado.success) {
      setError(mensajeDeCampo(String(revisado.error.issues[0]?.path?.[0] ?? "")));
      return;
    }

    setError(null);
    setEnviando(true);
    try {
      // `aceptaReglas: true` literal y no la variable: el esquema de arriba ya
      // confirmó que está tildada (es un `z.literal(true)`), y el tipo de la
      // action lo pide así justamente para que un `false` no pueda viajar ni
      // por accidente. Es lo mismo que acaba de validarse, escrito de manera
      // que TypeScript también lo sepa.
      const resultado = await registrarVoluntario({ ...payload, aceptaReglas: true });
      if (!resultado.ok) {
        if (resultado.needsAuth) {
          router.push(`/entrar?next=${encodeURIComponent("/comunidad/voluntarios/registrarme")}`);
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

  if (listo) return <RegistroHecho title={V.done.title} body={V.done.body} />;

  return (
    <div className="flex flex-col gap-5">
      <PasosDelRegistro pasos={V.pasos} accent={COMUNIDAD_ACCENT_VOLUNTARIOS} />

      <Field htmlFor="voluntario-nombre" label={V.nombreLabel}>
        <Input
          id="voluntario-nombre"
          value={nombre}
          onChange={(event) => setNombre(event.target.value)}
          placeholder={V.nombrePlaceholder}
          maxLength={REGISTRATION_NAME_MAX}
          autoComplete="name"
        />
      </Field>

      <Field htmlFor="voluntario-zona" label={C.campos.zonaLabel} help={C.campos.zonaHelp}>
        <Input
          id="voluntario-zona"
          value={zona}
          onChange={(event) => setZona(event.target.value)}
          placeholder={C.campos.zonaPlaceholder}
          maxLength={REGISTRATION_AREA_MAX}
          autoComplete="off"
        />
      </Field>

      <ChipsDeOpciones
        name="voluntario-skills"
        legend={V.habilidadesLabel}
        help={V.habilidadesHelp}
        opciones={VOLUNTEER_SKILLS}
        etiquetas={VOLUNTEER_SKILL_LABEL}
        seleccion={skills}
        onToggle={(valor) => alternar(valor, skills, setSkills)}
        accent={COMUNIDAD_ACCENT_VOLUNTARIOS}
      />

      <ChipsDeOpciones
        name="voluntario-disponibilidad"
        legend={V.disponibilidadLabel}
        help={V.disponibilidadHelp}
        opciones={VOLUNTEER_AVAILABILITY}
        etiquetas={VOLUNTEER_AVAILABILITY_LABEL}
        seleccion={disponibilidad}
        onToggle={(valor) => alternar(valor, disponibilidad, setDisponibilidad)}
        accent={COMUNIDAD_ACCENT_VOLUNTARIOS}
      />

      <Field htmlFor="voluntario-detalle" label={V.detalleLabel} help={V.detalleHelp}>
        <Textarea
          id="voluntario-detalle"
          value={detalle}
          onChange={(event) => setDetalle(event.target.value)}
          placeholder={V.detallePlaceholder}
          maxLength={REGISTRATION_BODY_MAX}
          rows={4}
        />
      </Field>

      <CampoContacto
        telefono={telefono}
        email={email}
        onTelefono={setTelefono}
        onEmail={setEmail}
      />

      <AceptarReglas
        titulo={V.reglasTitle}
        reglas={V.reglas}
        label={V.reglasCheck}
        checked={acepta}
        onChange={setAcepta}
        accent={COMUNIDAD_ACCENT_VOLUNTARIOS}
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
        <HandHeart size={18} weight="fill" aria-hidden="true" />
        {enviando ? V.submitting : V.submit}
      </Button>
    </div>
  );
}

/**
 * El primer campo que zod marcó → la frase que corresponde. El servidor tiene la
 * MISMA tabla (`errorDeZod` en la action): las dos existen porque una habla
 * antes del viaje y la otra después, y tienen que decir lo mismo.
 */
function mensajeDeCampo(campo: string): string {
  const porCampo: Record<string, string> = {
    name: C.errores.nombre,
    areaLabel: C.errores.zona,
    body: C.errores.detalle,
    contactPhone: C.errores.contacto,
    contactEmail: C.errores.email,
    aceptaReglas: C.errores.reglas,
    skills: C.errores.chips,
    availability: C.errores.chips,
  };
  return porCampo[campo] ?? C.errores.generic;
}
