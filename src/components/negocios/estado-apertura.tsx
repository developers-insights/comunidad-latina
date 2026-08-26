import { CheckCircle, MoonStars } from "@phosphor-icons/react/dist/ssr";
import { Chip } from "@/components/ui";
import {
  HORARIO_COPY as C,
  NOMBRE_DIA,
  esVeinticuatroHoras,
  type EstadoApertura,
} from "@/lib/horarios";
import { cn } from "@/lib/utils";

/**
 * "Abierto ahora" / "Cerrado ahora" — versión de LISTADO, sin JavaScript.
 *
 * ── POR QUÉ EXISTE APARTE DE `HorarioEstado` ────────────────────────────────
 * `HorarioEstado` es un client component con un `setInterval` de un minuto, y
 * eso está bien en la FICHA de un negocio: una ficha abierta queda horas en
 * pantalla y a las 18:01 tiene que dejar de decir "Abierto". En un listado de
 * treinta tarjetas ese mismo componente serían treinta intervalos corriendo en
 * paralelo por una etiqueta de dos palabras — el costo no se parece al valor.
 *
 * Acá el estado llega ya calculado por el servidor (`lib/negocios/horarios.ts`,
 * con la MISMA función pura `estadoDeApertura`) y se pinta y se queda quieto. La
 * página es dinámica, así que cada visita lo recalcula; lo único que se pierde
 * es que la etiqueta cambie sola mientras alguien mira la lista sin tocar nada.
 * Quien abre la ficha —el paso en que la información importa de verdad— sí
 * recibe el chip que se refresca.
 *
 * ── EL COLOR NO ES EL DATO ──────────────────────────────────────────────────
 * Verde y gris acompañan, no informan: cada estado lleva su palabra y su ícono,
 * así que alguien que no distingue esos dos colores lee exactamente lo mismo.
 */
export interface EstadoAperturaChipProps {
  estado: EstadoApertura | null | undefined;
  /** Sumar la hora de cierre / la próxima apertura al lado del chip. */
  conDetalle?: boolean;
  className?: string;
}

export function EstadoAperturaChip({
  estado,
  conDetalle = true,
  className,
}: EstadoAperturaChipProps) {
  // Sin horario cargado o con una zona que el motor no reconoce no se afirma
  // nada. Un "Cerrado" inventado le cuesta clientes a un negocio que atiende.
  if (!estado || estado.estado === "sin_horario" || estado.estado === "zona_desconocida") {
    return null;
  }

  if (estado.estado === "abierto") {
    const todoElDia = esVeinticuatroHoras(estado.tramo);
    return (
      <span className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}>
        <Chip variant="success" size="sm" icon={<CheckCircle weight="fill" />}>
          {C.abierto}
        </Chip>
        {conDetalle && (
          <span className="truncate text-xs text-foreground-secondary">
            {todoElDia ? C.veinticuatroHoras : C.cierraA(estado.cierraA)}
          </span>
        )}
      </span>
    );
  }

  // El DÍA sale de `abreDia`, nunca se asume "hoy": el próximo tramo puede ser
  // el lunes que viene, y "Abre hoy a las 9" en un local cerrado hasta el lunes
  // es la clase de dato que hace que alguien viaje al vacío.
  const diaQueAbre = estado.abreDia !== null ? NOMBRE_DIA[estado.abreDia] : null;

  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <Chip variant="neutral" size="sm" icon={<MoonStars />}>
        {C.cerrado}
      </Chip>
      {conDetalle && estado.abreA && diaQueAbre && (
        <span className="truncate text-xs text-foreground-secondary">
          {C.abreA(diaQueAbre, estado.abreA)}
        </span>
      )}
    </span>
  );
}
