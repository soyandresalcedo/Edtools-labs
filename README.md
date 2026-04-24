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

On startup the console prints **LAN** URLs (same Wi‑Fi) for testing on a phone.
Also try `/poc/tilt` on the device (tilt / sensor PoC).

- **Local:** http://localhost:3000 — use a chip or type a kinematics question in English.
- **Phone over HTTP:** use the IP printed in the console; if your Mac firewall
  blocks port 3000, allow inbound connections for that port.
- **Sensors / HTTPS:** on many phones `DeviceOrientation` is only available in a
  *secure context*; over `http://192.168.x.x` the browser may not expose the API
  at all. Use an HTTPS tunnel (recommended: **Cloudflare quick tunnel**):
  1. Keep `pnpm dev` running (check the console for port 3000 vs 3001).
  2. Run `cloudflared tunnel --url http://127.0.0.1:3000` (use `:3001` if Next
     picked another port).
  3. On your phone open the `https://….trycloudflare.com` URL printed by the
     command, and append `/poc/tilt` for the sensor PoC. The URL **changes** each
     time you start a new tunnel. Install-free alternative:
     `npx localtunnel@2.0.2 --port 3000`.

Environment: copy `.env.example` to `.env.local`.

```bash
pnpm build          # production (includes TTS assets under public/vendors-tts)
pnpm start          # listens on 0.0.0.0
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
