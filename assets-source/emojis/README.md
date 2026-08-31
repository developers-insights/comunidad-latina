# Emojis de la comunidad — archivos de origen

## Qué hay acá hoy

Seis **archivos de prueba** (`prueba-*.svg`), dibujados a mano para verificar la
máquina: que el picker liste, que el dibujo se pegue sobre una foto, que se
arrastre y que el horneado en canvas lo escriba en el JPEG.

**No son del pack del cliente.** Los 60 emojis reales (KLK, CHÉVERE, BACÁN, QUÉ
LO QUÉ, PARRANDA, CAFECITO, EMPANADA…) todavía no llegaron: el cliente mandó
capturas de los dos packs, no los archivos sueltos. Cuando lleguen, estos seis
se borran.

## Qué formato pedirle al cliente

| | |
|---|---|
| **Formato** | **PNG con transparencia** (preferido) o SVG. Nada de JPG: el fondo blanco se ve como un recuadro sobre la foto. |
| **Medida** | **512 × 512 px, cuadrado.** El recorte tiene que estar ajustado al dibujo, sin margen extra: el picker y la foto escalan la imagen entera, así que un margen de 100 px hace que el emoji se vea chico al lado de los demás. |
| **Fondo** | Transparente. |
| **Peso** | Hasta 256 KB por archivo (lo que acepta el bucket). Un PNG de 512 px bien exportado pesa 20–80 KB. |
| **Uno por archivo** | Un dibujo por archivo, no una lámina con los 30. |
| **Nombre** | Cualquiera: el manifiesto (`scripts/catalogo-emojis.json`) es el que asigna nombre, código y categoría. Que se entienda a cuál corresponde alcanza. |

Si mandan SVG o PNG más grandes, no hay problema: `scripts/cargar-emojis.mjs`
los rasteriza y los normaliza a PNG de 512 × 512 antes de subirlos. Lo que **no**
se puede arreglar del lado nuestro es un JPG con fondo blanco ni una lámina con
los 30 dibujos juntos.

## Cómo se cargan

Ver la cabecera de `scripts/cargar-emojis.mjs`.
