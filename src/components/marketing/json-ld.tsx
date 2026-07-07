/**
 * Structured data JSON-LD. El único uso de dangerouslySetInnerHTML del módulo,
 * y es seguro: serializamos NOSOTROS el objeto con JSON.stringify y escapamos
 * `<` para que ningún contenido (títulos de guías, etc.) pueda cerrar el tag.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
