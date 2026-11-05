import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenant } from "@/lib/tenant/resolve";
import { isPhoneVerificationEnabled, isWhatsAppOtpConfigured } from "@/lib/config/services";
import { safeInternalPath } from "@/lib/url/safe-href";
import { maskPhone } from "@/lib/phone/e164";
import { CODE_TTL_MINUTES } from "@/lib/phone/verification";
import { PhoneVerification } from "./phone-verification";

export const metadata = { title: "Tu teléfono" };

/**
 * Ajustes › Tu teléfono.
 *
 * Cuando la comunidad lo exige (`tenants.phone_required`), acá llega el pedido
 * del shell (`<PhoneGateBanner>`). "Ahora no" es honesto: leer sigue libre, y lo
 * que no puede hacer sin verificar lo corta la base.
 *
 * ⚠️ RUTA APAGADA POR DEFECTO. Sin `PHONE_VERIFICATION_ENABLED=true` devuelve
 * 404 — ni siquiera una pantalla de "próximamente". El gate no es de producto
 * sino LEGAL (0030 y 0066): `user_phones` es un mapa teléfono↔identidad y no se
 * recolectan números reales hasta que haya firma. Una pantalla que anuncia la
 * función invita a probarla, y probarla es exactamente lo que no puede pasar.
 *
 * El 404 es deliberado y no un error de degradación elegante: §7 pide no mostrar
 * errores crudos donde una feature existe pero su servicio no está. Acá la
 * feature entera está deshabilitada por una razón externa al producto, y lo
 * honesto es que la ruta no exista.
 */
export default async function TelefonoAjustesPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  if (!isPhoneVerificationEnabled) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/entrar?next=/ajustes/telefono");

  const [tenant, query] = await Promise.all([getTenant(), searchParams]);
  const required = tenant.phoneRequired === true;
  // Adónde volver después de verificar. Sanitizado: viene de la URL.
  const nextRaw = typeof query.next === "string" ? query.next : null;
  const returnTo = nextRaw ? safeInternalPath(nextRaw, "/feed") : null;

  /**
   * El número se lee con el cliente ADMIN y no con el de sesión.
   *
   * `user_phones` tiene RLS solo-dueño, así que el cliente de sesión también lo
   * leería — pero traería el número EN CLARO al render. Acá se lee en el
   * servidor, se enmascara y sólo viaja `+1 ••• 0142`. Ni al dueño se le repite
   * el número entero en pantalla: los últimos cuatro dígitos alcanzan para que
   * reconozca cuál es, y un teléfono abierto sobre la mesa deja de ser un
   * número anotado.
   */
  let masked: string | null = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("user_phones")
      .select("phone_e164, phone_verified")
      .eq("profile_id", user.id)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (data?.phone_verified) masked = maskPhone(data.phone_e164);
  } catch {
    // Sin admin client configurado la pantalla igual sirve para verificar.
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          Tu teléfono
        </h1>
        <p className="mt-1 text-sm text-foreground-secondary">
          {required
            ? "Lo pedimos para cuidar a la comunidad: nos ayuda a saber que hay una persona real detrás de cada cuenta."
            : "Un número verificado le dice a la comunidad que hay una persona real detrás de tu perfil."}
        </p>
      </header>

      <PhoneVerification
        verifiedPhone={masked}
        ttlMinutes={CODE_TTL_MINUTES}
        whatsappAvailable={isWhatsAppOtpConfigured}
        required={required}
        returnTo={returnTo}
      />

      {required && !masked && (
        <Link
          href={returnTo ?? "/feed"}
          className="self-center text-sm font-medium text-foreground-secondary underline underline-offset-2"
        >
          Ahora no, quiero seguir leyendo
        </Link>
      )}

      <p className="text-xs leading-relaxed text-foreground-muted">
        Tu número nunca aparece en tu perfil, ni en las búsquedas, ni se comparte con
        nadie. Podés borrarlo cuando quieras y se borra de verdad.
      </p>
    </div>
  );
}
