import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Canal "app de Android" (la TWA de Google Play, `android-twa/`).
 *
 * Google Play no deja vender bienes digitales (impulsos, check azul, membresías,
 * Presencia Verificada) con un cobro propio dentro de una app de Play, ni
 * mandar a pagar afuera sin estar inscripto en su programa de links externos.
 * Por eso, adentro de la app, las pantallas de compra muestran un aviso en vez
 * del flujo de Stripe. En el navegador todo sigue igual.
 *
 * Cómo se detecta, antes del primer paint y sin flash: la TWA abre
 * `/feed?origen=android` (launchUrl en android-twa) y Chrome manda el referrer
 * `android-app://com.comunidadlatina.app`. Se guarda en sessionStorage y NO en
 * una cookie a propósito: la TWA comparte cookies con el Chrome del celular, y
 * con cookie las compras quedarían escondidas también en el navegador normal.
 * sessionStorage es por pestaña, y la TWA es su propia pestaña.
 */

const CANAL_KEY = "cl-canal";
const ANDROID_PACKAGE = "com.comunidadlatina.app";

export const canalScriptSource = `(function(){try{var s=window.sessionStorage,q=new URLSearchParams(location.search);if(q.get("origen")==="android"||document.referrer.indexOf("android-app://${ANDROID_PACKAGE}")===0){s.setItem("${CANAL_KEY}","android")}if(s.getItem("${CANAL_KEY}")==="android"){document.documentElement.setAttribute("data-canal","android")}}catch(e){}})();`;

export function CanalScript() {
  return <script dangerouslySetInnerHTML={{ __html: canalScriptSource }} />;
}

/**
 * Envuelve una pantalla de compra. El CSS de globals.css (`[data-solo-web]`,
 * `[data-aviso-app]`) decide qué se ve según `html[data-canal]`.
 */
export function SoloEnLaWeb({ children }: { children: ReactNode }) {
  return (
    <>
      <div data-solo-web className="contents">
        {children}
      </div>
      <div data-aviso-app className="hidden px-4 py-10">
        <div className="mx-auto max-w-md rounded-2xl border border-border-subtle bg-surface p-6">
          <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
            Esto se contrata desde la web
          </h1>
          <p className="mt-3 leading-relaxed text-foreground-secondary">
            Los impulsos, la verificación y los planes se contratan en comunidadlatina.com, desde
            el navegador de tu celular o de tu computadora, con esta misma cuenta. Lo que contrates
            también se ve acá en la app.
          </p>
          <Link
            href="/feed"
            className="mt-6 inline-flex min-h-11 items-center font-medium text-brand-ink underline decoration-brand-subtle underline-offset-2 hover:decoration-brand-ink"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </>
  );
}
