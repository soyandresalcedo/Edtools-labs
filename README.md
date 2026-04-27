Edtools Labs

AI agent designed to teach STEAM to anyone by leveraging "hands," voice, and
smartphone sensors to turn any device into an interactive lab platform. The
goal is to democratize this kind of education.

This repository contains a Claude-powered kinematics tutor that draws on a
canvas and narrates every step with synchronized captions.

What you see

A student picks a chip or types a kinematics question. The tutor speaks one
short sentence and then draws on an Excalidraw canvas, alternating speech and
strokes step by step. When body intuition would help, an inline Lab card
appears in the chat: predict → tilt the phone → reflect, and the lesson
auto-continues with a handoff back to the teach mode.

Architecture

flowchart LR
  subgraph Client[Browser]
    UI[Sidebar + Chips + Input]
    Hook[useLessonStream]
    Speech["useSpeech queue, prefetch=1"]
    Draw["draw worker, serial Promise chain"]
    Canvas[Excalidraw 800x600]
    Tilt["useTilt / simulated tilt"]
  end

  subgraph Server[Next.js route handlers]
    Lesson["/api/lesson SSE"]
    Tts["/api/tts proxy"]
  end

  subgraph External[External APIs]
    Claude["Anthropic Claude Opus 4.7"]
    Eleven[ElevenLabs TTS]
  end

  UI -->|question + lang + history| Hook
  Hook -->|POST JSON| Lesson
  Lesson -->|messages.stream + tools| Claude
  Claude -->|tool_use deltas| Lesson
  Lesson -->|"SSE tool_call events"| Hook
  Hook -->|speak text| Speech
  Hook -->|"draw_* / clear_canvas"| Draw
  Speech -->|POST text| Tts
  Tts -->|audio/mpeg| Eleven
  Draw -->|skeletons| Canvas
  Tilt -->|sensorSummary| Hook

1. Server orchestration — [src/app/api/lesson/route.ts](src/app/api/lesson/route.ts)

Streams Claude tool calls as Server-Sent Events. Validates each tool_use
against a zod schema from [src/lib/tools.ts](src/lib/tools.ts) before
emitting; invalid tools become tool_error events the client can drop. Free
text outside tools is logged and ignored. The model is fixed to
claude-opus-4-7 (overridable via ANTHROPIC_MODEL,
[src/lib/anthropic.ts](src/lib/anthropic.ts)).

2. Multi-turn history — [src/lib/sessionTypes.ts](src/lib/sessionTypes.ts)

The client sends up to MAX_HISTORY_TURNS = 6 previous turns. The server
reconstructs them as Anthropic user → assistant(tool_use[]) → user(tool_result[])
triples in buildMessages, so Claude sees its own past speak/draw choreography
and keeps the active topic across questions. Each tool_result carries a
short side-effect summary ("canvas cleared", "drawn on canvas", …) instead of
a generic "ok" so the model has an anchor for what each call produced.

3. Tutor modes — [src/prompts/system.ts](src/prompts/system.ts), [src/lib/modeTriggers.ts](src/lib/modeTriggers.ts)

The system prompt forces the model to pick exactly one of MODE 1 (greeting,
speak only), MODE 2 (new topic, must clear_canvas + draw), or MODE 3
(follow-up, never clear, build on the existing canvas). A hard rule blocks
"promised a drawing in speak and emitted no draw_*". When the rule still
fails on a MODE 2 trigger ("explícame…", "show me…", …), the client schedules
one recovery retry with suppressUserLog: true after the failed turn
finishes, so the student just sees the missing drawing appear (see
[src/lib/useLessonStream.ts](src/lib/useLessonStream.ts)).

4. Speech pipeline — [src/lib/useSpeech.ts](src/lib/useSpeech.ts), [src/app/api/tts/route.ts](src/app/api/tts/route.ts)

Two-tier engine: ElevenLabs (proxied, server-side key) with Web Speech
fallback. The queue does prefetch = 1 (generation of frame N+1 runs in
parallel with playback of N) for gap-free narration. Each speak can wait
(cap 1500 ms) on a waitBeforePlay Promise so audio aligns with the draw
associated with the previous sentence. Transient 5xx/429 are retried twice
in the proxy; the engine flips to blocked only after two consecutive
client-side failures, and a passive 60 s probe restores it once the upstream
recovers.

5. Draw worker & log ordering — [src/lib/useLessonStream.ts](src/lib/useLessonStream.ts), [src/components/agent/ConversationLog.tsx](src/components/agent/ConversationLog.tsx)

Each draw_* is appended to a single Promise chain that awaits the speak
immediately before it, so the SSE loop is never blocked but the canvas still
respects "speak says it, draw shows it". Every log entry carries a monotonic
seq captured at SSE-receive time, so a suggest_lab (inserted instantly)
and speak lines (inserted on onStart, behind the TTS queue) render in the
order the model intended — not the order they happened to land in React state.

6. Phone sensors — [src/lib/useTilt.ts](src/lib/useTilt.ts), [src/lib/sensorSummary.ts](src/lib/sensorSummary.ts), [src/prompts/lab-recipes.ts](src/prompts/lab-recipes.ts)

useTilt reads DeviceOrientation (gamma = left/right, beta = forward/back)
and emits debounced events when an angle holds past a per-recipe threshold
for minHoldMs. If the API is missing or denied,
[src/lib/useSimulatedTiltEvents.ts](src/lib/useSimulatedTiltEvents.ts)
provides a drag-driven slider with the same event contract. After the
mission, buildSensorSummary flattens peak angles, hold times, and (when
relevant) a symmetry score into a short string that ships back to
/api/lesson in lab mode — the lab prompt forbids inventing data not in
that summary.

7. Canvas, language, progress





Canvas: Excalidraw with a fixed 800 × 600 logical coordinate system; pen
color is derived from the vector kind
([src/lib/excalidrawOps.ts](src/lib/excalidrawOps.ts) and
[src/components/agent/PenCursor.tsx](src/components/agent/PenCursor.tsx)).



Language: the EN / ES toggle in the sidebar drives both the
system-prompt locale and the ElevenLabs voice ID; Web Speech uses BCP-47
from [src/lib/lang.ts](src/lib/lang.ts).



Progress: lab completions per topic live in localStorage and are
summarized into the prompt as labProgressSummary so the model varies
suggestions ([src/lib/progressStore.ts](src/lib/progressStore.ts)).

Sensor lab (suggest_lab)

The tutor can emit a suggest_lab tool call with a topic and short reason.
The client shows an interactive Lab card inside the conversation (not a
separate sidebar flow). Five canned recipes live in
[src/prompts/lab-recipes.ts](src/prompts/lab-recipes.ts) — velocity
direction, MRU, MRUA, free fall, displacement vs distance — each with per-step
threshold, minHoldMs, and a target tilt direction.

The full loop:





Predict. When the model includes a predict block (2–3 short options),

the card shows them as a pre-tilt hypothesis.



Tilt. useTilt (or the simulator) emits one event per held angle.



Reflect. The lab API (mode=lab,

[src/prompts/lab.ts](src/prompts/lab.ts)) reads only the sensorSummary
 plus the optional predictionChoice and produces 2–4 short speaks.



Handoff. The app auto-continues in mode=teach with a handoffContext

that quotes the lab dialogue, so Claude reconnects the body experience to
 the kinematics point.

Voice (TTS)

Two-tier strategy:





Premium voice (ElevenLabs) — used automatically (EN and ES) when the

server is configured. Audio is generated by the proxy at
 [src/app/api/tts/route.ts](src/app/api/tts/route.ts) and decoded on the
 client via Web Audio. Set in .env.local:



Browser voice (Web Speech API) — fallback when the server is not

configured, when ElevenLabs fails twice in a row, or when the client
 probe finds the proxy unavailable. Native to the browser, no network
 calls or audio assets shipped to the client.

The sidebar shows the active engine ("Premium voice" / "Browser voice") next
to the mute button.

Demo mode (no API key required)

To try the UI without an ANTHROPIC_API_KEY, create .env.local:

DEMO_MODE=1

Four canned scenes are routed from the question text
([src/lib/demoMode.ts](src/lib/demoMode.ts)):





Generic / "speed vs velocity" → scene 1: a ball with velocity and
acceleration arrows, then an inline suggest_lab card (with predict).
Language follows lang in the request body, driven by the sidebar EN/ES
toggle.



"MRU", "uniform motion", "position–time graph", "constant velocity" →
scene 2: road, car, and an x(t) straight line.



"MRUA", "uniformly accelerated", "v–t graph" → scene 3: a v(t) straight
line with positive slope.



"Free fall", "gravity", "drop" → scene 4: ledge, ball, and a downward
gravity arrow labeled g.

Development

pnpm install
pnpm dev        # Next.js on 0.0.0.0; prints LAN URLs for phone testing
pnpm test       # vitest (sensor summary + lab recipes + demo routing)
pnpm build      # production build
pnpm start      # listens on 0.0.0.0
pnpm preview    # build + start

Copy .env.example to .env.local for local config. Also try /poc/tilt
on the device (tilt / sensor PoC); the older /poc/lab page is
diagnostic only — the real lab UX is inline on /.

Phone over HTTPS (sensors require a secure context)

On many phones DeviceOrientation is only exposed in a secure context. Over
plain http://192.168.x.x the browser may not deliver any events. Use an
HTTPS tunnel — recommended Cloudflare quick tunnel:





Keep pnpm dev running (check the console for the chosen port: 3000 or

3001 if Next picked another).



Run cloudflared tunnel --url http://127.0.0.1:3000 (use :3001 if

needed).



On your phone, open the https://….trycloudflare.com URL printed by the

command, and append /poc/tilt for the sensor PoC. The URL changes
 each tunnel run.

Install-free alternative: npx localtunnel@2.0.2 --port 3000.

If your Mac firewall blocks port 3000 over plain HTTP on the LAN, allow
inbound connections for that port.

License

GNU General Public License v3.0 (GPL-3.0)

Acknowledgements / Third-party



Reasoning model: Anthropic Claude Opus 4.7 via
[@anthropic-ai/sdk](https://www.npmjs.com/package/@anthropic-ai/sdk).


Premium voice: ElevenLabs (proxied via
/api/tts). API key + voice IDs are configured server-side and never
reach the client.


Fallback voice: browser-native
SpeechSynthesis Web API.


Canvas: Excalidraw for the rough-sketch
rendering style.

