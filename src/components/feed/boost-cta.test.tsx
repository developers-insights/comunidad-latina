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

  it("empleo → 'Postularme' cae al detalle del post (no hay página de empleo)", () => {
    render(<BoostCta kind="job" entityId="j1" postId="post-42" />);
    const link = screen.getByRole("link", { name: COPY.post.boostCta.job });
    expect(link.getAttribute("href")).toBe("/feed/post-42");
  });

  it("kind desconocido usa el texto de reserva y cae al post", () => {
    render(<BoostCta kind="otro" entityId="x1" postId="post-9" />);
    const link = screen.getByRole("link", { name: COPY.post.boostCtaFallback });
    expect(link.getAttribute("href")).toBe("/feed/post-9");
  });
});
