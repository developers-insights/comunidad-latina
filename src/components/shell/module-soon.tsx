import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, buttonVariants } from "@/components/ui";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ModuleItem } from "./modules";

/**
 * La pantalla de un módulo que todavía no abrió.
 *
 * Es lo que el cliente describió literalmente: «cuando le dan al Creator
 * Marketplace, dice: viene muy pronto». La cápsula del menú y de /buscar sigue
 * siendo un enlace REAL a la ruta del módulo, y es esta pantalla la que aparece
 * en su lugar. Que sea una ruta y no un control muerto compra tres cosas de
 * golpe: el botón atrás del sistema funciona, el link se puede compartir, y el
 * día que la sección abra la MISMA URL sirve el módulo de verdad sin que nadie
 * tenga que actualizar un enlace.
 *
 * Tono de promesa, no de error: nadie se equivocó, la sección todavía no abrió.
 * Por eso no hay ícono de alerta, ni rojo, ni "no disponible" — hay el ícono 3D
 * del propio módulo, su acento, y una salida a las categorías que SÍ están.
 */
export function ModuleSoon({ item }: { item: ModuleItem }) {
  const IconComponent = item.icon;

  return (
    <BezelCard
      variant="featured"
      className="w-full"
      coreClassName="flex flex-col items-center gap-4 px-6 py-10 text-center"
    >
      <span
        aria-hidden="true"
        className="flex size-20 items-center justify-center overflow-hidden rounded-2xl"
        style={{ backgroundColor: item.palette.chip }}
      >
        {item.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- ícono 3D local del set del menú, sin impacto LCP
          <img src={item.image} alt="" width={80} height={80} className="size-full object-cover" />
        ) : (
          <IconComponent size={40} weight="light" style={{ color: item.palette.icon }} />
        )}
      </span>

      <div className="flex flex-col items-center gap-1.5">
        {/* El nombre del módulo es el título de la pantalla: la persona tocó
            "Marketplace" y tiene que aterrizar viendo "Marketplace", no un
            cartel genérico que la deje dudando de si se equivocó de lugar. */}
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {item.label}
        </h1>
        <p
          className="text-sm font-semibold"
          style={{ color: `color-mix(in oklab, ${item.palette.icon} 72%, var(--color-foreground))` }}
        >
          {t("nav", "moduleSoonBadge")}
        </p>
      </div>

      <p className="max-w-[38ch] text-sm leading-relaxed text-foreground-secondary">
        {t("sections", "soonMessage")}
      </p>

      {/* Nunca un callejón sin salida: de acá se sale a las categorías abiertas. */}
      <Link
        href="/buscar"
        className={cn(buttonVariants({ variant: "secondary", size: "md" }), "mt-1 gap-2")}
      >
        {t("sections", "soonAction")}
        <ArrowRight size={16} weight="bold" aria-hidden="true" />
      </Link>
    </BezelCard>
  );
}
