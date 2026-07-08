# Meshy (3D premium) — estado y cómo usarlo

**Estado (2026-07-08):** la `MESHY_API_KEY` **existe y funciona** (está en `~/.claude.json`,
dentro del bloque `mcpServers["meshy-mcp-server"].env`). Los emblemas 3D del Escudo y del
Trust Score se generaron con ella: 585 créditos gastados, balance 2340 → **1755**.

## ⚠️ El MCP está mal configurado en Windows (falla al arrancar)

Las tools `mcp__meshy-mcp-server__*` aparecen listadas, pero el server **no levanta**:

```
[MCPHealthCheck] meshy-mcp-server is unavailable (spawn npx ENOENT)
```

La causa: en `~/.claude.json` el server usa `"command": "npx"` directo. En Windows `npx` es
un `.cmd`, no un ejecutable — `spawn` no lo encuentra. Los otros servers de este equipo
(`nanobanana`, `blender`) usan `cmd /c npx`, que sí funciona.

**Fix (una línea, requiere reiniciar Claude Code):** en `~/.claude.json`, cambiar

```json
"meshy-mcp-server": { "command": "npx", "args": ["-y", "@meshy-ai/meshy-mcp-server"], ... }
```

por

```json
"meshy-mcp-server": {
  "type": "stdio",
  "command": "cmd",
  "args": ["/c", "npx", "-y", "@meshy-ai/meshy-mcp-server"],
  "env": { "MESHY_API_KEY": "msy_..." }
}
```

## Mientras tanto: la REST API, que es lo que se usó

No hace falta el MCP. El pipeline de emblemas pega contra la API directo y es
reproducible — ver [`assets-source/emblems/`](../assets-source/emblems/):

```bash
export MESHY_API_KEY=msy_...              # nunca se commitea
node assets-source/emblems/generate.mjs --all          # 39 cr por emblema
node assets-source/emblems/process.mjs assets-source/emblems/out/alpha
```

Endpoints usados (todos bajo `https://api.meshy.ai/openapi`):

| Endpoint | Para qué | Costo |
|---|---|---|
| `GET  /v1/balance` | créditos | 0 |
| `POST /v1/text-to-image` | concepto art-dirigido (`nano-banana-pro`) | 9 cr |
| `POST /v1/image-to-3d` | malla + textura; acepta `input_task_id` para encadenar sin descargar | 30 cr |
| `GET  /v1/{kind}/{id}` | polling (`SUCCEEDED`/`FAILED`) | 0 |

### Ajustes que importan (hallados empíricamente, no adivinados)

- **`enable_pbr: false`** — con PBR el render sale brillante y frío; rompe el look mate.
- **`remove_lighting: false`** — conserva la luz cálida horneada del concepto. Con `true`,
  Meshy re-ilumina con su estudio frío y el verde esmeralda se vuelve menta.
- **`alpha_thumbnail: true`** — devuelve `alpha_thumbnail_url`: un render PNG 512×512 RGBA
  del modelo 3D, con fondo transparente. **Es la salida que se consume**; no hace falta
  Blender ni un renderer propio.
- `thumbnail_urls.front/back/left/right` NO son vistas ortográficas: son la misma cámara 3/4
  sobre fondo oscuro. No sirven para un ícono frontal.

### Limitación conocida

`image-to-3d` **no reconstruye bien objetos transparentes ni siluetas planas**. El diamante
necesitó 5 iteraciones: pedía una gema de vidrio y devolvía una placa de esmalte con reborde
oscuro (el mesh extruye un slab y el canto queda sin luz), o un pedrusco grumoso. Se resolvió
pidiendo un **sólido facetado opaco**, con el mismo lenguaje material que el resto del set.

## Alternativa ya conectada (sin Meshy)

El MCP de **Blender** (activo) trae text/image→3D vía **Hyper3D (Rodin)** y **Hunyuan3D**.
Requiere Blender abierto con el addon.

---
Fuentes: [meshy-dev/meshy-mcp-server](https://github.com/meshy-dev/meshy-mcp-server) ·
[Meshy API settings](https://www.meshy.ai/settings/api)
