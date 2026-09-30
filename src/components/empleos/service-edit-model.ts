import type { JobCardModel } from "@/app/(app)/empleos/queries";
import { requiresArea } from "@/lib/creators/work-mode";
import { etiquetaDeDisponibilidad, etiquetaDePrecioDesde } from "@/lib/empleos/servicios";
import type { ServiceFormValues } from "@/app/(app)/empleos/publicar/service-fields";
import { precioDeServicio } from "@/app/(app)/empleos/publicar/service-fields";

/**
 * Lo que la tarjeta pasa a mostrar apenas el servidor confirma el guardado, sin
 * esperar a que la lista se vuelva a pedir. Usa las mismas funciones que arman
 * las etiquetas en `toJobCardModel`, para que el "antes" y el "después" del
 * refresco lean igual.
 */
export function aplicarEdicionDeServicio(
  service: JobCardModel,
  valores: ServiceFormValues,
  currency: string,
): JobCardModel {
  const precio = precioDeServicio(valores);
  const schedule = valores.schedule.trim() || null;
  return {
    ...service,
    title: valores.title.trim(),
    description: valores.description.trim(),
    workMode: valores.workMode,
    areaLabel: requiresArea(valores.workMode) ? valores.areaLabel.trim() || null : null,
    availabilityLabel: etiquetaDeDisponibilidad({ days: valores.days, schedule }),
    fromPriceLabel: precio.valid
      ? etiquetaDePrecioDesde(precio.amount, currency, valores.payPeriod)
      : null,
  };
}
