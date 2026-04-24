# Edtools Labs

AI agent designed to teach STEAM to anyone by leveraging "hands," voice, and
smartphone sensors to turn any device into an interactive lab platform. The
goal is to democratize this kind of education.

This repository contains a **Claude-powered kinematics tutor** that draws on a
canvas and narrates every step with synchronized captions.

## How it works

Opus uses the **`speak`** tool (Speech Variant): one short sentence before
each small group of drawings. The client renders that text as a caption and
aligns stroke timing with speech where possible. Free text
outside tools is ignored—only `speak` plus drawing tools reach the UI.

The UI exposes preset question chips for the supported topics and a
**New lesson** button that clears the canvas.

## Development

```bash
pnpm install
pnpm dev
```

Al arrancar se listan URLs en **LAN** (misma Wi‑Fi) para abrir en el móvil.
En el teléfono prueba también `/poc/tilt` (tilt / sensores).

- **Local:** http://localhost:3000 — chip o pregunta en inglés de cinemática.
- **Móvil (HTTP):** usa la IP que imprime la consola; si el firewall del Mac
  bloquea el puerto 3000, permite conexiones entrantes.
- **Sensores / HTTPS:** en muchos móviles `DeviceOrientation` solo está disponible
  en *secure context*; con `http://192.168.x.x` el navegador puede no exponer
  siquiera el API. Úsalo vía túnel HTTPS (recomendado: **Cloudflare quick tunnel**):
  1. Deja `pnpm dev` en marcha (mira en consola si usas el puerto 3000 o 3001).
  2. `cloudflared tunnel --url http://127.0.0.1:3000` (cambia a `:3001` si Next
     eligió otro puerto).
  3. Abre en el teléfono la URL `https://….trycloudflare.com` que imprime el
     comando, y añade `/poc/tilt` para la PoC de sensores. La URL **cambia** en
     cada arranque del túnel. Alternativa sin instalar: `npx localtunnel@2.0.2 --port 3000`.

Variables de entorno: copia `.env.example` a `.env.local`.

```bash
pnpm build          # producción (incluye assets TTS en public/vendors-tts)
pnpm start          # sirve en 0.0.0.0
pnpm preview        # build + start
```

## Demo mode (no API key required)

To try the UI without an `ANTHROPIC_API_KEY`, create `.env.local`:

```env
DEMO_MODE=1
```

Four canned scenes are routed from the question text:

- Generic / "speed vs velocity" → scene 1: a ball with velocity and
  acceleration arrows.
- "MRU", "uniform motion", "position–time graph", "constant velocity" →
  scene 2: road, car and x(t) straight line.
- "MRUA", "uniformly accelerated", "v–t graph" → scene 3: v(t) straight
  line with positive slope.
- "Free fall", "gravity", "drop" → scene 4: ledge, ball and a downward
  gravity arrow labeled `g`.

## License

[GNU General Public License v3.0](LICENSE) (GPL-3.0)
