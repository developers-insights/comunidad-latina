import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { listarIdentidadesDeNegocio } from "@/lib/perfil-activo/identidad";
import { supabaseSinTiparVerificacion } from "./types";

/**
 * =============================================================================
 * LA VERIFICACIÓN, PERFIL POR PERFIL (migración 0121)
 * =============================================================================
 *
 * Pedido del cliente, textual: «Y según cada perfil, debería de hacerse la
 * verificación de stripe si quieren abrir negocios/empleos/creador» · «Para
 * vender dentro de la plataforma, tenés que estar verificado sí o sí»
 * (2026-08-26).
 *
 * Hasta la 0121 "verificar tu identidad" era UNA cosa por persona
 * (`profiles.identity_verified`, escrita por el webhook de Stripe Identity).
 * Ahora son N: la persona, y cada uno de sus hasta diez negocios.
 *
 * ── LO QUE NO CAMBIÓ, Y ES DELIBERADO ───────────────────────────────────────
 * `profiles.identity_verified` sigue siendo la fuente ÚNICA del perfil
 * personal. No se migró, no se copió y no se derivó a ningún lado: las ~30
 * pantallas que la leen —el escudo verde, las tarjetas de creadores, el
 * marketplace, el Trust Score, el webhook del check azul— siguen preguntando lo
 * mismo y siguen teniendo razón, porque lo que preguntan es "¿esta PERSONA
 * verificó su documento?" y esa pregunta no cambió de forma.
 *
 * Lo que se agregó es la otra mitad: `business_verifications.stripe_status`
 * (tabla de la 0031, que hasta hoy no tenía un solo consumidor).
 *
 * ── POR QUÉ EL NEGOCIO NO SACA SU PROPIA FOTO DE DOCUMENTO ──────────────────
 * Porque no existe el documento de una panadería. Stripe Identity verifica a un
 * ser humano. Pedirle a la misma persona la misma foto diez veces cuesta ~USD
 * 1,50 cada vez y no comprueba nada nuevo. Entonces el negocio se verifica por
 * RECLAMO: alguien con el documento ya validado y rol propietario o
 * administrador declara que es el responsable de ese perfil, y eso queda
 * firmado con su id y su fecha (`identity_claimed_by` / `identity_claimed_at`)
 * y en `business_audit_log`.
 *
 * El reclamo NO es automático y ahí está el punto: un negocio que administrás y
 * nunca reclamaste queda sin verificar aunque vos lo estés. Eso es «según cada
 * perfil».
 *
 * ── ANTE LA DUDA, SIN VERIFICAR ─────────────────────────────────────────────
 * Mismo criterio que `leerCheckAzul()`: un error de lectura devuelve `false`.
 * De los dos errores posibles, no mostrar la insignia es invisible y mostrarla
 * de más es una afirmación falsa sobre alguien.
 */

/** Un perfil con el que la persona puede actuar, y su estado de verificación. */
export interface EstadoDeIdentidad {
  tipo: "persona" | "negocio";
  /** `profiles.id` para la persona, `business_accounts.id` para un negocio. */
  id: string;
  nombre: string;
  avatarUrl: string | null;
  verificada: boolean;
  /**
   * ¿Puede esta sesión resolver la verificación de este perfil desde acá?
   *
   * Para la persona es siempre `false`: eso no se reclama, se hace con Stripe
   * Identity y tiene su propio botón. Para un negocio es `true` sólo con rol
   * propietario o administrador — la RPC lo vuelve a exigir, así que esto es
   * para no dibujar un botón que va a rebotar, nunca para conceder.
   */
  puedeReclamar: boolean;
}

/** Los roles que pueden declarar que son responsables de un negocio. */
const ROLES_QUE_RECLAMAN: ReadonlySet<string> = new Set(["propietario", "administrador"]);

interface FilaPerfil {
  display_name: string | null;
  avatar_url: string | null;
  identity_verified: boolean | null;
}

/**
 * Todos los perfiles de esta sesión, con su verificación. La persona primero.
 *
 * Una sola consulta a `profiles` más la RPC `identidades_disponibles()`, que ya
 * viene `cache()`-eada por request y desde la 0121 trae la columna `verificada`
 * — o sea que listar diez negocios con su estado no cuesta diez consultas.
 */
export async function leerEstadoDeIdentidades(
  supabase: SupabaseClient,
  userId: string,
): Promise<EstadoDeIdentidad[]> {
  const [perfilResult, negocios] = await Promise.all([
    supabaseSinTiparVerificacion(supabase)
      .from("profiles")
      .select("display_name, avatar_url, identity_verified")
      .eq("id", userId)
      .maybeSingle(),
    listarIdentidadesDeNegocio(),
  ]);

  if (perfilResult.error) {
    console.warn("[verificacion] no se pudo leer el perfil personal", {
      code: perfilResult.error.code,
    });
  }
  const perfil = (perfilResult.data as FilaPerfil | null) ?? null;

  const persona: EstadoDeIdentidad = {
    tipo: "persona",
    id: userId,
    nombre: perfil?.display_name ?? "Tu perfil personal",
    avatarUrl: perfil?.avatar_url ?? null,
    verificada: perfil?.identity_verified === true,
    puedeReclamar: false,
  };

  return [
    persona,
    ...negocios.map<EstadoDeIdentidad>((negocio) => ({
      tipo: "negocio",
      id: negocio.businessId,
      nombre: negocio.nombre,
      avatarUrl: negocio.avatarUrl,
      verificada: negocio.verificada,
      puedeReclamar: ROLES_QUE_RECLAMAN.has(negocio.rol),
    })),
  ];
}

/** Códigos que devuelve `public.verificar_identidad_de_negocio()` (0121). */
export const RECLAMO_CODIGOS = [
  "ok",
  "sin_sesion",
  "sin_permiso",
  "identidad_personal_pendiente",
] as const;
export type ReclamoCodigo = (typeof RECLAMO_CODIGOS)[number];

export function esReclamoCodigo(valor: unknown): valor is ReclamoCodigo {
  return (
    typeof valor === "string" && (RECLAMO_CODIGOS as readonly string[]).includes(valor)
  );
}
