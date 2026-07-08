# Conectar el MCP de Meshy (3D premium)

**Estado (2026-07-07):** el MCP de Meshy **NO está configurado** en esta máquina. En
`~/.claude.json` solo hay `blender`, `google-ads` y `nanobanana`. La `MESHY_API_KEY`
en `C:\MisProyectos\Armagedon\horno-survivor\.env.local` está **vacía**. Por eso el 3D
premium del proyecto salió por nanobanana + SVG. Para sumar 3D real de Meshy hay que
conectarlo una vez.

## Paso 1 — Conseguir la API key
1. Entrá a https://www.meshy.ai/settings/api
2. Creá una API key (empieza con `msy_...`).

## Paso 2 — Conectar el MCP (una sola vez, global para Claude Code)
La forma más simple (autodetecta Claude Code y escribe la config sola):

```bash
npx add-mcp @meshy-ai/meshy-mcp-server --env MESHY_API_KEY=msy_TU_API_KEY
```

**O** a mano, agregando este bloque a `~/.claude.json` dentro de `"mcpServers"`
(al lado de `nanobanana`), reemplazando la key:

```json
"meshy": {
  "type": "stdio",
  "command": "cmd",
  "args": ["/c", "npx", "-y", "@meshy-ai/meshy-mcp-server"],
  "env": {
    "MESHY_API_KEY": "msy_TU_API_KEY"
  }
}
```

(Uso `cmd /c npx` porque es el patrón que ya funciona para `nanobanana` en este equipo.)

## Paso 3 — Reiniciar Claude Code
Cerrá y reabrí la sesión (o `/mcp` en una sesión interactiva) para que levante el server.
Cuando esté, las tools `mcp__meshy__*` (text-to-3D, image-to-3D, text-to-texture) quedan
disponibles y puedo generar los detalles 3D reales.

## Dónde poner la key para que YO la use en el proyecto (además del MCP)
Ya dejé el placeholder en `.env.local`:
```
MESHY_API_KEY=
```
Completalo con la misma `msy_...`. El pipeline de assets puede consumirla directo por API
(sin depender del MCP) si hiciera falta.

## Alternativa que YA está conectada (sin Meshy)
El MCP de **Blender** (ya activo) trae generación text/image→3D vía **Hyper3D (Rodin)** y
**Hunyuan3D** (`generate_hyper3d_model_via_text`, `generate_hunyuan3d_model`, …). Si querés
3D sin esperar a Meshy, se puede usar eso.

---
Fuentes: [meshy-dev/meshy-mcp-server](https://github.com/meshy-dev/meshy-mcp-server) ·
[@meshy-ai/meshy-mcp-server (npm)](https://www.npmjs.com/package/@meshy-ai/meshy-mcp-server) ·
[Meshy API settings](https://www.meshy.ai/settings/api)
