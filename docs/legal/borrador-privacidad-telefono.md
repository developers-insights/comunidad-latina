# Borrador: lo que hay que publicar antes de encender la verificación por teléfono

**Estado: borrador para aprobación del cliente. No está publicado.**
No es asesoramiento legal — es el texto listo para que lo revise quien corresponda
y, si está de acuerdo, se pegue en la página.

---

## Por qué existe este documento

La verificación telefónica está **escrita, probada y apagada**. El interruptor es
`PHONE_VERIFICATION_ENABLED`; sin él en `true`, la ruta `/ajustes/telefono` devuelve
404 y no se recolecta ningún número.

No está apagada porque falte código. Está apagada porque la Política de Privacidad
publicada hoy en `/legal/privacidad` dice, textualmente, en la sección **“Qué te
pedimos al registrarte”**:

> No pedimos teléfono, número de seguro social ni dirección postal en el registro.

El día que el interruptor pase a `true`, esa frase deja de ser cierta. Y la misma
política declara cumplimiento de **CCPA/CPRA** (sección “Si estás en California”),
donde el deber de informar qué categorías de datos personales se recolectan es
exigible, no decorativo. Un número de teléfono es una categoría propia.

**Entonces el orden correcto es: primero se publica esto, después se enciende el
interruptor.** Al revés, la plataforma estaría recolectando una categoría de dato
que su propia política dice no recolectar.

---

## Cambio 1 — Sección “Qué te pedimos al registrarte”

`src/app/(marketing)/legal/privacidad/page.tsx`, `LegalSection id="que-pedimos"`.

El segundo párrafo hoy dice:

> No pedimos teléfono, número de seguro social ni dirección postal en el registro. Si
> más adelante contás tu zona o barrio —por ejemplo, para buscar vivienda—, es siempre
> aproximado.

Reemplazar por:

> No pedimos número de seguro social ni dirección postal. El teléfono tampoco te lo
> pedimos para registrarte: es opcional y sirve para una sola cosa, que la contamos
> abajo. Si más adelante contás tu zona o barrio —por ejemplo, para buscar vivienda—,
> es siempre aproximado.

---

## Cambio 2 — Sección nueva, después de “Tus mensajes se borran solos”

`LegalSection id="telefono" title="Tu teléfono, si decidís darlo"`.

> Verificar tu teléfono es opcional. Podés usar toda la plataforma sin darlo nunca.
>
> Si lo hacés, te mandamos un mensaje de texto con un código de seis dígitos que vence
> a los diez minutos. Ese código **no se guarda**: guardamos una huella matemática que
> sirve para comprobar el que escribís y no permite reconstruirlo. Después de cinco
> intentos fallidos, el código se quema y hay que pedir otro.
>
> Tu número lo usamos para eso y para nada más. **No te vamos a mandar publicidad, ni
> promociones, ni avisos por mensaje de texto.** Tampoco lo mostramos en tu perfil: lo
> único que ve el resto de la comunidad es una marca de que verificaste tu teléfono,
> nunca el número.
>
> El mensaje lo envía **Twilio**, una empresa de Estados Unidos que recibe tu número y
> el texto del código para poder entregarlo. Si tu compañía telefónica te cobra por
> recibir mensajes, ese costo es tuyo.
>
> Podés borrar tu número cuando quieras desde Ajustes. Al borrarlo perdés la marca de
> verificado y no queda copia.

---

## Cambio 3 — Sección “Con quién compartimos tus datos”

Agregar un ítem a la lista de empresas, en el mismo formato que los demás:

> **Twilio** — envía el mensaje de texto con el código cuando verificás tu teléfono.
> Recibe tu número y el código. No recibe nada más y no lo usamos para otra cosa.

---

## Cambio 4 — La fecha

La política tiene una fecha de última actualización arriba. Actualizarla el día que se
publique, y avisar del cambio según lo que dice la propia sección “Cambios a esta
Política”.

---

## Después de publicar

Recién ahí, cargar en Vercel producción:

```
PHONE_VERIFICATION_ENABLED=true
```

Las credenciales de Twilio ya están cargadas en Vercel producción y verificadas el
2026-09-07: `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`,
`TWILIO_PHONE_NUMBER` y `PHONE_CODE_PEPPER`. Son los cinco nombres exactos que lee
`src/lib/config/services.ts`; `isSmsConfigured` exige los cuatro primeros.

**No hace falta un Verify Service SID.** Twilio Verify es un producto aparte que
maneja el ciclo de vida del código —generarlo, guardarlo, contar intentos,
vencerlo—, y todo eso ya está resuelto del lado de la plataforma en
`src/lib/phone/verification.ts`, con el código hasheado con un pepper que vive en
env y no en la base. Sumar Verify sería tener dos dueños del mismo estado y pagar
alrededor de seis veces más por verificación. Se usa la Messages API y está bien así.
