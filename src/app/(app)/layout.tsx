import type { ReactNode } from "react";
import { getTenant } from "@/lib/tenant/resolve";
import { Header } from "@/components/shell/header";
import { BottomNav } from "@/components/shell/bottom-nav";
import { getShellContext } from "@/components/shell/shell-context";
import { CommentsSheetProvider, MediaViewerProvider, PostComposerHost } from "@/components/feed";
import { ViewerTimeZoneProvider } from "@/components/time/viewer-time-zone";
import { getViewerAccount } from "@/lib/time/viewer-zone";
import { OfflineBanner } from "@/components/shell/offline-banner";
import { AccountGate } from "@/components/shell/account-gate";
import { InstallPrompt } from "@/components/pwa/install-prompt";

/**
 * Shell de la app autenticada: Header + contenido mobile-first centrado + BottomNav.
 * Las CSS variables de marca ya viven en <html> (root layout) y el fondo/texto
 * en <body> — acá solo queda la estructura.
 *
 * Gate de sanciones (0021): una cuenta suspendida vigente o dada de baja ve la
 * pantalla de AccountGate en lugar de la app. Espeja app.account_active() de la
 * DB (que ya bloquea toda escritura por trigger): suspended con vencimiento
 * futuro o sin vencimiento → bloquea; suspensión vencida → pasa (la DB también
 * la trata como activa).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const [tenant, shell, viewer] = await Promise.all([
    getTenant(),
    getShellContext(),
    /**
     * UNA sola lectura de quien mira, para dos cosas que antes eran dos.
     *
     * El gate de sanciones necesitaba `account_status` y `suspended_until`; la
     * zona horaria necesitaba `timezone`. Son tres columnas de la MISMA fila de
     * `profiles`, y cada consulta traía además su propio `auth.getUser()`: dos
     * viajes de más en el camino que corre en cada navegación de la app. Ahora
     * `getViewerAccount()` las trae juntas, memoizada por request — así que las
     * pantallas que después piden `getViewerTimeZone()` para formatear una
     * fecha no vuelven a tocar la DB.
     */
    getViewerAccount(),
  ]);

  if (viewer?.accountStatus === "banned") {
    return <AccountGate kind="banned" />;
  }
  if (
    viewer?.accountStatus === "suspended" &&
    (!viewer.suspendedUntil || new Date(viewer.suspendedUntil) > new Date())
  ) {
    return <AccountGate kind="suspended" suspendedUntil={viewer.suspendedUntil} />;
  }

  return (
    /**
     * La zona horaria de quien mira, a nivel shell: cualquier client component
     * de cualquier pantalla puede pedirla con `useViewerTimeZone()` sin que se
     * la pasen por props. Es un provider de contexto puro — no renderiza nada,
     * no agrega un nodo al DOM y no hace ninguna consulta propia (la zona ya
     * vino resuelta arriba). Ver `components/time/viewer-time-zone.tsx`.
     */
    <ViewerTimeZoneProvider preferred={viewer?.timezone ?? null}>
    {/* Overlays sociales (visor de medios + sheet de comentarios) a nivel shell:
        cualquier card de cualquier página los abre sin remontar nada. */}
    <MediaViewerProvider>
    <CommentsSheetProvider>
    {/* Estado de "publicar" a nivel shell (2026-08-13): la tarjeta del feed
        (ComposerTrigger, adentro de `children`) y el "+" de BottomNav son dos
        disparadores del MISMO menú — antes el "+" navegaba a /feed?crear=… y
        perdía el gesto de usuario que abre el selector de archivos en Safari.
        Ver el docblock de post-composer.tsx. */}
    <PostComposerHost modules={tenant.modules} modulesSoon={tenant.modulesSoon}>
    <div className="flex min-h-dvh flex-col">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-lg focus:ring-[3px] focus:ring-focus-ring"
      >
        Saltar al contenido
      </a>
      <OfflineBanner />
      {/* El sticky vive acá y no en el <header> para no acoplar el componente
          a su posición en el shell (ver comentario en shell/header.tsx). */}
      <div className="sticky top-0 z-40">
        <Header tenant={tenant} />
      </div>
      {/* Acá vivía <TenantMismatchBanner />. Se eliminó el 2026-08-13: avisaba
          de un problema de configuración nuestro con palabras que le pedían al
          usuario que lo resolviera. Ver la nota al final de lib/tenant/guard.ts. */}
      <main
        id="contenido"
        tabIndex={-1}
        className="mx-auto w-full max-w-lg flex-1 px-4 pb-28 pt-4 focus:outline-none"
      >
        {children}
      </main>
      {/* La barra esconde la pestaña de un módulo apagado — la config del tenant
          baja como props planas desde acá (ver bottom-nav.tsx). `unread` pinta
          el punto de Ajustes (que es donde viven las notificaciones desde que se
          eliminó el menú lateral) y `canCreate` decide si el "+" abre el menú de
          publicar o lleva a entrar. `getShellContext` está memoizado por
          request: el Header pide lo mismo y la DB se consulta una sola vez. */}
      <BottomNav
        modules={tenant.modules}
        modulesSoon={tenant.modulesSoon}
        canCreate={Boolean(viewer)}
        unread={shell.unread}
      />
      <InstallPrompt />
    </div>
    </PostComposerHost>
    </CommentsSheetProvider>
    </MediaViewerProvider>
    </ViewerTimeZoneProvider>
  );
}
