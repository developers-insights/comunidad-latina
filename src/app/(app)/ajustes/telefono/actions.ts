"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant/resolve";
import { isPhoneVerificationEnabled, isPhonePepperConfigured } from "@/lib/config/services";
import { maskPhone, parsePhone } from "@/lib/phone/e164";
import { getSmsSender, verificationSmsBody } from "@/lib/phone/sms";
import {
  canSend,
  consumeCode,
  issueCode,
  MAX_ATTEMPTS,
} from "@/lib/phone/verification";
import type { ActionResult } from "@/components/auth/action-result";

/**
 * Verificación del teléfono por SMS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ TODO ESTE FLUJO ESTÁ APAGADO POR DEFECTO, Y NO ES UN OLVIDO
 * ═══════════════════════════════════════════════════════════════════════════
 * `isPhoneVerificationEnabled` sale de `PHONE_VERIFICATION_ENABLED === "true"` y
 * hoy nadie la define. La migración 0030 dejó el motivo escrito y 0066 lo
 * repitió: `user_phones` es un mapa teléfono↔identidad, subpoenable, y NO se
 * recolectan números reales hasta que haya firma legal.
 *
 * Está construido entero —pedir el número, mandar el código, verificar,
 * reintentar con rate limit, y el estado en el perfil— y probado. Lo único que
 * falta es una decisión que no toma un deploy. CADA action de este archivo
 * chequea el gate ANTES de tocar nada.
 *
 * ── EL PROVEEDOR DE SMS TAMPOCO ESTÁ, Y TAMBIÉN A PROPÓSITO ──────────────────
 * Cuál se usa es una decisión comercial pendiente. `getSmsSender()` devuelve una
 * implementación de desarrollo que escribe el código en el LOG DEL SERVIDOR —
 * nunca en la respuesta HTTP ni en la pantalla, que sería un código legible
 * desde la pestaña de red.
 */

const COPY = {
  disabled:
    "Verificar tu teléfono todavía no está disponible. Te avisamos apenas se active.",
  noSession: "Tu sesión se cerró — entrá de nuevo para continuar.",
  genericError:
    "Algo no salió bien de nuestro lado — no es tu culpa. Probá de nuevo en un momento.",
  phoneEmpty: "Escribí tu número de teléfono.",
  phoneShort: "Ese número parece incompleto. Revisalo y probá de nuevo.",
  phoneLong: "Ese número tiene más dígitos de los que existen. Revisalo.",
  phoneFormat:
    "No pudimos leer ese número. Si es de Estados Unidos escribí los 10 dígitos; si es de otro país, empezá con + y el código del país.",
  phoneTaken:
    "Ese número ya está verificado en otra cuenta de esta comunidad. Un número, una cuenta.",
  rateLimitedHour:
    "Ya te mandamos varios códigos en la última hora. Esperá un rato y probá de nuevo — así protegemos tu número.",
  rateLimitedDay:
    "Llegaste al límite de códigos por hoy. Volvé mañana y te mandamos uno nuevo.",
  sendFailed: "No pudimos mandar el código. Revisá el número y probá de nuevo.",
  sent: "Te mandamos un código por mensaje de texto.",
  codeFormat: "El código son 6 números.",
  codeWrong: `Ese código no coincide. Fijate en el mensaje y probá de nuevo (tenés ${MAX_ATTEMPTS} intentos por código).`,
  codeExpired: "Ese código venció. Pedí uno nuevo y te lo mandamos al toque.",
  codeExhausted:
    "Se agotaron los intentos de ese código. Pedí uno nuevo para seguir.",
  codeMissing: "No hay ningún código activo. Pedí uno y te lo mandamos.",
  verified: "Listo, tu teléfono quedó verificado.",
} as const;

/** El gate legal + el pepper, en un solo lugar. */
function blocked(): { ok: false; formError: string } | null {
  if (!isPhoneVerificationEnabled) return { ok: false, formError: COPY.disabled };
  if (!isPhonePepperConfigured) {
    // Un hash sin sal es una tabla arcoíris de seis dígitos, o sea nada. Sin
    // pepper NO se emiten códigos: mejor no ofrecer la función que ofrecerla
    // rota de una forma que nadie ve.
    console.error("[telefono] PHONE_CODE_PEPPER sin configurar — flujo deshabilitado");
    return { ok: false, formError: COPY.disabled };
  }
  return null;
}

async function sessionContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const tenant = await getTenant();
  return { supabase, user, tenant };
}

// ---------------------------------------------------------------------------
// 1. Pedir el código
// ---------------------------------------------------------------------------

const sendSchema = z.object({ phone: z.string() });
export type SendPhoneCodeInput = z.infer<typeof sendSchema>;

export type SendPhoneCodeResult =
  | { ok: true; maskedPhone: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

export async function sendPhoneCodeAction(
  input: SendPhoneCodeInput,
): Promise<SendPhoneCodeResult> {
  const gate = blocked();
  if (gate) return gate;

  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: COPY.genericError };

  const phone = parsePhone(parsed.data.phone);
  if (!phone.ok) {
    const message = {
      vacio: COPY.phoneEmpty,
      corto: COPY.phoneShort,
      largo: COPY.phoneLong,
      formato: COPY.phoneFormat,
    }[phone.problem];
    return { ok: false, fieldErrors: { phone: message } };
  }

  const context = await sessionContext();
  if (!context) return { ok: false, formError: COPY.noSession };
  const { user, tenant } = context;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, formError: COPY.genericError };
  }

  /**
   * "Una cuenta por número DENTRO DEL DOMINIO" (0066): la unicidad de
   * `user_phones` es por tenant, no global — la misma persona puede pertenecer
   * legítimamente a dos comunidades.
   *
   * Se chequea ANTES de gastar un SMS. No es una sonda de existencia
   * explotable: sólo responde a alguien con sesión, sobre su propio tenant, y
   * el mismo tope de 3 códigos por hora limita cuántas veces se puede preguntar.
   */
  const { data: taken } = await admin
    .from("user_phones")
    .select("profile_id")
    .eq("tenant_id", tenant.id)
    .eq("phone_e164", phone.e164)
    .eq("phone_verified", true)
    .maybeSingle();

  if (taken && taken.profile_id !== user.id) {
    return { ok: false, fieldErrors: { phone: COPY.phoneTaken } };
  }

  // El rate limit lo resuelve Postgres contando filas: sigue valiendo aunque el
  // proceso se reinicie o haya varias instancias.
  const allowed = await canSend(admin, tenant.id, phone.e164);
  if (allowed !== "ok") {
    return {
      ok: false,
      formError:
        allowed === "rate_limited_hora" ? COPY.rateLimitedHour : COPY.rateLimitedDay,
    };
  }

  const pepper = process.env.PHONE_CODE_PEPPER ?? "";
  const issued = await issueCode(admin, tenant.id, {
    phone: phone.e164,
    profileId: user.id,
    pepper,
  });
  if (!issued.ok) return { ok: false, formError: COPY.genericError };

  const masked = maskPhone(phone.e164);
  const sent = await getSmsSender().send({
    to: phone.e164,
    maskedTo: masked,
    body: verificationSmsBody({ code: issued.code, communityName: tenant.name }),
  });

  if (!sent.ok) {
    // La fila del código queda: cuenta para el rate limit igual. Un envío que
    // falla y no cuenta convierte el límite en una sugerencia.
    return { ok: false, formError: COPY.sendFailed };
  }

  return { ok: true, maskedPhone: masked };
}

// ---------------------------------------------------------------------------
// 2. Canjear el código
// ---------------------------------------------------------------------------

const verifySchema = z.object({
  phone: z.string(),
  code: z.string().trim().regex(/^\d{6}$/, COPY.codeFormat),
});
export type VerifyPhoneCodeInput = z.infer<typeof verifySchema>;

export async function verifyPhoneCodeAction(
  input: VerifyPhoneCodeInput,
): Promise<ActionResult> {
  const gate = blocked();
  if (gate) return gate;

  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: { code: COPY.codeFormat } };

  const phone = parsePhone(parsed.data.phone);
  if (!phone.ok) return { ok: false, formError: COPY.genericError };

  const context = await sessionContext();
  if (!context) return { ok: false, formError: COPY.noSession };
  const { user, tenant } = context;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, formError: COPY.genericError };
  }

  const pepper = process.env.PHONE_CODE_PEPPER ?? "";

  /**
   * El canje entero pasa DENTRO de una transacción del motor: buscar el código
   * vivo con `for update`, validar vencimiento y tope de intentos, comparar el
   * hash y sumar el intento fallido. Es lo que hace que dos intentos simultáneos
   * gasten DOS intentos y no uno — o sea, que el tope de 5 sea un tope de verdad.
   */
  const outcome = await consumeCode(admin, tenant.id, {
    phone: phone.e164,
    code: parsed.data.code,
    pepper,
  });

  if (outcome !== "ok") {
    const message = {
      invalido: COPY.codeWrong,
      expirado: COPY.codeExpired,
      agotado: COPY.codeExhausted,
      sin_codigo: COPY.codeMissing,
    }[outcome];
    // El código va en el campo, el resto en el formulario: "venció" no es un
    // problema de lo que la persona escribió, y marcarle el input en rojo la
    // manda a revisar seis dígitos que están bien.
    return outcome === "invalido"
      ? { ok: false, fieldErrors: { code: message } }
      : { ok: false, formError: message };
  }

  /**
   * PRENDER LA INSIGNIA ES DECISIÓN DEL SERVIDOR, no de la función que canjea.
   * `app.phone_verification_consume()` (0066) lo dice explícitamente y tiene
   * razón: canjear un código prueba que alguien tiene el teléfono en la mano,
   * pero atarlo a una identidad y encender una señal de confianza es otra cosa,
   * y esa la decide la app.
   */
  const verifiedAt = new Date().toISOString();

  const { error: phoneError } = await admin.from("user_phones").upsert(
    {
      profile_id: user.id,
      tenant_id: tenant.id,
      phone_e164: phone.e164,
      phone_verified: true,
      phone_verified_at: verifiedAt,
      verification_channel: "sms",
    },
    { onConflict: "profile_id" },
  );

  if (phoneError) {
    // Choque contra `user_phones_tenant_e164_uniq`: alguien verificó ese número
    // entre el envío y el canje. Es raro pero es exactamente el caso que la
    // unicidad existe para atajar.
    if (phoneError.code === "23505") {
      return { ok: false, fieldErrors: { phone: COPY.phoneTaken } };
    }
    console.error("[telefono] upsert de user_phones falló", { code: phoneError.code });
    return { ok: false, formError: COPY.genericError };
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ phone_verified: true })
    .eq("id", user.id);

  if (profileError) {
    // El teléfono YA quedó verificado: la insignia del perfil es un reflejo, no
    // la verdad. Se loguea para reconciliar, no se le devuelve un error a
    // alguien que completó bien todo el flujo.
    console.error("[telefono] no se pudo prender profiles.phone_verified", {
      code: profileError.code,
    });
  }

  revalidatePath("/perfil");
  revalidatePath("/ajustes/telefono");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 3. Quitar el teléfono
// ---------------------------------------------------------------------------

export async function removePhoneAction(): Promise<ActionResult> {
  const gate = blocked();
  if (gate) return gate;

  const context = await sessionContext();
  if (!context) return { ok: false, formError: COPY.noSession };
  const { user, tenant } = context;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, formError: COPY.genericError };
  }

  // Minimización (§5.4): quitar el teléfono BORRA la fila, no la marca como
  // inactiva. Un número guardado "por las dudas" sigue siendo un mapa
  // teléfono↔identidad, que es justo lo que el gate legal de 0030 protege.
  const { error } = await admin
    .from("user_phones")
    .delete()
    .eq("profile_id", user.id)
    .eq("tenant_id", tenant.id);

  if (error) {
    console.error("[telefono] delete de user_phones falló", { code: error.code });
    return { ok: false, formError: COPY.genericError };
  }

  await admin.from("profiles").update({ phone_verified: false }).eq("id", user.id);

  revalidatePath("/perfil");
  revalidatePath("/ajustes/telefono");
  return { ok: true };
}
