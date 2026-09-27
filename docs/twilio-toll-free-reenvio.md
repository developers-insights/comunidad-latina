# Twilio — reenvío de la verificación toll-free de +1 (844) 727-4049

Rechazada el 17/9/2026 con 30491, 30496, 30497, 30507 y 30513. Este documento tiene
**todo lo que va en el formulario, en inglés y listo para pegar**, y al final los pasos
en la consola para Nacho.

> **Antes de reenviar:** los cambios del sitio (home pública, `/legal/sms`, secciones
> de SMS en Términos y Privacidad) tienen que estar **en producción**. Si Twilio revisa
> antes del deploy ve lo mismo que la vez pasada y lo vuelve a rechazar. Chequeo rápido
> (PowerShell):
>
> ```powershell
> curl.exe -s -o NUL -w "%{http_code}`n" https://www.comunidadlatina.com/
> curl.exe -s -o NUL -w "%{http_code}`n" https://www.comunidadlatina.com/legal/sms
> ```
>
> Los dos tienen que dar `200`. Si `/` da `307`, el deploy todavía no salió.

---

## Campos del formulario (en inglés, para pegar)

### Business name

```
Comunidad Latina LLC
```

### Business website URL

```
https://www.comunidadlatina.com
```

### Estimated monthly message volume

```
1,000
```

(El volumen real esperado es menor a 500 por mes; `1,000` es la opción más chica que lo
cubre con margen.)

### Use case category

```
Two-Factor Authentication (2FA)
```

Si esa opción no aparece en el desplegable, elegir `Account Notifications`. **No** elegir
Marketing ni Promotions.

### Use case summary

```
Comunidad Latina (Comunidad Latina LLC) operates https://www.comunidadlatina.com, an online community for Latino immigrants in the United States: housing listings, step-by-step guides for paperwork, and local businesses.

This toll-free number is used ONLY to send one-time verification codes (OTP) so a user can confirm that a phone number belongs to them. Nothing else is ever sent from this number: no marketing, promotions, offers, newsletters, alerts or third-party content.

Who receives messages: only registered users of comunidadlatina.com who are signed in and ask to verify their own phone number.

When: phone verification is optional and is not required to create an account or to use the service. A signed-in user opens Settings > Your phone ("Ajustes > Tu teléfono"), types their own number and taps "Enviar código" (Send code). Directly below that button they see this disclosure (in Spanish): "By tapping 'Enviar código' you agree to receive a text message with your Comunidad Latina verification code. One message per code you request. Message and data rates may apply. Reply STOP to opt out or HELP for help. See the SMS Policy." The SMS Policy link goes to https://www.comunidadlatina.com/legal/sms.

What: each request sends exactly one message with a 6-digit code that expires in 10 minutes. Requests are rate-limited to 3 per hour and 10 per day per phone number. Messages are sent in Spanish, the language of the site.

Phone numbers and SMS consent are never shared with or sold to third parties or affiliates for marketing purposes. Users can reply STOP at any time, and can also delete their number from Settings.

Estimated volume: fewer than 500 messages per month.
```

### Production message sample

Es el texto real que arma `verificationSmsBody()` en `src/lib/phone/sms.ts`. Va en
español porque es lo que efectivamente se manda; la traducción va al lado para el
revisor.

```
Comunidad Latina: tu código de verificación es 482913. Vence en 10 minutos. No se lo pases a nadie. Respondé STOP para no recibir más SMS.

(English translation: "Comunidad Latina: your verification code is 482913. It expires in 10 minutes. Don't share it with anyone. Reply STOP to stop receiving SMS.")
```

### Opt-in type

```
Web Form
```

**No** `Via Text` ni `Keyword`: nadie se suscribe mandando una palabra, el código se pide
desde un formulario del sitio.

### Opt-in image URL(s) / opt-in workflow URL

```
https://www.comunidadlatina.com/legal/sms#consentimiento
```

La pantalla real (`/ajustes/telefono`) está detrás del login, así que el revisor no puede
verla. En esa sección de la política hay una réplica fiel de la pantalla, con el botón y el
texto de consentimiento exactos (salen de la misma constante que usa la pantalla real:
`src/lib/phone/sms-consent.ts`). Si el formulario exige una **imagen**, sacar una captura
de esa sección y subirla a un lugar público (por ejemplo el mismo Drive, con acceso
"cualquiera con el enlace"), y pegar ese link además del de arriba.

### Opt-in keywords

Dejar **vacío** (o `N/A` si el campo es obligatorio). Borrar `COMUNIDADLATINA`: con opt-in
por formulario web no hay palabra clave, y tenerla cargada es parte de por qué el caso de
uso se leía como marketing.

### Opt-in confirmation message

No mandamos un mensaje de bienvenida aparte: el primer mensaje (y el único por pedido)
es el del código, que ya dice la marca y cómo darse de baja. Pegar esto:

```
No separate confirmation message is sent. The only message a user receives is the verification code they just requested, which identifies the brand and includes opt-out instructions: "Comunidad Latina: tu código de verificación es 482913. Vence en 10 minutos. No se lo pases a nadie. Respondé STOP para no recibir más SMS."
```

Si el campo exige literalmente un mensaje de confirmación, usar este (coherente con 2FA,
sin ofertas):

```
Comunidad Latina: you asked to verify your phone. You'll get one text per code you request. Msg & data rates may apply. Reply HELP for help, STOP to opt out.
```

### Help keywords / Help message

Keywords:

```
HELP, INFO
```

Mensaje:

```
Comunidad Latina: códigos de verificación de tu cuenta. Ayuda / Help: comunidadlatinallc@gmail.com. Pueden aplicarse tarifas de mensajes y datos. Respondé STOP para cancelar / Reply STOP to opt out.
```

### Opt-out keywords / Opt-out message

Keywords:

```
STOP, CANCEL, END, QUIT, UNSUBSCRIBE, STOPALL
```

Mensaje:

```
Comunidad Latina: listo, no vas a recibir más SMS. Respondé START para volver. / You're unsubscribed and won't receive more messages. Reply START to resubscribe.
```

### Privacy policy URL

```
https://www.comunidadlatina.com/legal/privacidad
```

### Terms and conditions URL

```
https://www.comunidadlatina.com/legal/terminos
```

(Reemplazan a los links de Google Drive que se habían cargado.)

### SMS policy URL (si hay un campo para información adicional)

```
SMS terms (Spanish and English on the same page): https://www.comunidadlatina.com/legal/sms
```

### Age-gated content

```
No
```

### Additional information

```
The website home page is public (no login required) and links to the Terms, Privacy Policy and SMS Policy in its footer. The SMS Policy is published in both Spanish and English. The phone verification form itself is only available to signed-in users, so a faithful replica of that screen, with the exact consent text, is shown at https://www.comunidadlatina.com/legal/sms#consentimiento.
```

---

## Qué se corrigió por cada código de rechazo

| Código | Qué decía Twilio | Qué estaba mal | Qué se corrigió |
|---|---|---|---|
| **30491** | Website is password protected or requires login | `next.config.ts` redirigía `/` a `/entrar` (307) para todo el mundo, así que el revisor caía en un login | Se sacó ese redirect. La home es pública para anónimos; quien tiene sesión sigue yendo al feed (lo decide `src/middleware.ts`). Footer con Términos, Privacidad, SMS, razón social y contacto |
| **30496** | Use case and use case summary inconsistent | Categoría y mensaje de opt-in de **marketing** ("actualizaciones, ofertas y contenido exclusivo") para un número que solo manda códigos | Categoría 2FA / Account Notifications y un summary que describe solo códigos de verificación, igual que el sitio y la política |
| **30497** | Use case summary is incomplete | No decía quién recibe, cuándo, cómo se consiente, qué frecuencia ni qué volumen | El summary de arriba cubre qué, quién, cuándo, cómo se da el consentimiento, frecuencia, límites, STOP/HELP y volumen |
| **30507** | Opt-in does not match use case / website details | Opt-in por palabra clave `COMUNIDADLATINA` con un mensaje de suscripción, que no existe en el sitio; políticas en Drive | Opt-in `Web Form`, sin keyword. El texto de consentimiento junto al botón «Enviar código» es el mismo en la pantalla real, en `/legal/sms` y en este formulario (una sola constante en el código). Políticas publicadas en el dominio |
| **30513** | Consent for messaging is a requirement for service | Nada decía que el SMS fuera opcional, y el mensaje de opt-in lo presentaba como una suscripción al servicio | Queda escrito en la pantalla, en `/legal/sms`, en Términos y en el summary: verificar el teléfono es **opcional** y no es condición para usar la plataforma. El SMS se manda solo cuando la persona lo pide |

---

## Para Nacho — pasos en la consola de Twilio

1. **Confirmá que el sitio nuevo ya está en producción** con los dos `curl` del principio
   (tienen que dar `200`). Si no, esperá el deploy: reenviar antes es perder otra vuelta.
2. Entrá a la consola de Twilio → **Phone Numbers → Regulatory Compliance → Toll-Free
   Verifications** (o buscá "Toll-Free Verification" en el buscador de arriba).
3. Abrí la verificación rechazada de **+1 (844) 727-4049**. Si tiene el botón **Edit** o
   **Resubmit**, usalo. Si no aparece, creá una verificación nueva para el mismo número.
4. Reemplazá cada campo con lo que está en este documento, en inglés, tal cual. Lo más
   importante:
   - Categoría: **Two-Factor Authentication (2FA)** (o Account Notifications).
   - Opt-in type: **Web Form**.
   - **Borrá** la keyword `COMUNIDADLATINA` y el mensaje de "Bienvenido… ofertas y
     contenido exclusivo".
   - Cambiá los links de Google Drive por los de `comunidadlatina.com/legal/...`.
5. Configurá las respuestas a STOP y HELP para que digan lo mismo que el formulario:
   **Messaging → Services** → el servicio que tenga este número (si el número no está en
   ninguno, crear uno y agregarlo como sender) → **Opt-Out Management** → activar
   *Advanced Opt-Out* y pegar los mensajes de HELP y STOP de arriba. Si esto no se
   configura, Twilio contesta con su texto genérico en inglés: no traba la aprobación,
   pero es mejor que coincida.
6. Enviá. La respuesta suele tardar unos días hábiles y llega por mail a la casilla de
   notificaciones cargada en el formulario.

**Ojo:** la verificación de teléfono dentro de la app sigue **apagada** a propósito
(`PHONE_VERIFICATION_ENABLED`, por el tema legal de guardar teléfonos). Aprobar el número
no la prende; prenderla es una decisión aparte.
