import { Suspense } from "react";
import Link from "next/link";
import {
  BookOpenText,
  CaretRight,
  HandHeart,
  Lifebuoy,
  MagnifyingGlass,
} from "@phosphor-icons/react/dist/ssr";
import { Skeleton, bubbleStyle } from "@/components/ui";
import { COMUNIDAD_ACCENT, ComunidadHeading, OrigenNota } from "@/components/comunidad";
import { COMUNIDAD_COPY } from "@/lib/comunidad";
import { getTenant } from "@/lib/tenant/resolve";
import { cn } from "@/lib/utils";
import { countOpenCases } from "../queries";

export const metadata = { title: "Comunidad" };

const C = COMUNIDAD_COPY.index;

/**
 * ÍNDICE DEL MÓDULO COMUNIDAD.
 *
 * Antes esta ruta redirigía a /feed («la Comunidad ya vive en el feed social»).
 * Ya no: el cliente pidió una sección propia, con información de la comunidad y
 * ayuda mutua. Los enlaces viejos a /comunidad ahora aterrizan acá, que es un
 * destino mejor que el que tenían.
 *
 * ── POR QUÉ TRES PUERTAS Y NO UNA LISTA ─────────────────────────────────────
 * Son tres cosas con tres urgencias distintas: buscar ayuda AHORA (recursos),
 * entender un trámite con tiempo (guías) y el ida y vuelta del barrio (perdido
 * y encontrado). Mezclarlas en un solo listado obliga a leer todo para
 * encontrar una. Tres tiles grandes, en ese orden, y el aviso de procedencia
 * arriba de todo: quien entra asustado tiene que saber de entrada que lo que va
 * a leer no se lo inventamos nosotros.
 */
export default async function ComunidadPage() {
  return (
    <>
      <ComunidadHeading
        icon={<HandHeart size={30} weight="fill" aria-hidden="true" />}
        title={C.title}
        subtitle={C.subtitle}
      />

      <p className="mt-4 text-sm leading-relaxed text-foreground-secondary">{C.intro}</p>

      <OrigenNota className="mt-5" incluirMigracion />

      <nav aria-label={C.title} className="mt-6 flex flex-col gap-3">
        <Puerta
          href="/comunidad/recursos"
          icon={<Lifebuoy size={26} weight="fill" aria-hidden="true" />}
          title={C.cards.recursos.title}
          hint={C.cards.recursos.hint}
        />
        <Puerta
          href="/comunidad/guias"
          icon={<BookOpenText size={26} weight="fill" aria-hidden="true" />}
          title={C.cards.guias.title}
          hint={C.cards.guias.hint}
        />
        <Puerta
          href="/comunidad/perdidos"
          icon={<MagnifyingGlass size={26} weight="bold" aria-hidden="true" />}
          title={C.cards.perdidos.title}
          hint={C.cards.perdidos.hint}
          badge={
            <Suspense fallback={<Skeleton className="h-5 w-20 rounded-full" />}>
              <CasosAbiertos />
            </Suspense>
          }
        />
      </nav>
    </>
  );
}

/**
 * El contador va en su propio Suspense: es lo único de esta pantalla que
 * consulta la base, y no puede retrasar el render de tres enlaces que ya se
 * conocen. Si la consulta falla, el contador no aparece — nunca un cero que
 * mienta diciendo que no hay casos.
 */
async function CasosAbiertos() {
  const tenant = await getTenant();
  const abiertos = await countOpenCases(tenant.id);
  if (abiertos === 0) return null;

  return (
    <span className="inline-flex items-center rounded-full bg-[color-mix(in_oklab,var(--accent-comunidad)_18%,var(--color-surface))] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-foreground">
      {abiertos === 1 ? "1 caso abierto" : `${abiertos} casos abiertos`}
    </span>
  );
}

function Puerta({
  href,
  icon,
  title,
  hint,
  badge,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  hint: string;
  badge?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      style={bubbleStyle(COMUNIDAD_ACCENT)}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl border p-4",
        "border-[var(--bubble-line)] bg-[var(--bubble-fill)]",
        "shadow-[inset_0_1px_0_var(--cl-bezel-highlight)]",
        "transition-[background-color,transform] duration-(--duration-fast) ease-(--ease-spring)",
        "active:scale-[0.99] hover:bg-[var(--bubble-fill-strong)]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center rounded-md bg-[var(--bubble-wash)] text-[var(--bubble-ink)]"
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-display text-base font-semibold leading-snug text-foreground">
            {title}
          </span>
          {badge}
        </span>
        <span className="mt-0.5 block text-sm leading-relaxed text-foreground-secondary">
          {hint}
        </span>
      </span>

      <CaretRight
        size={18}
        weight="bold"
        aria-hidden="true"
        className="shrink-0 text-foreground-muted transition-transform duration-(--duration-fast) group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
      />
    </Link>
  );
}
