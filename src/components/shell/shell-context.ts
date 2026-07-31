import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isStaffRole } from "@/app/admin/guard";

export interface ShellContext {
  /** null = sin sesión (el shell sigue sirviendo para explorar). */
  user: { displayName: string; avatarUrl: string | null } | null;
  /** Notificaciones sin leer (RLS: sólo las propias). */
  unread: number;
  isStaff: boolean;
}

const EMPTY: ShellContext = { user: null, unread: 0, isStaff: false };

/**
 * Lo que el shell necesita del server: identidad, notificaciones sin leer y si
 * la cuenta es staff. El rol sale SIEMPRE del JWT, nunca de `profiles.role`
 * (que es informativa) — mismo criterio que la RLS.
 *
 * `cache()` por request: lo consumen el Header (avatar del perfil) y el layout
 * (el punto de aviso del bottom nav), y sin esto serían dos veces las mismas
 * dos queries en cada navegación. Vivía dentro de header.tsx hasta que la barra
 * de abajo también necesitó el contador (2026-07-29).
 *
 * Sin sesión o sin DB devuelve el contexto vacío: nunca un error — que la
 * bandeja de notificaciones falle no puede tumbar el shell entero.
 */
export const getShellContext = cache(async (): Promise<ShellContext> => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return EMPTY;

    const [{ data: profile }, { count, error }] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null)
        // `dismissed_at` es borrado LÓGICO (0045): la fila sigue existiendo para
        // poder deshacer, pero ya no está en la bandeja. Sin este filtro el
        // punto del nav cuenta algo que no se puede abrir: quitar un aviso sin
        // leerlo lo saca de la lista y de notification_counts(), pero el badge
        // seguía prendido y NO quedaba ningún camino de UI para apagarlo —
        // "marcar todas como leídas" también saltea las descartadas — así que
        // el punto se quedaba hasta que expirara la fila, 60 días después.
        .is("dismissed_at", null),
    ]);

    return {
      user: {
        displayName: profile?.display_name ?? "Tu cuenta",
        avatarUrl: profile?.avatar_url ?? null,
      },
      unread: !error && typeof count === "number" ? count : 0,
      isStaff: isStaffRole(user.app_metadata?.role),
    };
  } catch {
    return EMPTY;
  }
});
