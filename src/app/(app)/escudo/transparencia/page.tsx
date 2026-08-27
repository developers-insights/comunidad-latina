import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardText } from "@phosphor-icons/react/dist/ssr";
import { BezelCard, EmptyState, buttonVariants } from "@/components/ui";
import { BackLink } from "@/components/escudo/back-link";
import { CasoCard } from "@/components/escudo/caso-card";
import { CifraFila } from "@/components/escudo/cifra-fila";
import {
  MINIMO_PARA_MEDIANA,
  cifrasDelPanel,
  describirVentana,
  esperaTipica,
  formatearEntero,
  hayPocaHistoria,
} from "@/lib/escudo/transparencia";
import { getTenant } from "@/lib/tenant/resolve";
import { DatosSkeleton } from "./datos-skeleton";
import { TRANSPARENCIA_ENABLED } from "../feature-flag";
import { getDatosDeTransparencia } from "./datos";

/**
 * /escudo/transparencia — la mitad que le faltaba al Escudo.
 *
 * Las otras cuatro pantallas del módulo ENSEÑAN (aprender), RECIBEN (reportar),
 * CONSULTAN (verificar) y EXPLICAN (trust-score). Ninguna muestra evidencia de
 * que del otro lado esté pasando algo, y una plataforma de seguridad que no
 * muestra evidencia le está pidiendo a la gente exactamente lo que le enseña a
 * no dar: confianza sin verificar.
 *
 * ── LA REGLA DE ESTA PANTALLA ───────────────────────────────────────────────
 * Ningún número se escribe a mano. Todos salen de `escudo_transparencia()`
 * (0122), que agrega sobre las tablas reales. Cuando no se pueden leer, la
 * pantalla lo DICE — no muestra ceros. Un cero inventado acá es peor que un
 * error visible: tranquiliza.
 *
 * ── Y LA QUE LA HACE POSIBLE ────────────────────────────────────────────────
 * Con esta base los números son chicos. Eso no es un problema a maquillar: es el
 * estado real de una comunidad joven, y decirlo con esas palabras es la única
 * versión de esta pantalla que sirve para lo que existe. Por eso "todavía
 * tenemos poca historia" es un estado de primera clase, con su propio cartel y
 * su propio tono, y no un caso de error.
 *
 * Se respeta la doctrina legal-safe (`src/lib/comunidad/copy.ts`): en todo el
 * archivo no hay una sola frase que prometa seguridad ni que diga "estás
 * protegido". Se dice qué hace el sistema y qué NO hace, con la misma honestidad
 * con la que /escudo ya dice que una verificación es un dato de registro público
 * y no un aval.
 */

const COPY = {
  back: "Volver al inicio",
  title: "Cómo viene funcionando el Escudo",
  lead: "Acá está lo que pasó de verdad en la comunidad. Los números salen solos de la base — nadie los escribe a mano.",

  what: "Contamos lo que el sistema vio: denuncias que alguien se tomó el trabajo de hacer, avisos que se sacaron de circulación y matrículas que consultamos en registros oficiales.",
  whatNot:
    "Una estafa que nadie denunció no aparece acá. Y ningún número de esta pantalla significa que estés protegido: la regla sigue siendo una sola — nunca envíes dinero por adelantado.",

  numerosTitle: "Los números",
  numerosNota: "Se recalculan cada 15 minutos.",

  pocaHistoriaTitle: "Todavía tenemos poca historia",
  pocaHistoriaBody:
    "Esta comunidad es nueva. Los números de acá abajo son los de verdad, y son chicos porque todavía pasó poco — no porque estemos escondiendo algo. Van a crecer solos a medida que la comunidad use la app.",

  sinNumerosTitle: "Ahora mismo no podemos mostrarte los números",
  sinNumerosBody:
    "No pudimos leerlos, y preferimos decírtelo antes que mostrarte ceros que no significan nada. Probá de nuevo en un rato.",

  esperaLabel: "Tiempo de revisión",
  esperaSinMuestraTitle: "Todavía no podemos darte un tiempo honesto",

  casosTitle: "Casos de seguridad",
  casosLead:
    "Intentos de estafa contados en corto: qué pasó, qué los delató y qué hacer si te toca a vos.",
  casosAnonimato:
    "Ninguno de estos casos está atado a una cuenta. No guardamos el vínculo entre lo que leés acá y la denuncia que le dio origen: sin nombres, sin fotos, sin fechas exactas y sin nada que permita reconocer a quien denunció ni a quien fue denunciado. Un caso es una lección, no un expediente.",
  casosVacioTitle: "Todavía no publicamos casos",
  casosVacioBody:
    "Cuando el equipo documente un patrón nuevo, va a aparecer acá. Mientras tanto, las cinco señales de alerta más comunes están explicadas con ejemplos.",
  casosVacioCta: "Ver las guías de la comunidad",

  ctaTitle: "¿Viste algo raro?",
  ctaBody:
    "Denunciá desde el menú «···» de la publicación: son dos toques y no le llega nada a quien publicó. Una denuncia tuya es lo que hace que estos números signifiquen algo.",
  ctaAprender: "Ver las guías de la comunidad",
} as const;

export const metadata: Metadata = { title: COPY.title };

function SeccionTitulo({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="font-display text-lg font-semibold text-foreground">
      {children}
    </h2>
  );
}

/**
 * ── POR QUÉ EL ESQUELETO VIVE ACÁ ADENTRO Y NO EN UN `loading.tsx` ──────────
 *
 * Había uno, y `src/app/loading-boundaries.test.ts` lo rechazó con razón: un
 * `loading.tsx` cubre el segmento ENTERO, incluido el `notFound()` de arriba.
 * O sea que con la feature apagada la persona veía dibujarse la silueta de una
 * pantalla completa —cifras, casos, todo— para recibir un 404 medio segundo
 * después. El esqueleto es una promesa de "esto ya viene": ponerlo encima de
 * algo que puede no existir es mentir con una animación.
 *
 * Partido en dos, cada mitad hace lo suyo: el guard del interruptor y la
 * cabecera son síncronos y se pintan de una (un 404 sale instantáneo, sin
 * silueta previa), y el `<Suspense>` cubre SÓLO lo que espera a la base. De
 * paso la cabecera y el bloque de honestidad —que es donde se dice qué NO
 * medimos— aparecen antes que los números, que es el orden en que conviene
 * leerlos.
 */
async function DatosDeTransparencia() {
  const tenant = await getTenant();
  const { metricas, casos } = await getDatosDeTransparencia(tenant);
  const espera = metricas ? esperaTipica(metricas) : null;

  return (
    <>

      <section aria-labelledby="tr-numeros" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <SeccionTitulo id="tr-numeros">{COPY.numerosTitle}</SeccionTitulo>
          {metricas && (
            <p className="text-xs text-foreground-muted">
              {describirVentana(metricas.ventanaDias)} · {COPY.numerosNota}
            </p>
          )}
        </div>

        {metricas === null ? (
          // NO se rellena con ceros. Ver la cabecera del archivo.
          <BezelCard coreClassName="p-5">
            <h3 className="font-display text-base font-semibold text-foreground">
              {COPY.sinNumerosTitle}
            </h3>
            <p className="mt-1 text-sm text-foreground-secondary">{COPY.sinNumerosBody}</p>
          </BezelCard>
        ) : (
          <>
            {hayPocaHistoria(metricas) && (
              <div className="rounded-lg bg-brand-tint px-4 py-3.5">
                <h3 className="font-display text-base font-semibold text-brand-ink">
                  {COPY.pocaHistoriaTitle}
                </h3>
                <p className="mt-1 text-sm text-foreground-secondary">
                  {COPY.pocaHistoriaBody}
                </p>
              </div>
            )}

            <BezelCard coreClassName="px-5 py-4">
              <ul className="divide-y divide-border-subtle">
                {cifrasDelPanel(metricas).map((cifra) => (
                  <CifraFila key={cifra.clave} cifra={cifra} />
                ))}
              </ul>
            </BezelCard>

            {/* El tiempo de revisión va aparte porque es la única cifra que
                puede NO existir: con menos de cinco revisiones cerradas, una
                mediana es una anécdota con forma de estadística. */}
            <BezelCard coreClassName="p-5">
              {espera?.estado === "conocida" ? (
                <>
                  <p className="font-display text-3xl font-bold tabular-nums text-brand-ink">
                    {espera.texto}
                  </p>
                  <h3 className="mt-1 font-display text-base font-semibold text-foreground">
                    {COPY.esperaLabel}
                  </h3>
                  <p className="mt-0.5 text-sm text-foreground-secondary">
                    La mitad de las revisiones se resolvió en menos de eso, sobre{" "}
                    {formatearEntero(espera.resueltas)} revisiones cerradas en{" "}
                    {describirVentana(metricas.ventanaDias)}.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="font-display text-base font-semibold text-foreground">
                    {COPY.esperaSinMuestraTitle}
                  </h3>
                  <p className="mt-1 text-sm text-foreground-secondary">
                    {espera && espera.resueltas > 0
                      ? `Llevamos ${formatearEntero(espera.resueltas)} revisiones cerradas. Con menos de ${MINIMO_PARA_MEDIANA}, un solo caso raro escribiría el número, así que preferimos no publicarlo.`
                      : `Todavía no cerramos ninguna revisión en ${describirVentana(metricas.ventanaDias)}. Cuando haya al menos ${MINIMO_PARA_MEDIANA}, el tiempo va a aparecer acá.`}
                  </p>
                </>
              )}
            </BezelCard>
          </>
        )}
      </section>

      <section aria-labelledby="tr-casos" className="flex flex-col gap-3">
        <div>
          <SeccionTitulo id="tr-casos">{COPY.casosTitle}</SeccionTitulo>
          <p className="mt-1 text-sm text-foreground-secondary">{COPY.casosLead}</p>
        </div>

        {/* El compromiso de anonimato, antes de los casos y no en letra chica al
            final: quien duda de si esto expone a alguien tiene que leerlo ANTES
            de leer el primer relato. */}
        <p className="rounded-lg bg-surface-subtle px-4 py-3.5 text-sm text-foreground-secondary">
          {COPY.casosAnonimato}
        </p>

        {casos.length === 0 ? (
          <EmptyState
            icon={<ClipboardText />}
            title={COPY.casosVacioTitle}
            message={COPY.casosVacioBody}
            action={
              <Link
                href="/comunidad/guias"
                className={buttonVariants({ variant: "secondary", size: "md" })}
              >
                {COPY.casosVacioCta}
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {casos.map((caso) => (
              <CasoCard key={caso.id} caso={caso} />
            ))}
          </div>
        )}
      </section>

      <section
        aria-labelledby="tr-cta"
        className="rounded-lg bg-surface-subtle px-4 py-4 text-sm"
      >
        <h2 id="tr-cta" className="font-display text-base font-semibold text-foreground">
          {COPY.ctaTitle}
        </h2>
        <p className="mt-1 text-foreground-secondary">{COPY.ctaBody}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/comunidad/guias"
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {COPY.ctaAprender}
          </Link>
        </div>
      </section>
    </>
  );
}

export default function TransparenciaPage() {
  if (!TRANSPARENCIA_ENABLED) notFound();

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/feed" label={COPY.back} />

      <header className="flex flex-col items-center gap-3 text-center">
        {/* Ícono de línea y NO el emblema del escudo verde: en este producto el
            escudo verde significa "protegido", y ésta es justamente la pantalla
            que no puede insinuar eso. Un registro anotado dice lo que hay. */}
        <span
          aria-hidden="true"
          className="flex size-16 items-center justify-center rounded-full bg-brand-tint text-brand-ink"
        >
          <ClipboardText size={32} />
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-balance text-foreground">
          {COPY.title}
        </h1>
        <p className="max-w-[38ch] text-sm text-foreground-secondary">{COPY.lead}</p>
      </header>

      {/* Qué contamos y qué NO — arriba, donde se lee. Mismo lugar y mismo trato
          que el bloque de honestidad del índice del Escudo: un descargo que hay
          que ir a buscar es un descargo que nadie leyó. */}
      <div className="rounded-lg bg-surface-subtle px-4 py-3.5 text-sm text-foreground-secondary">
        <p>{COPY.what}</p>
        <p className="mt-2 font-medium text-foreground">{COPY.whatNot}</p>
      </div>

      <Suspense fallback={<DatosSkeleton />}>
        <DatosDeTransparencia />
      </Suspense>
    </div>
  );
}
