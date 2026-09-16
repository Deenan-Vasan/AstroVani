import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Resolve the project-root .env explicitly. This works in both src/ (dev)
// and dist/ (production), and does not depend on the process working directory.
const rootEnvPath = fileURLToPath(new URL('../../.env', import.meta.url));
const envResult = dotenv.config({ path: rootEnvPath });

if (envResult.error && process.env.NODE_ENV !== 'production') {
  console.warn(`[config] Could not load ${rootEnvPath}: ${envResult.error.message}`);
}

function boolEnv(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1','true','yes','on'].includes(raw.trim().toLowerCase());
}

function numberEnv(name: string, fallback: number, allowZero = false) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  if (allowZero) return value >= 0 ? value : fallback;
  return value > 0 ? value : fallback;
}

function listEnv(name: string) {
  return (process.env[name] || '').split(',').map(v => v.trim().replace(/\/+$/, '')).filter(Boolean);
}

/**
 * Frontend origins that are always allowed through CORS. The deployed site lives on
 * a different host than this API (frontend: astrovaniai, backend: astrovani), so
 * every browser call to it is cross-origin. Baked in so a backend deploy needs no
 * extra environment config; FRONTEND_URL adds to this list rather than replacing
 * it, for Vercel preview domains and one-off hosts.
 */
const KNOWN_FRONTEND_ORIGINS = [
  'http://localhost:5173',
  'https://astrovaniai.agoraaidemo.in',
  // Same-origin callers, e.g. hitting the API host directly or a future co-hosted build.
  'https://astrovani.agoraaidemo.in'
];

export const config = {
  port: Number(process.env.PORT || 3000),
  frontendUrls: [...new Set([...KNOWN_FRONTEND_ORIGINS, ...listEnv('FRONTEND_URL')])],
  mockMode: (process.env.MOCK_MODE ?? 'true') === 'true',
  agora: {
    appId: (process.env.AGORA_APP_ID || '').trim(),
    customerId: (process.env.AGORA_CUSTOMER_ID || '').trim(),
    customerSecret: (process.env.AGORA_CUSTOMER_SECRET || '').trim(),
    convoAiBaseUrl: process.env.AGORA_CONVO_AI_BASE_URL || 'https://api.agora.io/api/conversational-ai-agent/v2/projects',
    agentUid: numberEnv('AGORA_AGENT_UID', 10000),
    avatarUid: numberEnv('AGORA_AVATAR_UID', 10001),
    avatarToken: (process.env.AGORA_AVATAR_TOKEN || '').trim(),
    agentIdleTimeoutSeconds: numberEnv('AGORA_AGENT_IDLE_TIMEOUT_SECONDS', 120),
    asrLanguageHints: (process.env.AGORA_ASR_LANGUAGE_HINTS || 'en,hi,ta,te,mr,kn').split(',').map(v => v.trim()).filter(Boolean),
    greeting: process.env.AGORA_AGENT_GREETING || 'Namaste. Welcome to AstroVani, The Cosmic Journey. Together we can explore your birth sky, Kundli, palm, and life timeline through a live visual journey. To begin, tell me your name in any language.',
    greetingInterruptible: boolEnv('AGORA_GREETING_INTERRUPTIBLE', false),
    forceGreetingViaSpeak: boolEnv('AGORA_FORCE_GREETING_VIA_SPEAK', false),
    enableUiTools: boolEnv('AGORA_ENABLE_UI_TOOLS', true)
  },
  openai: {
    apiKey: (process.env.OPENAI_API_KEY || '').trim(),
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    visionModel: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    url: process.env.OPENAI_LLM_URL || 'https://api.openai.com/v1/chat/completions'
  },
  anam: {
    apiKey: (process.env.ANAM_API_KEY || '').trim(),
    avatarId: (process.env.ANAM_AVATAR_ID || '960f614f-ea88-47c3-9883-f02094f70874').trim(),
    sampleRate: numberEnv('ANAM_SAMPLE_RATE', 24000),
    quality: (process.env.ANAM_QUALITY || 'high').trim(),
    videoEncoding: (process.env.ANAM_VIDEO_ENCODING || 'H264').trim(),
    extraParamsJson: (process.env.ANAM_EXTRA_PARAMS_JSON || '').trim()
  },
  murf: {
    apiKey: (process.env.MURF_API_KEY || '').trim(),
    baseUrl: (process.env.MURF_BASE_URL || 'wss://global.api.murf.ai/v1/speech/stream-input').trim(),
    voiceId: (process.env.MURF_VOICE_ID || 'Matthew').trim(),
    locale: (process.env.MURF_LOCALE || 'en-US').trim(),
    rate: numberEnv('MURF_RATE', 0, true),
    pitch: numberEnv('MURF_PITCH', 0, true),
    model: (process.env.MURF_MODEL || 'FALCON').trim(),
    sampleRate: numberEnv('MURF_SAMPLE_RATE', 24000)
  }
};
