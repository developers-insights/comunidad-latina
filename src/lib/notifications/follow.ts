import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "./notify";
import { summarizeActors } from "./group";

/**
 * "María, José y 18 personas más te empezaron a seguir" — UNA fila, no veinte.
 *
 * Es el caso testigo de `group_key` (0045): la clave es
 * `follow:profile:<tu_id>` y el emisor reescribe la fila viva en vez de
 * insertar otra. El "18" NO sale de un contador guardado en la notificación
 * (esa columna no existe y no se inventa): se recalcula del dato real —el conteo
 * de `follows`— cada vez que alguien te sigue. Un contador paralelo se
 * desincroniza el primer día que alguien deja de seguirte.
 *
 * Vive acá y no dentro de la server action de social por dos motivos: el
 * módulo NOTIFICACIONES es el dueño de cómo se arma este texto, y la action
 * queda con una sola línea agregada (menos superficie de conflicto entre
 * frentes).
 *
 * Best-effort absoluto: NUNCA lanza. Que falle el aviso no puede desarmar un
 * "seguir" que ya está guardado.
 */
export async function notifyNewFollower(input: {
  tenantId: string;
  /** Quien acaba de seguir. */
  followerId: string;
  /** Quien recibe el aviso. */
  targetProfileId: string;
}): Promise<void> {
  if (input.followerId === input.targetProfileId) return;

  try {
    const admin = createAdminClient();

    // Los dos más recientes para nombrar + el total real, en un solo viaje.
    const { data: recent, count } = await admin
      .from("follows")
      .select("follower_id", { count: "exact" })
      .eq("tenant_id", input.tenantId)
      .eq("target_kind", "profile")
      .eq("target_id", input.targetProfileId)
      .order("created_at", { ascending: false })
      .limit(2);

    const total = count ?? recent?.length ?? 1;
    const ids = (recent ?? []).map((row) => row.follower_id);
    if (ids.length === 0) ids.push(input.followerId);

    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", ids);

    // El orden de `in()` no está garantizado: se reordena según `ids` para que
    // quien acaba de seguirte aparezca primero, que es lo que dice el aviso.
    const nameById = new Map((profiles ?? []).map((row) => [row.id, row.display_name]));
    const names = ids
      .map((id) => nameById.get(id))
      .filter((name): name is string => Boolean(name && name.trim()));

    if (names.length === 0) return;

    const actors = summarizeActors(names, { total });
    const verb = total > 1 ? "te empezaron a seguir" : "te empezó a seguir";

    await createNotification(admin, {
      tenantId: input.tenantId,
      profileId: input.targetProfileId,
      kind: "follow",
      category: "social",
      title: `${actors} ${verb}`,
      body: null,
      // Con una sola persona, al perfil de esa persona. Agrupado, al perfil
      // propio: mandar a la ficha del último de veinte sería arbitrario.
      href: total === 1 ? `/perfil/${input.followerId}` : "/perfil",
      group: { subjectKind: "profile", subjectId: input.targetProfileId },
    });
  } catch (error) {
    console.warn("[notificaciones] aviso de seguidor no emitido:", {
      message: error instanceof Error ? error.message : "error desconocido",
    });
  }
}
