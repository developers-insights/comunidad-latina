// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { JobCardModel } from "@/app/(app)/empleos/queries";
import { ServiceCard } from "./service-card";
import { COPY } from "./copy";

/**
 * Tarjeta de SERVICIO (feedback cliente 2026-09-03, punto 12).
 *
 * Lo que se prueba es lo que la distingue de un empleo y lo que se rompe en
 * silencio: que el precio se lea como REFERENCIA y no como tarifa, que la
 * ausencia de disponibilidad se dibuje como ausencia y no como un hueco, y que
 * el CTA sea escribirle —nunca postularse— y no aparezca cuando del otro lado no
 * hay una cuenta a la que escribir.
 */

vi.mock("next/link", () => ({
  // Los props se propagan (…props) y no sólo `href`: el nombre accesible del
  // enlace viaja en `aria-label`, y un mock que lo tira haría pasar un test
  // sobre un enlace que en la app nadie puede nombrar.
  default: ({ href, children, ...props }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

// La server action del composer no se puede importar en jsdom ("use server").
vi.mock("@/app/(app)/mensajes/inline-actions", () => ({
  sendListingMessageAction: vi.fn(),
}));

// El composer usa el router (para volver del ingreso) y la hoja de sesión.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/empleos",
}));

vi.mock("@/components/auth/auth-sheet", () => ({
  AUTH_REASON: { contact: "Entrá para escribirle" },
  useRequireAuth: () => () => {},
}));

afterEach(cleanup);

const C = COPY.service;

const BASE: JobCardModel = {
  id: "svc-1",
  kind: "service",
  title: "Jardinería y corte de pasto",
  description: "Corto el pasto, podo y limpio patios. Llevo mi máquina.",
  salaryLabel: null,
  salaryRangeLabel: null,
  workMode: "presencial",
  employmentType: null,
  availabilityLabel: "Sábados y domingos · de 8 a 14",
  fromPriceLabel: "Desde $25/hora",
  areaLabel: "Corona, Queens",
  photoUrl: null,
  photos: [],
  publisher: {
    type: "member",
    profileId: "p-1",
    displayName: "Ramón Peña",
    avatarUrl: null,
    score: 62,
    // `trust_scores.level` guarda el id canónico (@/lib/trust/levels), no una
    // palabra libre: con un valor inventado el badge no encuentra su config.
    level: "confiable",
    signals: [],
  },
  boosted: false,
};

describe("ServiceCard", () => {
  it("muestra qué hace, quién lo ofrece, cuándo y el precio como referencia", () => {
    render(<ServiceCard service={BASE} isLoggedIn />);

    expect(screen.getByRole("heading", { name: BASE.title })).toBeTruthy();
    expect(screen.getByText(C.offeredBy("Ramón Peña"))).toBeTruthy();
    expect(screen.getByText("Sábados y domingos · de 8 a 14")).toBeTruthy();
    expect(screen.getByText("Corona, Queens")).toBeTruthy();
    // "Desde": el número es una referencia, no una tarifa cerrada.
    expect(screen.getByText("Desde $25/hora")).toBeTruthy();
  });

  it("sin monto dice 'A convenir' con todas las letras, no deja el lugar vacío", () => {
    render(<ServiceCard service={{ ...BASE, fromPriceLabel: null }} isLoggedIn />);
    expect(screen.getByText(C.priceToAgree)).toBeTruthy();
  });

  it("sin disponibilidad ni zona declaradas lo dice, en vez de mostrar un hueco", () => {
    render(
      <ServiceCard
        service={{ ...BASE, availabilityLabel: null, areaLabel: null }}
        isLoggedIn
      />,
    );
    expect(screen.getByText(C.availabilityUnknown)).toBeTruthy();
    expect(screen.getByText(C.zoneUnknown)).toBeTruthy();
  });

  it("el CTA es escribirle — un servicio NO se postula", () => {
    render(<ServiceCard service={BASE} isLoggedIn />);
    expect(screen.getByRole("button", { name: C.contact })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /postular/i })).toBeNull();
  });

  it("sin cuenta detrás (aviso externo) no ofrece un botón que iba a fallar", () => {
    render(
      <ServiceCard
        service={{ ...BASE, publisher: { type: "external", name: "Bolsa de trabajo" } }}
        isLoggedIn
      />,
    );
    expect(screen.queryByRole("button", { name: C.contact })).toBeNull();
    // El aviso igual se muestra, y con su atribución.
    expect(screen.getByText(C.offeredBy("Bolsa de trabajo"))).toBeTruthy();
  });

  it("siempre deja el camino a la página completa del servicio", () => {
    render(<ServiceCard service={BASE} isLoggedIn />);
    const link = screen.getByRole("link", { name: `${C.viewService}: ${BASE.title}` });
    expect(link.getAttribute("href")).toBe("/empleos/svc-1");
  });

  it("impulsado: se declara con la MISMA palabra que el resto de la app", () => {
    render(<ServiceCard service={{ ...BASE, boosted: true }} isLoggedIn />);
    expect(screen.getByText(COPY.list.adChip)).toBeTruthy();
  });
});
