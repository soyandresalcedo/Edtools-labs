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
- **Sensores / HTTPS:** si `DeviceOrientation` no emite eventos con
  `http://192.168.x.x`, usa un túnel con HTTPS (p. ej. Cloudflare Tunnel hacia
  `http://127.0.0.1:3000`).

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
