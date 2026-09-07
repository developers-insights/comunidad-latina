import { cn } from "@/lib/utils";
import {
  CREDITO_COPY,
  lineaDeCredito,
  type CreditoDeFoto,
} from "@/lib/feed/creditos-de-foto";

/**
 * "Foto de uso libre · Unsplash" — los derechos y la fuente que declaró quien
 * publicó (0146), debajo de la foto.
 *
 * ES UN RENGLÓN, NO UN CARTEL. La declaración tiene que verse —si no la ve
 * nadie no sirve de nada, y quien podría reconocer una foto suya es justamente
 * quien está mirando la publicación— pero no puede competir con la foto ni con
 * lo que la persona escribió. De ahí la tinta `muted`, el tamaño más chico de
 * la tarjeta y las dos líneas como techo: la información está disponible para
 * quien la busca y es invisible para quien no.
 *
 * SERVER COMPONENT. No tiene estado ni abre nada: recibe el crédito ya resuelto
 * (`fetchPhotoCredits`, en lote por página) y lo pinta. Nada que hidratar.
 *
 * ⚠️ EL DISCLAIMER NO ES DECORACIÓN Y NO SE SACA. "Foto propia" suelto debajo de
 * una publicación se lee como algo que Comunidad Latina comprobó, y no lo es:
 * es una afirmación de quien publicó. Es el mismo criterio legal que rige el
 * verificador y el panel de integridad, y por eso viaja en dos canales —`title`
 * para el mouse, `sr-only` para el lector de pantalla— en vez de ocupar un
 * renglón visible que nadie leería dos veces.
 *
 * NUNCA UN LINK, aunque el crédito SEA una URL. El texto llega del cliente y se
 * pinta en el feed de todo el mundo: volverlo clickeable convierte un campo
 * opcional en una superficie de phishing con la credibilidad de la plataforma
 * detrás. Se muestra como texto y quien quiera ir lo copia.
 */

export interface PhotoCreditProps {
  credito: CreditoDeFoto;
  className?: string;
}

export function PhotoCredit({ credito, className }: PhotoCreditProps) {
  return (
    <p
      title={CREDITO_COPY.disclaimer}
      className={cn(
        "line-clamp-2 px-4 pt-2 text-xs leading-snug text-foreground-muted",
        className,
      )}
    >
      {lineaDeCredito(credito)}
      <span className="sr-only">. {CREDITO_COPY.disclaimer}</span>
    </p>
  );
}
