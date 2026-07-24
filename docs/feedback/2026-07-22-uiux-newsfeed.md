# Feedback cliente 2026-07-22 — Auditoría UI/UX del News Feed (v1.0)

> Fuente: WhatsApp/mail de Geovanny (22/7). Documento crudo del cliente.
> OJO: gran parte de esto se **solapa** con el "Feed red-social v2" ya construido
> el 2026-07-21 (cards 4:5, video/reels, comentarios sheet, perfil+TrustScore,
> scroll infinito). Confirmar qué queda realmente pendiente contra el código — ver `docs/HANDOFF.md`.

**Objetivo:** convertir el News Feed en experiencia tipo Instagram/Facebook — más tiempo en plataforma + monetización con publicidad nativa.

## 1. News Feed
- **1.1 Fotos más grandes (PRIORIDAD ALTA):** ~95% del ancho, relación **4:5**, foto como elemento principal, márgenes reducidos.
- **1.2 Videos más grandes:** mayor tamaño en feed; al tocar → visor de video a pantalla completa.
- **1.3 Scroll vertical de videos:** al abrir un video no vuelve al feed; scroll vertical al siguiente (TikTok/Reels/Shorts).
- **1.4 Videos según el módulo:** reutilizar **un solo** reproductor; el scope depende del módulo de origen (Feed principal = todos; Propiedades = solo propiedades; Negocios = solo negocios; Eventos = solo eventos; Profesionales = solo profesionales).

## 2. Fotos y videos
- **Doble tap** sobre la foto para Like + animación de corazón.
- **Reproducción automática** de videos, **sin sonido** al inicio; al tocar se activa el audio.

## 3. Comentarios
- Abrir **desde abajo** (bottom sheet) tipo Instagram/Facebook, no en otra página.

## 4. Botones de interacción
- Hacer **más grandes** ❤️ Like / 💬 Comentar / ↗️ Compartir + pequeñas animaciones.

## 5. Publicidad nativa
- Igual que una publicación normal, solo con una **etiqueta pequeña "Publicidad"**.

## 6. Botones sobre la foto (SOLO publicidad) — IMPORTANTE
- **NO** aparecen en publicaciones normales; **solo** cuando el negocio compra publicidad (Boost).
- Ejemplos por tipo: Negocios (WhatsApp, Llamar, Website) · Eventos (Comprar Tickets) · Propiedades (WhatsApp, Llamar, Ver Propiedad) · Profesionales (WhatsApp, Agendar Cita) · Restaurantes (Reservar).
- **Semitransparentes**, sobre la parte inferior de la foto.

## 7. Feed (algoritmo)
- Mantener algoritmo actual. Orden recomendado: Amigos → Personas que sigo → Páginas que sigo → Populares → Publicidad nativa. Sin contenido suficiente → recomendaciones.

## 8. Perfil
- Rediseñar para sentirse como red social: foto, nombre, país, ciudad, seguidores, siguiendo, publicaciones, **Trust Score**, grid de publicaciones.

## 9. Trust Score
- Mayor peso visual; **tarjeta especial** ("Trust Score 72/100" + barra de progreso).

## 10. Animaciones
- Suaves: Like, comentarios, abrir perfiles, cambio de páginas, carga de publicaciones, **Pull to Refresh**, **Skeleton Loading**.

## 11. Tarjetas
- Reducir espacios en blanco; publicaciones más compactas; foto protagonista.

## 12. Scroll
- Extremadamente fluido, tipo Instagram.

## 13. Menú inferior
- Simple: 🏠 Inicio · ▶️ Videos · ➕ · 🔔 Notificaciones · 👤 Perfil.

## 14. Objetivo final
- No sentirse como un directorio de clasificados: red social donde anuncios/negocios/propiedades/eventos/profesionales se integran de forma natural en el contenido. Monetización = consecuencia de buena UX, no el elemento principal.

## Prioridades del cliente para el próximo sprint
- 🔴 **P1:** fotos más grandes · videos más grandes · scroll vertical de videos · comentarios tipo Instagram · doble tap para Like.
- 🟠 **P2:** animaciones · skeleton loading · autoplay de videos · mejoras de perfil · Trust Score visual.
- 🟢 **P3:** optimización del algoritmo · recomendaciones inteligentes · rendimiento · pulido general.
