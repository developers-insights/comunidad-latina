"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import {
  CampoContacto,
  ErrorDelRegistro,
  RegistroHecho,
} from "@/components/comunidad";
import {
  COMUNIDAD_COPY,
  REGISTRATION_AREA_MAX,
  REGISTRATION_BODY_MAX,
  REGISTRATION_DETAIL_MAX,
  REGISTRATION_NAME_MAX,
  REQUESTER_TYPES,
  REQUESTER_TYPE_LABEL,
  pedidoDeVoluntariosSchema,
  type RequesterType,
} from "@/lib/comunidad";
import { pedirVoluntarios } from "../../registros/actions";

const C = COMUNIDAD_COPY.registros;
const P = C.pedirVoluntarios;

/**
 * =============================================================================
 * NECESITO VOLUNTARIOS
 * =============================================================================
 *
 * Lo que el cliente describió (45:40–47:50): un grupo chico que necesita manos
 * llena esto, y NADIE de la lista de voluntarios lo ve. Comunidad Latina revisa
 * que sea voluntariado de verdad —«no va a pedir voluntarios para poner el
 * sheetrock del baño»— y recién ahí avisa a la gente de la zona.
 *
 * ── EL CAMPO DE ORGANIZACIÓN APARECE Y DESAPARECE ───────────────────────────
 * Y no es un adorno: el cliente fue explícito en que no hace falta ser empresa.
 * Un campo «Organización» siempre visible le dice a una vecina que organiza algo
 * con tres amigas que este formulario no es para ella. Se muestra sólo cuando
 * eligió «una organización».
 */
export function PedirVoluntariosForm() {
  const router = useRouter();

  const [quien, setQuien] = useState<RequesterType>("persona");
  const [nombre, setNombre] = useState("");
  const [org, setOrg] = useState("");
  const [paraQue, setParaQue] = useState("");
  const [cuando, setCuando] = useState("");
  const [zona, setZona] = useState("");
  const [cuantos, setCuantos] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  async function enviar() {
    const payload = {
      name: nombre.trim(),
      areaLabel: zona.trim(),
      body: paraQue.trim(),
      requesterType: quien,
      whenLabel: cuando.trim(),
      peopleNeeded: cuantos.trim(),
      ...(quien === "organizacion" && org.trim() ? { orgName: org.trim() } : {}),
      ...(telefono.trim() ? { contactPhone: telefono.trim() } : {}),
      ...(email.trim() ? { contactEmail: email.trim() } : {}),
    };

    const revisado = pedidoDeVoluntariosSchema.safeParse(payload);
    if (!revisado.success) {
      setError(mensajeDeCampo(String(revisado.error.issues[0]?.path?.[0] ?? "")));
      return;
    }

    setError(null);
    setEnviando(true);
    try {
      const resultado = await pedirVoluntarios(payload);
      if (!resultado.ok) {
        if (resultado.needsAuth) {
          router.push(`/entrar?next=${encodeURIComponent("/comunidad/voluntarios/pedir")}`);
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

  if (listo) return <RegistroHecho title={P.done.title} body={P.done.body} />;

  return (
    <div className="flex flex-col gap-5">
      <Field htmlFor="pedir-quien" label={P.quienLabel} help={P.quienHelp}>
        <Select
          id="pedir-quien"
          value={quien}
          onChange={(event) => setQuien(event.target.value as RequesterType)}
        >
          {REQUESTER_TYPES.map((valor) => (
            <option key={valor} value={valor}>
              {REQUESTER_TYPE_LABEL[valor]}
            </option>
          ))}
        </Select>
      </Field>

      <Field htmlFor="pedir-nombre" label={P.nombreLabel}>
        <Input
          id="pedir-nombre"
          value={nombre}
          onChange={(event) => setNombre(event.target.value)}
          placeholder={P.nombrePlaceholder}
          maxLength={REGISTRATION_NAME_MAX}
          autoComplete="name"
        />
      </Field>

      {quien === "organizacion" && (
        <Field htmlFor="pedir-org" label={P.orgLabel}>
          <Input
            id="pedir-org"
            value={org}
            onChange={(event) => setOrg(event.target.value)}
            placeholder={P.orgPlaceholder}
            maxLength={REGISTRATION_DETAIL_MAX}
            autoComplete="organization"
          />
        </Field>
      )}

      <Field htmlFor="pedir-para-que" label={P.paraQueLabel} help={P.paraQueHelp}>
        <Textarea
          id="pedir-para-que"
          value={paraQue}
          onChange={(event) => setParaQue(event.target.value)}
          placeholder={P.paraQuePlaceholder}
          maxLength={REGISTRATION_BODY_MAX}
          rows={4}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field htmlFor="pedir-cuando" label={P.cuandoLabel}>
          <Input
            id="pedir-cuando"
            value={cuando}
            onChange={(event) => setCuando(event.target.value)}
            placeholder={P.cuandoPlaceholder}
            maxLength={REGISTRATION_DETAIL_MAX}
            autoComplete="off"
          />
        </Field>

        <Field htmlFor="pedir-cuantos" label={P.cuantosLabel} help={P.cuantosHelp}>
          <Input
            id="pedir-cuantos"
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            value={cuantos}
            onChange={(event) => setCuantos(event.target.value)}
            placeholder="6"
          />
        </Field>
      </div>

      <Field htmlFor="pedir-zona" label={C.campos.zonaLabel} help={C.campos.zonaHelp}>
        <Input
          id="pedir-zona"
          value={zona}
          onChange={(event) => setZona(event.target.value)}
          placeholder={C.campos.zonaPlaceholder}
          maxLength={REGISTRATION_AREA_MAX}
          autoComplete="off"
        />
      </Field>

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
        <PaperPlaneTilt size={18} weight="fill" aria-hidden="true" />
        {enviando ? P.submitting : P.submit}
      </Button>
    </div>
  );
}

function mensajeDeCampo(campo: string): string {
  const porCampo: Record<string, string> = {
    name: C.errores.nombre,
    orgName: C.errores.nombre,
    areaLabel: C.errores.zona,
    body: C.errores.detalle,
    whenLabel: C.errores.cuando,
    peopleNeeded: C.errores.personas,
    contactPhone: C.errores.contacto,
    contactEmail: C.errores.email,
  };
  return porCampo[campo] ?? C.errores.generic;
}
