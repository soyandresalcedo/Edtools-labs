# Edtools Labs

Claude-powered kinematics tutor that draws on a canvas and narrates every
step with synchronized captions.

## How it works

Opus uses the **`speak`** tool (Speech Variant): one short sentence before
each small group of drawings. The client renders that text as a caption and
waits proportionally to its length before the next stroke. Free text
outside tools is ignored—only `speak` plus drawing tools reach the UI.

The UI exposes preset question chips for the supported topics and a
**New lesson** button that clears the canvas.

## Development

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000 and click a chip, or type your own kinematics
question in English.

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

MIT
