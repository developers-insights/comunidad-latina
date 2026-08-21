"use client";

import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { BottomSheet, Skeleton } from "@/components/ui";
import { safeInternalPath } from "@/lib/url/safe-href";
import { useCloseOnBack } from "@/lib/design/use-overlay";
import type { OAuthProvider } from "@/lib/auth/oauth-providers";
import { AUTH_SHEET_COPY, type AuthSheetStep } from "./auth-sheet-copy";

export { AUTH_REASON } from "./auth-sheet-copy";

/**
 * HOJA DE ENTRADA IN-SITU — entrar sin salir de la pantalla.
 *
 * Nace del mismo reclamo que ya había parido la hoja de comentarios, repetido
 * ahora sobre el gate de sesión (feedback cliente 2026-08-20): "cuando querés
 * comentar una publicación no te tiene que mover a otra publicación; ahí nomás
 * dentro de pantalla se tiene que fluir sin sacarte del feed; si no es como que
 * te corta el mambo. Mientras menos pasos mejor."
 *
 * Lo que había era peor que "una pantalla de más": el composer hacía
 * `router.push('/entrar?next=/feed/[postId]')`, así que la persona salía del
 * feed Y volvía al DETALLE de la publicación — perdía el scroll, perdía el hilo
 * abierto, y aterrizaba en una pantalla donde nunca había estado.
 *
 * ── EL CONTRATO ──────────────────────────────────────────────────────────────
 * Las islas del feed llaman `useRequireAuth()(…)` y siguen su vida. La hoja se
 * encarga de abrir, autenticar, cerrar, refrescar la sesión del servidor y
 * REANUDAR la acción original. Nadie más vuelve a escribir un push a /entrar.
 *
 * ── POR QUÉ `router.refresh()` NO ROMPE EL SCROLL ────────────────────────────
 * Recién creada la sesión, los Server Components de la ruta siguen renderizados
 * con el viewer ANÓNIMO: hasta refrescarlos, la card sigue creyendo que no hay
 * nadie. `router.refresh()` re-pide el payload RSC de LA RUTA ACTUAL y lo
 * reconcilia en su lugar — no es una navegación: no agrega entrada al
 * historial, no remonta el árbol de cliente y no resetea el scroll. Un
 * `push`/`replace` a la misma URL sí lo haría, y por eso no se usa.
 *
 * ── QUÉ NO PUEDE REANUDAR ────────────────────────────────────────────────────
 * Google/Apple, el enlace mágico y la confirmación de cuenta nueva SE VAN del
 * navegador y vuelven en otra carga. Ahí la acción pendiente se pierde: no hay
 * árbol de React al que volver. Por eso esos tres caminos aterrizan en
 * `resumeDestination()` y no prometen nada más — y por eso el destino lo afina
 * QUIEN ABRE la hoja (`foldPostDetail`) y no el `pathname` solo: para los tres,
 * aterrizar bien es todo lo que hay.
 */

const AuthSheetPanel = lazy(() =>
  import("./auth-sheet-panel").then((m) => ({ default: m.AuthSheetPanel })),
);

export interface RequireAuthArgs {
  /** Título de la hoja: qué estaba intentando hacer. Ver `AUTH_REASON`. */
  reason?: string;
  /**
   * Se ejecuta con la sesión YA creada, después de cerrar la hoja.
   *
   * OJO al escribirlo: corre en el closure de ANTES de entrar, así que las
   * props que bajan del servidor (`viewerId`, `savedByViewer`…) siguen valiendo
   * lo que valían para un anónimo. Tiene que ejecutar el camino autenticado
   * DIRECTO — nunca volver a pasar por el guard `if (!viewerId)`, que lo
   * mandaría de vuelta a esta misma hoja, en bucle.
   */
  onAuthenticated?: () => void;
  /**
   * ¿Plegar `/feed/[id]` al feed en el destino de respaldo? Ver
   * `ResumeDestinationOptions.foldPostDetail`: quien abre la hoja es el único
   * que sabe si la persona ESTABA en esa publicación o si aterrizó ahí de
   * rebote. Ausente = `true`, el comportamiento de siempre.
   */
  foldPostDetail?: boolean;
}

export interface AuthSheetContextValue {
  require: (args?: RequireAuthArgs) => void;
  /**
   * Cuántas sesiones se abrieron desde acá. Arranca en 0 y sube uno por cada
   * autenticación exitosa.
   *
   * Existe porque `router.refresh()` NO alcanza para todo: refresca el árbol
   * del SERVIDOR, pero una hoja que trajo sus datos por su cuenta (la de
   * publicación, la de comentarios) los tiene en estado de cliente y ese
   * refresh no los toca. Sin esto, quien entra desde adentro de una hoja se
   * queda con el payload del anónimo: la hoja le vuelve a pedir sesión aunque
   * ya la tenga y —en un teléfono compartido, que es el caso real de este
   * producto— le puede seguir mostrando el "guardado" y el "me gusta" de la
   * cuenta anterior. Metiendo este número en las dependencias de la carga, la
   * hoja se vuelve a traer sola con la identidad nueva.
   */
  sessionNonce: number;
}

const AuthSheetContext = createContext<AuthSheetContextValue | null>(null);

/**
 * ¿Hay una hoja de entrada abierta ahora mismo?
 *
 * Va en un contexto APARTE del de `require` a propósito: este valor cambia cada
 * vez que la hoja se abre o se cierra, y meterlo en el otro repintaría todas las
 * islas del feed —que sólo necesitan la función, que nunca cambia— en cada
 * apertura. Suscribirse a esto lo hace únicamente quien tiene algo que apagar
 * mientras la hoja está arriba.
 */
const AuthSheetOpenContext = createContext(false);

/**
 * `true` mientras la hoja de entrada está abierta. Sin provider devuelve
 * `false` y quien lo use se comporta igual que antes.
 *
 * Existe por los reels (`/videos`): son pantalla completa con audio, y la hoja
 * es un panel opaco que los tapa. Sin esto, pedirle sesión a alguien lo deja
 * escuchando un video que no ve, detrás de un formulario de entrada.
 */
export function useAuthSheetOpen(): boolean {
  return useContext(AuthSheetOpenContext);
}

/**
 * La hoja, o `null` si el árbol no tiene provider. Devuelve null a propósito
 * (mismo criterio que `useCardLike`): una isla del feed renderizada en un test,
 * en Storybook o en una ruta sin layout no puede explotar por esto.
 *
 * Para llamar desde el feed va `useRequireAuth()`, que además trae el camino de
 * respaldo. Éste es el hook crudo, el que el layout toma como contrato.
 */
export function useAuthSheet(): AuthSheetContextValue | null {
  return useContext(AuthSheetContext);
}

/**
 * El contador de sesiones abiertas desde la hoja, listo para meter en las
 * dependencias de un `useCallback`/`useEffect` que trae datos.
 *
 * Sin provider devuelve 0 y nunca cambia: quien lo use se comporta igual que
 * antes en un test o en una ruta sin layout.
 */
export function useAuthSessionNonce(): number {
  return useContext(AuthSheetContext)?.sessionNonce ?? 0;
}

export interface ResumeDestinationOptions {
  /**
   * ¿Plegar el detalle de una publicación (`/feed/[id]`) al feed?
   *
   * Ausente = `true`, que es la regla histórica y por eso el default: ningún
   * llamador que no se haya enterado de este parámetro cambia de comportamiento.
   */
  foldPostDetail?: boolean;
}

/**
 * A dónde vuelve la persona cuando el camino NO se resuelve adentro de la hoja
 * (confirmar el correo, enlace mágico, Google/Apple).
 *
 * ── POR QUÉ EL PLIEGUE ES UNA DECISIÓN DEL LLAMADOR ──────────────────────────
 * La regla "el detalle de una publicación se pliega al feed" nació con el
 * composer, que armaba a mano `next=/feed/[postId]` y mandaba al detalle a quien
 * había tocado comentar PARADO EN EL FEED: exactamente lo que el cliente marcó
 * como error ("no te tiene que mover a otra publicación"). Cuando esa regla se
 * mudó a mirar el `pathname` a secas se volvió en contra (revisión 2026-08-20),
 * porque el `pathname` sólo dice `/feed/[id]` cuando la persona ESTÁ en esa
 * página — o sea, cuando abrió un enlace compartido o vino de una notificación.
 * A esa persona el pliegue le come justo lo que fue a ver: toca ♥, entra con
 * Google, vuelve del navegador y la publicación no está.
 *
 * Y son precisamente esos caminos —OAuth, enlace mágico, confirmar cuenta— los
 * que NO pueden reanudar nada, porque se van del navegador y vuelven en otra
 * carga: el destino es lo único que les queda. Por eso quien ABRE la hoja, que
 * es el único que sabe desde qué superficie se tocó, decide con
 * `foldPostDetail`; el `pathname` solo nunca alcanzó para saberlo.
 */
export function resumeDestination(
  pathname: string | null | undefined,
  options: ResumeDestinationOptions = {},
): string {
  /**
   * Default `false` desde la revisión de código del 2026-08-21.
   *
   * Plegar `/feed/[id]` → `/feed` sólo puede dispararse cuando la persona ESTÁ
   * parada en el detalle — y ese es justamente el caso donde plegar está mal:
   * a esa URL se llega abriendo un enlace compartido o una notificación, así
   * que devolverla al feed le borra la publicación que fue a ver. Quien tocó
   * "comentar" desde el feed nunca tuvo ese pathname, así que para él la regla
   * nunca se activaba: el default protegía a un llamador que no existe.
   *
   * Se conserva la opción porque el pliegue sigue siendo lo correcto para
   * quien abre la hoja DESDE una card del feed montada sobre el detalle.
   */
  const { foldPostDetail = false } = options;
  if (!pathname) return "/feed";
  if (foldPostDetail && /^\/feed\/[^/]+/.test(pathname)) return "/feed";
  /**
   * `safeInternalPath` y no un `startsWith("/")` (auditoría 2026-08-20).
   *
   * Hoy el destino que sale de acá lo vuelven a sanear los cinco consumidores
   * antes de redirigir, así que un `//evil.com` no llegaba a ningún lado. Pero
   * eso deja la seguridad en manos de quien llama: el día que alguien use esto
   * para un `router.push` directo, `startsWith("/")` deja pasar `//host` y es
   * un open redirect. La frontera va donde se arma el valor.
   */
  return safeInternalPath(pathname, "/feed");
}

/**
 * Pedir sesión desde una isla del feed. Con provider abre la hoja; sin provider
 * cae a la navegación de siempre, para que el botón nunca quede mudo (una card
 * puede renderizarse fuera del layout de la app, y de hecho lo hace en tests).
 */
export function useRequireAuth(): (args?: RequireAuthArgs) => void {
  const sheet = useAuthSheet();
  const router = useRouter();
  const pathname = usePathname();

  return useCallback(
    (args?: RequireAuthArgs) => {
      if (sheet) {
        sheet.require(args);
        return;
      }
      const next = resumeDestination(pathname, {
        foldPostDetail: args?.foldPostDetail ?? true,
      });
      router.push(`/entrar?next=${encodeURIComponent(next)}`);
    },
    [sheet, router, pathname],
  );
}

export interface AuthSheetProviderProps {
  children: ReactNode;
  /**
   * Proveedores con credenciales, si el layout (Server Component) ya los tiene
   * resueltos. Ausentes, el panel los pide solo al abrirse.
   */
  oauthProviders?: readonly OAuthProvider[];
}

export function AuthSheetProvider({
  children,
  oauthProviders,
}: AuthSheetProviderProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<AuthSheetStep>("login");
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [registeredEmail, setRegisteredEmail] = useState<string | undefined>(
    undefined,
  );
  /**
   * Lo que pidió el ÚLTIMO llamador sobre el pliegue del detalle. Ver
   * `resumeDestination`. Es estado y no ref porque el destino se pinta: viaja al
   * panel, que lo usa para armar los enlaces de OAuth y de correo.
   */
  const [foldPostDetail, setFoldPostDetail] = useState(true);

  /**
   * La acción a reanudar. Va en ref y no en estado: cambiarla no tiene por qué
   * repintar la hoja, y se consume una sola vez (se lee y se limpia) para que un
   * segundo pedido no dispare el reintento del anterior.
   */
  const resumeRef = useRef<(() => void) | null>(null);

  /** Ver `sessionNonce` en AuthSheetContextValue. */
  const [sessionNonce, setSessionNonce] = useState(0);

  const requireAuth = useCallback((args?: RequireAuthArgs) => {
    resumeRef.current = args?.onAuthenticated ?? null;
    setReason(args?.reason);
    setFoldPostDetail(args?.foldPostDetail ?? true);
    setRegisteredEmail(undefined);
    setStep("login");
    setOpen(true);
  }, []);

  /** Cierre SIN sesión: la acción pendiente se descarta, no queda armada. */
  const dismiss = useCallback(() => {
    resumeRef.current = null;
    setOpen(false);
  }, []);

  /**
   * Sesión creada. El orden importa: primero cerrar (la persona ve el resultado
   * enseguida), después refrescar el árbol del servidor para que el viewer deje
   * de ser anónimo, y recién ahí reanudar.
   *
   * La reanudación NO espera al refresh: `signInWithPassword` ya dejó la cookie
   * escrita antes de resolver, así que el server action del reintento ve la
   * sesión aunque el payload RSC todavía esté viajando.
   */
  const onAuthenticated = useCallback(() => {
    const resume = resumeRef.current;
    resumeRef.current = null;
    setOpen(false);
    router.refresh();
    // Para lo que el refresh NO alcanza a tocar: ver `sessionNonce`.
    setSessionNonce((value) => value + 1);
    resume?.();
  }, [router]);

  /**
   * ESCAPE Y "ATRÁS" CON HOJAS APILADAS. Esta hoja se monta ARRIBA de las de
   * publicación y comentarios, y las tres escuchan en `document`.
   *
   * Acá vivía un interceptor propio de Escape en fase de captura con
   * `stopImmediatePropagation`. Se fue (revisión de código 2026-08-20): era el
   * parche de UNA hoja para un problema de TODAS, y sólo sabía defenderse a sí
   * mismo —dos hojas cualesquiera sin esta hoja de por medio seguían cayendo
   * juntas—. El reparto ahora lo hace `useFocusTrap` con una pila LIFO
   * compartida: atiende el teclado la capa de más arriba y nadie más, sin que
   * ninguna hoja tenga que saber quiénes son las otras.
   *
   * Lo que sí queda acá es el otro camino de salida, el que nunca tuvo: el
   * "atrás" del teléfono. Sin él, pedirle sesión a alguien y que toque atrás lo
   * expulsaba de la pantalla en vez de devolverlo a lo que estaba haciendo.
   */
  useCloseOnBack(open, dismiss);

  const value = useMemo<AuthSheetContextValue>(
    () => ({ require: requireAuth, sessionNonce }),
    [requireAuth, sessionNonce],
  );

  const destination = resumeDestination(pathname, { foldPostDetail });
  const title =
    step === "login"
      ? (reason ?? AUTH_SHEET_COPY.defaultReason)
      : AUTH_SHEET_COPY.registerTitle;

  return (
    <AuthSheetContext.Provider value={value}>
      <AuthSheetOpenContext.Provider value={open}>{children}</AuthSheetOpenContext.Provider>
      <BottomSheet
        open={open}
        onClose={dismiss}
        title={step === "check-email" ? undefined : title}
        ariaLabel={step === "check-email" ? AUTH_SHEET_COPY.ariaLabel : undefined}
        // En papel no existe: es un overlay modal sobre toda la página, mismo
        // criterio que la hoja de comentarios y el visor de medios.
        className="cl-print-hide"
        bodyClassName="overflow-y-auto px-6 pb-4 pt-3"
      >
        <Suspense
          fallback={
            <div
              role="status"
              aria-label={AUTH_SHEET_COPY.loading}
              className="flex flex-col gap-3 py-2"
            >
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          }
        >
          <AuthSheetPanel
            step={step}
            onStepChange={setStep}
            destination={destination}
            onAuthenticated={onAuthenticated}
            onDismiss={dismiss}
            registeredEmail={registeredEmail}
            onRegistered={(email) => {
              setRegisteredEmail(email);
              setStep("check-email");
            }}
            {...(oauthProviders ? { oauthProviders } : {})}
          />
        </Suspense>
      </BottomSheet>
    </AuthSheetContext.Provider>
  );
}
