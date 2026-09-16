# AstroVani — The Cosmic Journey

Voice-first prototype built with React + TypeScript + Vite, Three.js, Node.js + Express, Agora Web SDK, Agora Conversational AI, OpenAI, Murf TTS and Anam Avatar.

## What is included in this build

- App-ID-only Agora RTC (`token=null`) for projects with Primary Certificate disabled.
- Agora Conversational AI with default ARES ASR, OpenAI LLM, Murf TTS and Anam Avatar.
- Voice-first birth-profile collection with session-only structured extraction.
- **Jyotishi** naming across the UI and agent prompt.
- Final-turn-only transcript rendering. Incremental ASR/LLM fragments are buffered and only the latest completed turn is displayed.
- Animated Birth Sky: Navagraha are revealed one-by-one, the active planet glows, its illustrative placement is explained on-screen, and the captured birth location/date/time are shown as context.
- The agent uses the displayed illustrative chart values as its shared prototype context instead of repeatedly saying the calculation engine is in demo mode.
- Kundli, Palmistry and Cosmic Thread scenes.
- An **Explore** chapter that surfaces all 11 capabilities without turning the main journey into a crowded tab bar.
- Sanitized Agora Conversational AI `/join` request logging in the backend terminal.
- TTS and Avatar diagnostics endpoints.

## Run

```bash
cp .env.example .env
# Fill Agora, OpenAI, Murf and Anam credentials
npm install
npm run dev
```

Frontend: `http://localhost:5173`

Backend health: `http://localhost:3000/api/health`

TTS diagnostics: `http://localhost:3000/api/diagnostics/tts`

Avatar diagnostics: `http://localhost:3000/api/diagnostics/avatar`

## Deployment (Vercel frontend, EC2 backend)

| | Host |
|---|---|
| Frontend | `https://astrovaniai.agoraaidemo.in` (Vercel) |
| Backend | `https://astrovani.agoraaidemo.in` (EC2, nginx in front of Node on :3000) |

Two origins, so the app calls the API absolutely and the backend must allow the
frontend origin in CORS. Both sides are already configured in the repo.

**Frontend (Vercel project):**

- Root directory: the repository root. `vercel.json` sets the build for this npm
  workspace: `npm run build -w frontend`, output `frontend/dist`. The `prebuild`
  step downloads the MediaPipe hand-detector assets (~8 MB) into
  `frontend/public`, which is why they are not committed.
- `frontend/.env.production` is committed with
  `VITE_API_BASE_URL=https://astrovani.agoraaidemo.in`. To change the backend
  origin per environment, set `VITE_API_BASE_URL` in the Vercel project's
  environment variables — no trailing slash, no `/api` suffix.
- Add `astrovaniai.agoraaidemo.in` as a domain on the Vercel project and point the
  DNS record at Vercel.

**Backend (EC2):**

- The CORS allow-list in `backend/src/config.ts` already contains
  `https://astrovaniai.agoraaidemo.in`, `https://astrovani.agoraaidemo.in` and
  `http://localhost:5173`, so a redeploy needs no environment change.
  `FRONTEND_URL` **adds** further comma-separated origins — needed for Vercel
  preview deployments, which get their own `*.vercel.app` hostnames:

  ```bash
  FRONTEND_URL=https://astrovani-git-my-branch-acme.vercel.app
  ```

  `*` allows any origin. Restart the backend after changing it.
- nginx only needs to forward `/api` to the Node process, but raise its body limit:
  `/api/palm/analyze` posts base64 palm images and Express accepts up to 8 MB,
  while nginx defaults to 1 MB.

  ```nginx
  location /api/ {
      proxy_pass http://127.0.0.1:3000;
      proxy_http_version 1.1;
      client_max_body_size 16m;
  }
  ```

- Keep HTTPS on both hosts. A page served over HTTPS cannot call a plain-HTTP
  backend, and the microphone and camera capture used by the voice journey and
  Palmistry require a secure origin.

To point a local dev server at the EC2 backend instead of a local one, set
`VITE_API_BASE_URL=https://astrovani.agoraaidemo.in` in `frontend/.env.local`.

## Live integration values

```bash
AGORA_APP_ID=
AGORA_CUSTOMER_ID=
AGORA_CUSTOMER_SECRET=
OPENAI_API_KEY=
MURF_API_KEY=
MURF_VOICE_ID=Matthew
ANAM_API_KEY=
ANAM_AVATAR_ID=960f614f-ea88-47c3-9883-f02094f70874
```

No `AGORA_APP_CERTIFICATE` is required while Primary Certificate is disabled.

## Murf schema used in the Agora start request

```json
{
  "tts": {
    "vendor": "murf",
    "params": {
      "api_key": "<MURF_API_KEY>",
      "base_url": "wss://global.api.murf.ai/v1/speech/stream-input",
      "voiceId": "Matthew",
      "locale": "en-US",
      "rate": 0,
      "pitch": 0,
      "model": "FALCON",
      "sample_rate": 24000
    }
  }
}
```

## Anam schema used in the Agora start request

```json
{
  "avatar": {
    "vendor": "anam",
    "enable": true,
    "params": {
      "api_key": "<ANAM_API_KEY>",
      "avatar_id": "960f614f-ea88-47c3-9883-f02094f70874",
      "agora_uid": "10001",
      "agora_token": "",
      "sample_rate": 24000,
      "quality": "high",
      "video_encoding": "H264"
    }
  }
}
```

## 11 capabilities

1. AI Cosmic Guide
2. Kundli
3. Horoscope Matching
4. Muhurat / Panchang
5. Rashifal
6. Vastu / Feng Shui
7. Remedies Advisor
8. Baby Name
9. Career & Finance
10. Gemstones
11. Palmistry

The main Journey Flow stays cinematic: Arrival → Birth Sky → Kundli → Palmistry → Cosmic Thread → Explore. The Explore chapter presents the full capability set while the conversation remains continuous through Jyotishi.

## Prototype data

Birth-chart and palm outputs are still illustrative/mock data in this milestone. The Birth Sky and Kundli use one consistent mock dataset so the animation, cards and Jyotishi responses do not contradict each other. Replace the backend mock chart service with a deterministic astrology engine later without changing the experience layer.


## Greeting and transcription reliability

This build uses Agora's native `llm.greeting_message` as the only startup greeting path. Keep `AGORA_GREETING_INTERRUPTIBLE=false` and `AGORA_FORCE_GREETING_VIA_SPEAK=false` so the greeting is not interrupted or replayed by a second `/speak` request.

The frontend now renders only final v2 transcription turns. It treats `turn_status: 1`, `final: true`, or `is_final: true` as completion and does not show incremental ASR/LLM fragments.


## Conversation UX refinements

- The visible transcript keeps the full session history and only appends final user/Jyotishi turns.
- The transcript panel is independently scrollable and auto-scrolls to the newest completed turn.
- The greeting is sent after the Anam avatar publishes (with a timed fallback) to avoid sending speech before the avatar/TTS path is ready.
- Entering Birth Sky triggers a Jyotishi introduction that explains the Navagraha animation and asks whether the user wants a guided walkthrough.
- When Jyotishi mentions Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Rahu, or Ketu, the matching body is highlighted in the Birth Sky visualization.

## Conversation-driven UI orchestration

This build enables Agora Conversational AI tools and gives Jyotishi the predefined `_publish_message` tool. The model publishes small semantic JSON commands through Agora Data Stream; the React client validates them against a fixed whitelist and applies the corresponding scene change or planet highlight.

Supported signals include:

```json
{"type":"ui_signal","target":"birth_sky","action":"show"}
{"type":"ui_signal","target":"kundli","action":"show"}
{"type":"ui_signal","target":"palmistry","action":"show"}
{"type":"ui_signal","target":"cosmic_thread","action":"show"}
{"type":"ui_signal","target":"explore","action":"show"}
{"type":"ui_signal","target":"planet","action":"highlight","value":"saturn"}
```

The browser never executes code from the model. Only known targets/actions/planet values are accepted. Set `AGORA_ENABLE_UI_TOOLS=true` in `.env` (enabled by default in `.env.example`).

For voice-collected birth details, the frontend prepares the chart data but waits for Jyotishi's `birth_sky:show` signal before switching chapters. Typed-entry fallback still opens Birth Sky directly.


## UI signal reliability

The voice flow uses the predefined `_publish_message` tool for semantic UI commands. The frontend logs every fully decoded Data Stream packet as `[ConvoAI datastream decoded]`, accepts a whitelisted `ui_signal` from supported content wrappers, and applies it to the React experience router.

For the critical Arrival -> Birth Sky transition, a 2.2 second local safety fallback is also enabled after the birth profile becomes 4/4 complete. `_publish_message` remains the primary path; the fallback prevents the experience from getting stuck if a model turn omits the tool call or a tool packet is not delivered.

### UI signal debugging

If a chapter does not switch, open the browser console and look for:

- `[ConvoAI datastream decoded]` - every fully reconstructed Data Stream JSON packet.
- `[ConvoAI UI signal]` - a whitelisted `_publish_message` command was recognized.
- `[AstroVani] Applying Jyotishi UI signal:` - React applied the command.
- `[AstroVani] No birth_sky ui_signal received in time; applying safe Birth Sky fallback.` - no usable signal arrived, so the critical Arrival -> Birth Sky transition was applied locally after the profile reached 4/4.

## 2026-08-19 Birth Sky reliability fix

This build hardens the Arrival -> Birth Sky transition observed in the attached console log:

- preserves previously captured birth-profile fields (including name) when later extraction turns omit them;
- derives profile completion from the merged 4-field state instead of trusting the extractor's `complete` flag;
- opens Birth Sky deterministically after all four birth fields are captured and the session/chart request completes;
- still supports `_publish_message` for synchronized visual intents;
- recovers a strictly whitelisted `ui_signal` if a provider leaks the JSON into assistant transcription, executes it, and strips that JSON from the visible transcript;
- strengthens the agent prompt so `_publish_message` JSON must never be printed/spoken.

Run `npm install` before `npm run dev` or `npm run build`. The validation environment used to package this archive could not complete dependency installation within its network timeout, so a full build was not executed here.

### UI signal speech-suppression fix

The Conversational AI request now includes an LLM stop sequence for `{"type":"ui_signal"` so that, if a provider/model accidentally serializes `_publish_message` JSON into normal assistant text, generation stops before that control payload reaches the TTS/avatar path. Structured `_publish_message` tool calls remain enabled.

The frontend also strips every valid embedded `ui_signal` object from assistant transcription before it enters visible transcript history, while still applying the recovered UI action. UI control JSON is therefore treated as control-plane data, not user-facing conversation.

## Palm capture validation

Palmistry uses MediaPipe Hand Landmarker in the browser to validate an open, centered, upright and steady palm before enabling capture. After capture the palm is geometrically **rectified** — a three-point affine warp maps the wrist and the outer knuckles onto fixed canonical positions — so crease search bands, the palm mask and the estimated-line templates all share one coordinate space.

### MediaPipe assets are self-hosted

`npm install` is followed automatically by `npm run setup:mediapipe` (wired to `predev`/`prebuild` in `frontend/package.json`). That script copies the tasks-vision WASM out of `node_modules` into `frontend/public/mediapipe/wasm` and downloads `hand_landmarker.task` (~7.5MB) into `frontend/public/models/`. Both paths are gitignored.

This matters: the detector previously loaded from jsDelivr/unpkg plus `storage.googleapis.com` at runtime, and when those were blocked it failed to initialize — which silently disabled hand landmarks, palm rectification, the palm mask and the estimated-line fallback all at once, while still producing confidently-labelled crease guides. The CDNs remain as a fallback, but the app no longer depends on them.

If the detector cannot load from any source, **palm capture is disabled** and the Palmistry panel shows what failed and how to fix it. Without landmarks the crease guides cannot be placed correctly, so declining to capture is preferred over drawing guesses.

To install the assets manually:

```bash
cd frontend && npm run setup:mediapipe        # add -- --force to refresh
```

The script ends with a verification block naming each asset:

```
[setup-mediapipe] --- verification ---
[setup-mediapipe]   WASM  OK      public/mediapipe/wasm/vision_wasm_internal.js
[setup-mediapipe]   model OK      public/models/hand_landmarker.task
```

Both must read `OK`. If the model line says `MISSING`, download it from the URL the script
prints and drop it at `frontend/public/models/hand_landmarker.task` — no other step is needed.

### Capture diagnostics

The captured palm has a **Debug** toggle that draws the detected hand skeleton, the canonical landmark anchors and the palm mask, all projected through the transform the capture actually used. It reads `no landmarks` when a capture fell back to an unrectified crop.
