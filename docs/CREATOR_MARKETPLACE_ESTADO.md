# Creator Marketplace — estado real contra lo pedido

**Fecha:** 12 de agosto de 2026
**Origen:** nota de voz de Nacho del 11/8 (4:13), transcripta y auditada contra el código.

> **Dónde vive.** El Creator Marketplace **no** está en `/marketplace` (esa es la
> tienda de productos de negocios) ni en `/empleos` (empleos comunitarios
> genéricos). Vive en `src/app/(app)/creadores/**`. Vale aclararlo porque los
> tres nombres se parecen y llevan a auditar el módulo equivocado.

---

## Los 24 puntos de la nota de voz

### Onboarding de creador

| # | Pedido | Estado |
|---|---|---|
| 1 | Solicitud para convertirse en Creator | ✅ máquina de 9 estados; el rol no se autoasigna |
| 2 | Revisión y aprobación por el equipo | 🟡→✅ **el backend existía sin ninguna pantalla que lo llamara**: las solicitudes quedaban trabadas para siempre. Se construyó la cola en esta entrega |
| 3 | Verificación de teléfono | 🟡 la capa de datos y el flujo están completos, pero **apagados**: falta un proveedor de SMS real y la variable que lo habilita |
| 4 | Verificación de correo | 🟡→✅ Supabase confirmaba el correo pero **nunca escribía la columna** que el gate exige. Se corrigió en esta entrega |
| 5 | Stripe Identity | ✅ integrado (el documento nunca toca la base, solo el booleano) — degradado en producción por credenciales de prueba |
| 6 | Stripe Connect para cobrar | 🟡 **solo esqueleto de datos**: las tablas están vacías, no hay onboarding ni registro de transferencias. Sin esto no hay pagos reales al creador |
| 7 | Mayor de 18 | ✅ la fecha de nacimiento es privada; hacia afuera solo sale la edad |
| 8 | Perfil completo como requisito | ✅ configurable por comunidad, hoy en `false` por default para no invalidar a los creadores ya existentes |

### Perfil del creador

| # | Pedido | Estado |
|---|---|---|
| 9 | Categoría | ⛔ la columna existe, el selector nunca se expuso (falta definir la lista de categorías — es una decisión de producto, no de código) |
| 10 | Ciudad / mercado | 🟡 hay ciudad genérica de perfil, pero el directorio **no filtra por mercado** |
| 11 | Idioma | ⛔ la columna existe, nadie la lee ni la muestra en el contexto de creador |
| 12 | Portafolio con redes externas | 🚫 **bloqueado a propósito**: la spec decidió no abrir Instagram ni TikTok desde el perfil, para no empujar la negociación fuera de la plataforma. Si el cliente lo quiere, es un cambio de producto, no una tarea pendiente |
| 13 | Rango de precios | 🟡 se guarda, **no se muestra en ningún lado** |
| 14 | Disponibilidad | ✅ se declara, se muestra en el listado y ordena el directorio |
| 15 | Reseñas | ✅ solo entre partes de un contrato ya liberado — que es lo correcto |
| 16 | Contratar / invitar / colaborar / mensajear | 🟡→✅ "Contratar" y "Seguir" existían; **faltaba el botón de mensaje**, que se agregó. "Invitar" y "colaborar" como acciones distintas de "proponer contrato" siguen sin existir |

### Trabajos

| # | Pedido | Estado |
|---|---|---|
| 17 | Publicar trabajos | ✅ formulario de 4 pasos completo |
| 18 | Digital Jobs vs On-site Jobs | ⛔→✅ no existía la distinción en ningún módulo. Se agregó en esta entrega |
| 19 | Colaboraciones entre creadores | ⛔ **ojo con el nombre**: la sección "Colaboraciones" de la app es el renombre de "Contratos" — es 1 cliente ↔ 1 creador. Un trabajo conjunto entre dos creadores no existe |
| 20 | Campañas grupales | ⛔ lo que hay llamado "campañas" es un escalón avanzado de impulso de **un solo** aviso o publicación, no una campaña que agrupe varios creadores para una marca |
| 21 | Presupuesto | ✅ |
| 22 | Identificador del trabajo | ✅ el formato real es `CL-CM-2026-000012` (incluye el año), no `CL-CM-0001`. Los códigos viejos quedaron migrados y siguen siendo buscables |

### Dinero y estatus

| # | Pedido | Estado |
|---|---|---|
| 23 | Split 20% plataforma / 80% creador | 🟡→✅ el cálculo existía y era correcto, pero el 20% estaba **hardcodeado en el código**. Ahora es configuración por comunidad, y la comisión se congela al crear el contrato (editar la config no altera contratos ya firmados) |
| 24 | Boost local / nacional / global, suscripciones, tick azul | 🟡 los impulsos existen pero **solo por duración** (7/14/30 días), no por alcance geográfico. El único distintivo pagado tipo "tick azul" es "Presencia Verificada" y es **exclusivo de negocios**: no existe para creadores |

---

## Los 5 huecos más grandes, por impacto

1. **Stripe Connect es solo esqueleto.** Sin onboarding ni registro de
   transferencias no hay forma de pagarle al creador, aunque el split esté bien
   calculado. Es el bloqueante número uno para que el Marketplace funcione de
   verdad.
2. **La verificación por SMS está construida y apagada.** Falta contratar un
   proveedor. Es una decisión de plata, no de desarrollo.
3. **Campañas multi-creador y colaboraciones entre creadores no existen.** El
   modelo de datos es estrictamente de a dos partes. Agregarlo es trabajo de
   arquitectura, no un campo más.
4. **El "tick azul" para creadores no existe.** Hoy solo los negocios tienen un
   distintivo pagado. Si es prioridad, hay que definir qué afirma exactamente
   ese distintivo antes de venderlo — un check que se compra y parece una
   verificación de identidad es un problema, no una feature.
5. **Categoría e idioma del creador están en la base pero no en la pantalla.**
   Son las dos dimensiones por las que una marca busca un creador; sin ellas el
   directorio no filtra por lo que importa.
