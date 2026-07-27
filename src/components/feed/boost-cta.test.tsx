// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BoostCta } from "./boost-cta";
import { COPY } from "./copy";

/**
 * El CTA de campaña (§6) mapea el vertical de la entidad a su texto y a su
 * destino real (entityHref). La regla dura "solo posts promocionados" la hace
 * cumplir quien lo renderiza (CardPostMedia); acá fijamos el mapeo texto/destino
 * y el respaldo cuando el vertical no tiene página propia.
 */
describe("BoostCta", () => {
  afterEach(cleanup);

  it("propiedad → 'Ver propiedad' al detalle de la propiedad", () => {
    render(<BoostCta kind="property" entityId="p1" postId="post-1" />);
    const link = screen.getByRole("link", { name: COPY.post.boostCta.property });
    expect(link.getAttribute("href")).toBe("/propiedades/p1");
  });

  it("evento → 'Comprar entradas' al detalle del evento", () => {
    render(<BoostCta kind="event" entityId="e1" postId="post-1" />);
    const link = screen.getByRole("link", { name: COPY.post.boostCta.event });
    expect(link.getAttribute("href")).toBe("/eventos/e1");
  });

  it("negocio → 'Ver negocio' al directorio (no hay página por-negocio aún)", () => {
    render(<BoostCta kind="business" entityId="b1" postId="post-1" />);
    const link = screen.getByRole("link", { name: COPY.post.boostCta.business });
    expect(link.getAttribute("href")).toBe("/negocios");
  });

  it("profesional → 'Agendar cita' al detalle del profesional", () => {
    render(<BoostCta kind="professional" entityId="pro1" postId="post-1" />);
    const link = screen.getByRole("link", { name: COPY.post.boostCta.professional });
    expect(link.getAttribute("href")).toBe("/profesionales/pro1");
  });

  it("empleo → 'Postularme' al detalle del aviso (ya tiene página propia)", () => {
    render(<BoostCta kind="job" entityId="j1" postId="post-42" />);
    const link = screen.getByRole("link", { name: COPY.post.boostCta.job });
    expect(link.getAttribute("href")).toBe("/empleos/j1");
  });

  it("kind desconocido usa el texto de reserva y cae al post", () => {
    render(<BoostCta kind="otro" entityId="x1" postId="post-9" />);
    const link = screen.getByRole("link", { name: COPY.post.boostCtaFallback });
    expect(link.getAttribute("href")).toBe("/feed/post-9");
  });

  // --- Botón de WhatsApp de la campaña (post_promotions.cta_whatsapp) -------

  it("sin WhatsApp: la barra queda con un solo CTA", () => {
    render(<BoostCta kind="property" entityId="p1" postId="post-1" />);
    expect(screen.queryByRole("link", { name: COPY.post.boostCtaWhatsapp })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("con WhatsApp: suma el botón a wa.me SIN reemplazar el CTA de la entidad", () => {
    render(
      <BoostCta
        kind="property"
        entityId="p1"
        postId="post-1"
        ctaWhatsapp="+1 (305) 555-0134"
      />,
    );
    // El CTA de siempre sigue estando…
    expect(
      screen.getByRole("link", { name: COPY.post.boostCta.property }).getAttribute("href"),
    ).toBe("/propiedades/p1");

    // …y el de WhatsApp abre el chat con SOLO los dígitos, en otra pestaña.
    const wa = screen.getByRole("link", { name: COPY.post.boostCtaWhatsapp });
    expect(wa.getAttribute("href")).toBe("https://wa.me/13055550134");
    expect(wa.getAttribute("target")).toBe("_blank");
    expect(wa.getAttribute("rel")).toContain("noopener");
  });

  it("teléfono que no sirve: ausencia, nunca un link roto", () => {
    render(<BoostCta kind="event" entityId="e1" postId="post-1" ctaWhatsapp="123" />);
    expect(screen.queryByRole("link", { name: COPY.post.boostCtaWhatsapp })).toBeNull();
  });
});
