import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * "Pedir una copia de mis datos" — descarga inmediata en JSON.
 *
 * POR QUÉ EXISTE
 * --------------
 * El RGPD da derecho de acceso (art. 15) y de portabilidad (art. 20: formato
 * "estructurado, de uso común y lectura mecánica"), y la CCPA/CPRA da el
 * "derecho a saber". La app ya tenía el borrado de cuenta; esto era la mitad
 * que faltaba. Un formulario de "escribinos y te contestamos en 30 días"
 * cumple, pero para esta comunidad —gente que quizás no escribe correos
 * formales en inglés ni en español— un botón es la diferencia entre tener el
 * derecho y poder ejercerlo.
 *
 * POR QUÉ ES SEGURO
 * -----------------
 * Usa el cliente con LA SESIÓN DE LA PERSONA, no el service role. O sea que
 * hay dos barreras independientes y cualquiera de las dos alcanza:
 *   1. El filtro explícito por la columna de dueño de cada tabla.
 *   2. Las policies de RLS, que igual no devolverían filas ajenas.
 * Nunca se usa `service_role` acá: un error de filtro con service_role sería
 * una fuga masiva; con la sesión del usuario, es como mucho una consulta vacía.
 */

/** Tabla → columna que dice de quién es la fila. Verificado contra
 *  `src/lib/types/database.types.ts`. */
const OWNED_TABLES = [
  ["profiles", "id"],
  ["profiles_private", "profile_id"],
  ["posts", "author_id"],
  ["comments", "author_id"],
  ["listings", "created_by"],
  ["messages", "sender_id"],
  ["saves", "profile_id"],
  ["reactions", "profile_id"],
  ["follows", "follower_id"],
  ["notifications", "profile_id"],
  ["notification_prefs", "profile_id"],
  ["job_applications", "applicant_id"],
  ["trust_scores", "profile_id"],
] as const;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  }

  const data: Record<string, unknown> = {};
  const problemas: string[] = [];

  for (const [table, ownerColumn] of OWNED_TABLES) {
    // @ts-expect-error — el nombre de tabla es dinámico a propósito: mantener
    // la lista como datos es lo que hace que agregar una tabla sea una línea.
    const { data: rows, error } = await supabase.from(table).select("*").eq(ownerColumn, user.id);

    if (error) {
      // Una tabla que falla NO puede tumbar la exportación entera: es peor
      // entregar nada que entregar 12 de 13 tablas diciendo cuál faltó.
      //
      // El mensaje crudo de Postgres NO va al archivo: describe el esquema y las
      // policies, y este archivo lo descarga la persona y lo puede reenviar a
      // cualquiera. Al servidor sí, que es donde se diagnostica.
      console.error("[exportar] tabla omitida", { table, code: error.code });
      problemas.push(table);
      continue;
    }
    data[table] = rows ?? [];
  }

  const payload = {
    _acerca_de_este_archivo: {
      descripcion:
        "Copia de los datos asociados a tu cuenta en Comunidad Latina, en el momento de la descarga.",
      generado: new Date().toISOString(),
      cuenta: { id: user.id, email: user.email },
      que_no_incluye: [
        "Las fotos y archivos que subiste: están en los enlaces que aparecen dentro de tus publicaciones.",
        "Los mensajes que te escribieron otras personas: son datos de ellas, no tuyos.",
        "Tu documento de identidad, si alguna vez lo verificaste: nunca llegó a nuestros servidores, lo procesa Stripe.",
      ],
      ...(problemas.length > 0 ? { no_se_pudo_exportar: problemas } : {}),
    },
    datos: data,
  };

  const fecha = new Date().toISOString().slice(0, 10);

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="mis-datos-comunidad-latina-${fecha}.json"`,
      // Una copia de datos personales no se cachea en ningún lado del camino.
      "cache-control": "no-store, max-age=0",
    },
  });
}
