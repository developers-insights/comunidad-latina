import { formatListingPrice } from "@/components/listings/helpers";
import { formatMoney } from "@/lib/utils";

/**
 * =============================================================================
 * EL SALARIO EN UNA LÍNEA, CON RANGO
 * =============================================================================
 *
 * La spec pide poder decir "de $18 a $22 la hora". El reparto en la base ya
 * estaba resuelto y NO se toca (ver `lib/empleos/detalles.ts`): el PISO vive en
 * la columna `listings.price_amount` —que es lo que ordena, filtra y formatea
 * toda la app— y sólo el TECHO va a `attrs.salary_max`. Este módulo los vuelve a
 * juntar para mostrarlos.
 *
 * MÓDULO PURO, y a propósito: lo usa una tarjeta (`components/empleos/job-card`)
 * y también una lectura de servidor (`lib/negocios/empleos.ts`, los puestos de un negocio). Ponerle
 * `server-only` lo dejaría fuera del día en que la tarjeta necesite ser cliente.
 *
 * EL SUFIJO DEL PERÍODO VA UNA SOLA VEZ, AL FINAL. "US$ 18/hora a US$ 22/hora"
 * se lee como dos precios distintos; "US$ 18 a US$ 22/hora" se lee como un
 * rango, que es lo que es.
 */
export function etiquetaDeSalario(
  amount: number | null,
  currency: string,
  period: string | null,
  salaryMax: number | null,
): string | null {
  const base = formatListingPrice(amount, currency, period);
  // Sin piso no hay nada que mostrar; un techo menor o igual al piso NO es un
  // rango (`resolveSalaryRange` ya lo normaliza a null al guardar, pero un aviso
  // viejo puede traerlo mal y no vamos a escribir "de 20 a 15").
  if (!base || amount === null || salaryMax === null || salaryMax <= amount) return base;

  const sinPeriodo = formatListingPrice(amount, currency, null) ?? "";
  const sufijo = base.startsWith(sinPeriodo) ? base.slice(sinPeriodo.length) : "";
  return `${sinPeriodo} a ${formatMoney(salaryMax, { currency })}${sufijo}`;
}
