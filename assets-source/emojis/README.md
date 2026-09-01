# Emojis de la comunidad — archivos de origen

## Qué hay acá

Los **60 emojis del pack**, en PNG de 512 × 512 con fondo transparente. Son los
que están cargados en el bucket `community-emojis` y los que ve la gente en el
picker, en los comentarios y sobre las fotos.

**Los dibujamos nosotros.** El cliente mandó dos LÁMINAS de 30 emojis cada una
—capturas de pantalla, con fondo, los 30 dibujos pegados en una sola imagen— y
no los archivos sueltos. Eso no se puede usar: el bucket quiere un archivo por
emoji, cuadrado y con transparencia. Pedirle los sueltos era el camino corto y
no iba a llegar, así que el pack se generó acá.

El vocabulario sale de lo que se lee en esas láminas y de lo que ya estaba
documentado (KLK, Chévere, Bacán, De una, Qué lo qué, Parranda, Cafecito,
Empanada, Tostones, Wepa, Chancletazo, Mi pana, Vacilón, Abrazo). El resto se
completó con el mismo registro: caribeño primero —la comunidad es mayoría
dominicana— pero no exclusivo, porque también hay colombianos, mexicanos,
venezolanos y ecuatorianos.

## Cómo se regenera el pack

Todo sale de **`scripts/catalogo-emojis.json`**, que es la única fuente de
verdad: ahí viven la ficha que va a la base (`label`, `alt`, `category`,
`sort_order`) **y** el prompt con el que se dibuja el archivo. Tenerlos juntos es
lo que hace el pack reproducible — si mañana hay que rehacer un dibujo, el
prompt exacto está al lado de su ficha y no en el historial de un chat.

```bash
# 1 · Dibujar (sobre fondo verde: los modelos de imagen no generan transparencia)
node scripts/generar-emojis.mjs --hacia ./tmp/emojis-crudos

# 2 · Recortar el fondo → PNG con alpha, ajustado al dibujo
node scripts/quitar-fondo-emojis.mjs --desde ./tmp/emojis-crudos --hacia assets-source/emojis

# 3 · Subir al bucket y escribir las fichas (primero en seco)
node scripts/cargar-emojis.mjs --desde assets-source/emojis --revisar
node scripts/cargar-emojis.mjs --desde assets-source/emojis --activar
```

Para rehacer sólo algunos: `--solo klk,wepa,cafecito` en el paso 1.

`generar-emojis.mjs` necesita `GOOGLE_AI_API_KEY` en `.env.local` (la misma key
del MCP nanobanana). `cargar-emojis.mjs` necesita `SUPABASE_SERVICE_ROLE_KEY`:
las policies de la 0125 sólo dejan escribir el catálogo a `global_admin` y el
script no tiene sesión.

## Si algún día llegan los archivos del cliente

No hay que tocar código. Se ponen los archivos en una carpeta, se ajustan
`archivo` y —si cambian los nombres— `label`/`alt`/`category` en el manifiesto, y
se corre el paso 3 apuntando a esa carpeta. `cargar-emojis.mjs` normaliza
cualquier entrada (PNG grande, SVG, WebP) a PNG de 512 × 512 antes de subir, y
`storage_path` es UNIQUE con `upsert`, así que **pisa** en vez de duplicar.

Qué pedirles, si se les pide:

| | |
|---|---|
| **Formato** | **PNG con transparencia** (preferido) o SVG. Nada de JPG: el fondo blanco se ve como un recuadro sobre la foto. |
| **Medida** | **512 × 512 px, cuadrado**, con el recorte ajustado al dibujo y sin margen extra. |
| **Fondo** | Transparente. |
| **Peso** | Hasta 256 KB por archivo (lo que acepta el bucket). |
| **Uno por archivo** | Un dibujo por archivo, **no una lámina con los 30**. |
| **Nombre** | Cualquiera: el manifiesto asigna nombre, código y categoría. |

## Dos decisiones de diseño que conviene no revertir sin pensarlas

**Los dibujos no llevan texto adentro.** El emoji se ve a 22 px dentro de un
comentario y a 24 px como reacción: a ese tamaño una palabra es una mancha. El
nombre ya viaja en el `label` (lo dice el lector de pantalla y lo encuentra el
buscador del picker), así que meter "KLK" dentro del dibujo agregaría ruido
donde importa y legibilidad donde no hace falta.

**Todos llevan un contorno blanco.** No es decorativo: el mismo emoji se pega
**sobre fotos** en el editor, y sin contorno un dibujo oscuro sobre una foto
oscura desaparece.
