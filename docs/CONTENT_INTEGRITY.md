# Content Integrity — qué hay, qué se agregó y qué no existe

**Fecha:** 12 de agosto de 2026
**Origen:** pedido de Nacho (texto de WhatsApp del 11/8 + nota de voz de 4:13).

Este documento responde punto por punto al pliego de Content Integrity y al de
Creator Marketplace. Distingue siempre **tres estados**, sin colapsarlos:

| Estado | Significa |
|---|---|
| ✅ **Implementado y verificado** | Está en el código, con tests que corren |
| 🟡 **Parcial** | Existe una parte; se dice exactamente cuál falta |
| ⛔ **No implementado** | No está. Sin eufemismos |
| 🚫 **No contemplado a propósito** | Se decidió no hacerlo, con motivo |

---

## 0. La regla que gobierna todo

El pliego de Nacho la enuncia bien y **el sistema ya la cumple**: nunca se le
muestra a nadie "este contenido no tiene copyright".

Lo que la app dice hoy, textual, debajo de la declaración del creador:

> Esto es lo que nos contás vos: no lo verificamos y no equivale a un
> certificado de propiedad.

Y en el panel de moderación, la tarjeta de alerta distingue explícitamente
"mismo archivo" (determinístico) de "se parece" (probabilístico, con la
distancia en bits a la vista), con el aviso de que la huella **no prueba
autoría**. No hay ninguna cadena en el código que afirme originalidad
verificada. Esa disciplina ya estaba y no se tocó.

---

## 1. Los 6 niveles del pliego

### Nivel 1 — Declaración del creador ✅

Existe desde la migración `0061_content_integrity.sql`. Se guarda
`originality_declared`, `license_kind`, `license_statement`, `license_url` por
cada archivo, junto con quién lo subió, cuándo y **desde qué dominio**
(`source_host` congelado como texto, para que la evidencia sobreviva aunque el
dominio se archive).

Dos decisiones que no son de estilo y conviene defender ante el cliente:

- El bloque va **dentro del formulario**, no en un modal de "aceptá los
  términos". Un modal se cierra sin leer.
- El default es `desconocido`, **nunca** "es mío". No declarar nada no puede
  leerse como una afirmación de propiedad que la persona no hizo.

La UI vive en `src/components/integrity/originality-fields.tsx` y está en los
tres formularios de publicación (feed, publicar, marketplace).

### Nivel 2 — IA revisa automáticamente 🟡

| Lo que pedía Nacho | Estado |
|---|---|
| Marcas de agua de TikTok / Instagram / CapCut | ✅ **nuevo** — detector de procedencia por metadatos del contenedor (ver §3) |
| Logos de otras plataformas | 🟡 se detecta por metadatos, no por visión artificial sobre el píxel |
| Música comercial conocida | ⛔ requiere proveedor externo con catálogo licenciado (ver §5) |
| Contenido duplicado | ✅ SHA-256 + huella perceptual |
| Violencia, desnudos, texto ofensivo | ✅ moderación de texto con OpenAI + cola humana (`src/lib/moderation/`) |
| Rostros famosos, escenas de películas | ⛔ no existe y no es barato |

### Nivel 3 — Huella digital ✅ (con un hueco cerrado en esta entrega)

- **SHA-256** del archivo original: sí, para todo archivo.
- **pHash perceptual de imagen** (DCT 32×32 → 64 bits): sí, implementado a mano
  en TypeScript, sin dependencias, usando `sharp` sólo para decodificar.
- **Huella de video** (256 bits, 4 fotogramas): sí, con una salvedad honesta que
  está documentada en el código: los fotogramas los muestrea **el navegador**,
  porque los videos suben directo al bucket sin pasar por el servidor. Un
  cliente modificado puede falsear esos fotogramas. El SHA-256 sí lo calcula el
  servidor leyendo el archivo real.
- **Huella de audio**: era el hueco declarado (`audioPhash256` devolvía siempre
  `null`). Se implementó en esta entrega (ver §4).

La búsqueda de similares usa índices **HNSW con distancia de Hamming** en
Postgres, no un scan lineal: escala a millones de filas.

### Nivel 4 — Moderación humana ✅

Panel dedicado en `/admin/moderacion/integridad`, separado de la cola general.
Cuatro decisiones: aprobar, bloquear, investigar, descartar. Todo auditado.
Bloquear da de baja el post o aviso asociado.

### Nivel 5 — Sistema de denuncias 🟡 → ✅ en esta entrega

Existía el sistema "Escudo" (`scam_reports`), pero un reporte de "usa una marca
o contenido que no le pertenece" **moría ahí**: nunca llegaba al módulo de
integridad. Esta entrega agrega el flujo de disputa propiamente dicho (§6).

### Nivel 6 — Historial de confianza 🟡

El Trust Score existe y es un motor real (verificaciones, antigüedad, contratos
liberados, avales, penalizaciones). Lo que **no** existía es que la integridad
del contenido lo afectara. Esta entrega agrega la función de penalización
calculada; el enganche al motor de score queda deliberadamente para una
migración aparte, para no alterar los scores vigentes en el mismo movimiento.

---

## 2. Lo que se construyó en esta entrega

| Qué | Dónde |
|---|---|
| **Huella de audio** de 256 bits, sin dependencias externas | `src/lib/integrity/audio.ts`, extracción en `src/lib/media/audio-samples.ts` |
| **Detector de procedencia** (TikTok, CapCut, Instagram, Meta, y 8 más) | `src/lib/integrity/provenance.ts` |
| **Umbral por algoritmo** — antes uno solo para huellas de 64 y de 256 bits | migración `0088` |
| **Umbrales configurables por comunidad** | migración `0086`, `src/lib/integrity/settings.ts` |
| **Disputas de contenido** (reclamo del usuario + panel de resolución) | migración `0086`, `/contenido/reclamar/[assetId]`, `/admin/moderacion/integridad/disputas` |
| **Estado comercial** (`apto_comercial`) que exige revisor humano registrado | migración `0086` |
| **Penalización de integridad** para el Trust Score (calculada, sin enganchar) | migración `0086` |
| **Modalidad de trabajo** remoto / presencial / mixto | migración `0087` |
| **Comisión configurable por comunidad**, congelada al firmar el contrato | migración `0087`, `src/lib/creators/commission.ts` |
| **Cola de aprobación de creadores** y sincronización de `email_verified` | `/admin/creadores/solicitudes`, `src/lib/auth/email-verified.ts` |

### Un bug de producción que apareció en el camino

Las columnas generadas que calculan el reparto 20/80 (`platform_fee_cents`,
`creator_net_cents`, migración `0024`) multiplicaban en `integer`. Con la
comisión fija en 20 % nunca se notaba; al volverla configurable hasta 50 %, un
contrato del monto máximo permitido desbordaba el entero y el alta del contrato
habría fallado con *integer out of range*. La `0087` recrea las dos columnas
multiplicando en `bigint`. La semántica de redondeo no cambia.

### Cómo se verificó

- **3064 tests** automatizados en verde, `tsc --noEmit` limpio.
- Las tres migraciones se aplicaron **contra la base de producción real dentro
  de una transacción con `ROLLBACK`**: aplican limpias sobre el esquema y los
  datos que hay hoy, con RLS activada y forzada, 4 policies por tabla nueva,
  permisos acotados (sin `DELETE` para nadie) y ninguna función privilegiada sin
  `search_path` fijo.
- Los umbrales del fingerprint de audio no son estimados: salen de medir
  distancias reales. Mismo audio con otro volumen, formato o ruido leve: hasta
  23 bits de diferencia sobre 256. Audios distintos: 117 o más. El corte quedó
  en 32.

---

## 3. Detección de procedencia (marcas de agua, por la vía honesta)

El pliego pedía detectar videos descargados de TikTok, Instagram o CapCut.
Hay dos caminos:

1. **Visión artificial sobre el píxel** — buscar el logo animado en la imagen.
   Caro, probabilístico, se rompe con un recorte de 40 píxeles.
2. **Metadatos del contenedor** — TikTok, CapCut, InShot y compañía **escriben
   su nombre** en los átomos `udta`/`meta` del MP4 y en el campo de encoder.
   Determinístico, gratis, y verificable byte a byte.

Se implementó el camino 2. Lo que **no** detecta, y hay que decirlo: un archivo
re-codificado que borra los metadatos, o una grabación de pantalla. Para eso
haría falta el camino 1, que se puede sumar después sin rehacer nada.

---

## 4. Fingerprint de audio

Se implementó una huella perceptual de 256 bits, sin dependencias externas.
Detecta el **mismo audio** aunque cambie el formato, el bitrate o el volumen.

Lo que **no** hace, y es exactamente lo que Nacho ya anticipaba en su texto:
identificar el catálogo comercial protegido. Para eso hace falta un proveedor
especializado de reconocimiento musical con una base licenciada. La huella
propia sirve para lo de adentro: audio reutilizado entre creadores de la
comunidad, la misma grabación resubida, y música de la biblioteca propia.

---

## 5. Lo que cuesta plata y no se puede hacer con código propio

Estos ítems del pliego **no** se resuelven programando. Requieren contratar un
proveedor, y conviene ponerlos en el presupuesto antes del lanzamiento:

| Ítem | Por qué no alcanza con código |
|---|---|
| Reconocimiento de música comercial | Hace falta una base de datos licenciada del catálogo (tipo ACRCloud / Audible Magic) |
| Detección de rostros famosos | Base de identidades + implicancias legales de biometría |
| Escenas de películas y TV | Mismo problema: catálogo de referencia licenciado |
| Verificación documental de identidad | Ya integrado con Stripe Identity, pero **degradado por falta de credenciales reales en producción** |

La estimación de Nacho de US$200–500/mes para la Fase 1 es razonable, y hoy el
gasto real es **cero** en estos rubros porque nada de esto está contratado.

---

## 6. Disputas y reclamos de copyright

Antes de esta entrega no existía el flujo "ese contenido es mío". Ahora sí, con
una regla de diseño que conviene explicar al cliente porque parece una
limitación y es una protección:

> **Abrir una disputa congela el contenido, no lo elimina.**

Si un reclamo tuviera efecto punitivo automático, sería un arma: tres reclamos
falsos harían desaparecer el contenido de un competidor. El contenido pasa a
`en_investigacion` y lo mira una persona.

---

## 7. Umbrales configurables

El pliego lo pedía explícitamente: *"los valores exactos de los umbrales deben
probarse con contenido real antes del lanzamiento y poder modificarse desde el
panel administrativo"*.

Antes había una constante en el código (10 bits sobre 64) igual para todas las
comunidades. Ahora hay configuración **por comunidad**, con una invariante
forzada: si la config queda incoherente, se cae a los valores de siempre. Una
configuración rota nunca afloja un control.

---

## 8. Lo que sigue sin existir (para no vender humo)

- **Cola asíncrona de procesamiento.** El escaneo corre dentro del request de
  publicación. Funciona bien con el volumen actual, pero el pliego pide workers
  y cola, y tiene razón: con videos largos y volumen alto, esto se nota.
- **Extracción de fotogramas server-side.** Sin `ffmpeg` en el servidor, la
  huella de video depende del navegador y es falsificable por un cliente
  modificado.
- **Comparación de fragmentos** ("en qué segundo coincide"). Hoy la huella es
  del video completo.
- **Certificado de originalidad como distintivo público.** Existe el libro de
  procedencia interno (que nunca se purga, ni siquiera cuando el contenido se
  elimina), pero no se muestra un sello 🟢 al público — y para mostrarlo habría
  que redactar con cuidado qué afirma exactamente, porque no es un registro
  oficial de derechos de autor.
- **El botón "reclamar este contenido" en el feed.** El flujo de reclamo está
  completo y funciona, pero hoy se entra por URL directa: la pantalla necesita
  el identificador interno del archivo, y ese dato no se expone en las tarjetas
  del feed a propósito. Conectarlo bien pide una consulta acotada nueva (que
  devuelva sólo el tipo de archivo y la fecha de carga, nada más) en vez de
  abrir el identificador. Es media hora de trabajo, pero es una decisión de
  producto sobre qué se muestra públicamente, no un olvido.
- **La pantalla para editar la comisión** desde el panel: la configuración por
  comunidad existe y la base la respeta, pero hoy se cambia por SQL.
