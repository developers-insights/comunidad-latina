"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantMatch } from "@/lib/tenant/guard";
import { listarIdentidadesDeNegocio } from "@/lib/perfil-activo/identidad";
import {
  TOPE_DE_NEGOCIOS,
  contarNegociosPropios,
  esErrorDeTope,
  lugaresDeNegocio,
} from "@/lib/perfil-activo/tope";
import { BUSINESS_CATEGORIES } from "../categories";
import { COPY, MAX_NOMBRE_NEGOCIO } from "./copy";
import type { AltaState } from "./estado";

/**
 * =============================================================================
 * ALTA DE LA CUENTA DE NEGOCIO
 * =============================================================================
 *
 * ── QUÉ SE ESCRIBE ──────────────────────────────────────────────────────────
 * Una fila de `business_accounts`, que desde 0008 es «el ancla estable de
 * identidad+billing» del negocio. No se crea una tabla nueva ni un usuario
 * nuevo: es un segundo perfil DENTRO de la misma cuenta (ver el encabezado de
 * la 0103).
 *
 * ── QUÉ NO SE ESCRIBE ───────────────────────────────────────────────────────
 * Ni `plan`, ni `plan_status`, ni `verified_presence`, ni los ids de Stripe. La
 * policy de INSERT (0008) exige que vengan en su valor inicial, así que un alta
 * NO puede nacer con presencia verificada aunque este archivo se equivoque. La
 * verificación se compra en /negocios/presencia y la escribe el webhook.
 *
 * ── EL DUEÑO NO SE PASA, SE DEDUCE ──────────────────────────────────────────
 * `owner_id` sale del guard (JWT), nunca de un campo del formulario — y la
 * policy lo vuelve a exigir contra `auth.uid()`. `tenant_id`, igual.
 *
 * ── CREAR NO TE CAMBIA DE PERFIL ────────────────────────────────────────────
 * A propósito. Cambiar la identidad con la que alguien publica es una decisión
 * suya, y hacerlo de callado como efecto secundario de un alta es justo la clase
 * de sorpresa que hace que la persona publique algo con el nombre equivocado. Se
 * crea, se avisa, y el cambio es un botón aparte.
 *
 * ── HASTA DIEZ, Y EL TOPE LO PONE LA BASE (0121) ────────────────────────────
 * Hasta la 0121 había un índice único (tenant_id, owner_id) y este archivo
 * traducía su `23505` a «ya tenés una». Ese mensaje ya no existe: el cliente
 * pidió diez.
 *
 * El tope vive en el trigger `app.business_accounts_enforce_cap()`, no acá.
 * PostgREST está expuesto: un chequeo que sólo viva en esta función protege el
 * formulario, no la tabla. Lo que hace este archivo es preguntar ANTES para
 * poder decir una frase en español en vez de mostrar un error de Postgres —el
 * mismo reparto de trabajo que `cambiarIdentidad` con la policy de
 * `active_identities`—, y volver a mirar DESPUÉS por si dos pestañas abiertas
 * crearon el décimo al mismo tiempo. Los dos chequeos son redundantes a
 * propósito; el que manda es el de abajo.
 */

const RUBROS = BUSINESS_CATEGORIES.map((categoria) => categoria.value);

const altaSchema = z.object({
  nombre: z
    .string()
    .transform((valor) => valor.trim().replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .min(2, COPY.errors.nombreCorto)
        .max(MAX_NOMBRE_NEGOCIO, COPY.errors.nombreLargo),
    ),
  rubro: z
    .string()
    .transform((valor) => (valor.length > 0 ? valor : null))
    .refine((valor) => valor === null || RUBROS.includes(valor as never), {
      message: COPY.errors.generico,
    }),
});

export async function crearCuentaDeNegocio(
  _previo: AltaState,
  formData: FormData,
): Promise<AltaState> {
  const parsed = altaSchema.safeParse({
    nombre: String(formData.get("nombre") ?? ""),
    rubro: String(formData.get("rubro") ?? ""),
  });

  if (!parsed.success) {
    return {
      estado: "error",
      mensaje: parsed.error.issues[0]?.message ?? COPY.errors.generico,
    };
  }

  const guard = await requireTenantMatch();
  if (!guard.ok) {
    return {
      estado: "error",
      mensaje:
        guard.reason === "unauthenticated" ? COPY.errors.signedOut : guard.message,
    };
  }
  const { supabase, user, tenant } = guard;
  const { nombre, rubro } = parsed.data;

  // Antes de viajar: ¿le queda lugar? Sólo cuentan los PROPIOS — administrar
  // negocios ajenos no consume el tope (doctrina de la 0103).
  const lugares = lugaresDeNegocio(
    contarNegociosPropios(await listarIdentidadesDeNegocio()),
  );
  if (!lugares.puedeCrear) {
    return { estado: "error", mensaje: COPY.errors.tope(lugares.tope) };
  }

  const { error } = await supabase.from("business_accounts").insert({
    tenant_id: tenant.id,
    owner_id: user.id,
    name: nombre,
    category: rubro,
  });

  if (error) {
    // El trigger de la 0121. Se reconoce por el PREFIJO del mensaje y no por el
    // código: `P0001` es el de cualquier `raise exception` de esta base —lo
    // usan también la guarda de billing (0008) y la de reseñas (0093)—, así que
    // mirar sólo el código mostraría "llegaste al tope" ante errores que no lo
    // son. Llega hasta acá cuando dos pestañas crean el décimo a la vez: el
    // chequeo de arriba vio nueve en las dos.
    if (esErrorDeTope(error)) {
      return { estado: "error", mensaje: COPY.errors.tope(TOPE_DE_NEGOCIOS) };
    }
    // Log sin PII: solo el código y la comunidad.
    console.error("[cuenta-de-negocio] no se pudo crear", {
      code: error.code,
      tenant: tenant.slug,
    });
    return { estado: "error", mensaje: COPY.errors.generico };
  }

  // Toda la app: el trigger de la 0031 acaba de darle la capacidad "business" a
  // la cuenta y el cambiador del header tiene que verla en la próxima pantalla.
  revalidatePath("/", "layout");
  return { estado: "ok", mensaje: COPY.ok.created(nombre) };
}
