"use client";

/**
 * global-error (§3.5): último recurso — se muestra si falla el ROOT layout,
 * o sea cuando el design system (globals.css, fuentes, providers) puede no
 * existir. Por eso es 100 % autónomo: HTML propio, inline styles, cero
 * imports de componentes. Colores/valores espejo de los tokens cálidos.
 */

const COPY = {
  lang: "es",
  title: "Algo no cargó bien de nuestro lado",
  message: "No es tu culpa. Probá de nuevo en unos segundos.",
  retry: "Reintentar",
} as const;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[app] global-error", { digest: error.digest });

  return (
    <html lang={COPY.lang}>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
          backgroundColor: "#FCFCFB",
          color: "#2B2924",
          fontFamily:
            "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "420px" }}>
          <h1 style={{ fontSize: "22px", lineHeight: 1.3, margin: "0 0 8px" }}>
            {COPY.title}
          </h1>
          <p style={{ fontSize: "15px", lineHeight: 1.6, margin: "0 0 20px", color: "#6B6759" }}>
            {COPY.message}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              minHeight: "44px",
              padding: "0 24px",
              borderRadius: "9999px",
              border: "none",
              backgroundColor: "#1A5EDB",
              color: "#FFFFFF",
              fontSize: "15px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {COPY.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
