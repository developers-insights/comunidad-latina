import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { buttonVariants } from "@/components/ui/button";
import { DESTINOS_DE_ENLACE, type DestinoDeEnlace } from "@/lib/auth/enlace-correo";

export const metadata: Metadata = {
  title: "Continuar",
  robots: { index: false, follow: false },
  // No "no-referrer": el POST saldría con `Origin: null`. Ver vieneDeOtroSitio.
  referrer: "same-origin",
};

const TEXTO: Record<string, { titulo: string; cuerpo: string; boton: string }> = {
  signup: {
    titulo: "Activá tu cuenta",
    cuerpo: "Tocá el botón para confirmar tu correo y entrar.",
    boton: "Confirmar mi correo",
  },
  recovery: {
    titulo: "Recuperá tu cuenta",
    cuerpo: "Tocá el botón para elegir una contraseña nueva.",
    boton: "Seguir",
  },
  otro: {
    titulo: "Entrá a tu cuenta",
    cuerpo: "Tocá el botón para terminar de entrar.",
    boton: "Entrar",
  },
};

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function uno(valor: string | string[] | undefined): string {
  return typeof valor === "string" ? valor : "";
}

export default async function EnlacePage({ searchParams }: Props) {
  const params = await searchParams;
  const destino = uno(params.destino) as DestinoDeEnlace;
  const tokenHash = uno(params.token_hash);
  const type = uno(params.type);

  if (!DESTINOS_DE_ENLACE.includes(destino) || !tokenHash) {
    return (
      <AuthCard>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Este enlace no sirve</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pedí uno nuevo desde la pantalla de entrada.
        </p>
        <Link href="/entrar" className={`${buttonVariants()} mt-6 w-full`}>
          Ir a entrar
        </Link>
      </AuthCard>
    );
  }

  const texto = TEXTO[destino === "/confirmar" ? "signup" : type] ?? TEXTO.otro;

  return (
    <AuthCard>
      <h1 className="font-display text-2xl font-semibold tracking-tight">{texto.titulo}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{texto.cuerpo}</p>
      <form method="post" action={destino} className="mt-6">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={uno(params.next)} />
        <button type="submit" className={`${buttonVariants()} w-full`}>
          {texto.boton}
        </button>
      </form>
    </AuthCard>
  );
}
