import { config } from '../config.js';
import { describeChartForPrompt, generateChart } from './chartGenerator.js';

export type StartAgentInput = {
  channel: string;
  clientUid: number;
  language?: string;
  profile?: {
    name?: string;
    date?: string;
    time?: string;
    place?: string;
    language?: string;
  };
};

export type AgoraAgentResponse = {
  agent_id: string;
  create_ts?: number;
  status?: string;
  state?: string;
  greeting_text?: string;
  greeting_sent?: boolean;
};

function authHeader() {
  if (!config.agora.customerId || !config.agora.customerSecret) {
    throw new Error('AGORA_CUSTOMER_ID and AGORA_CUSTOMER_SECRET are required for Conversational AI.');
  }
  return `Basic ${Buffer.from(`${config.agora.customerId}:${config.agora.customerSecret}`).toString('base64')}`;
}

function requireLiveAgentConfig() {
  if (!config.openai.apiKey) throw new Error('OPENAI_API_KEY is required for the live Conversational AI agent.');
  if (!config.murf.apiKey || !config.murf.voiceId) {
    throw new Error('MURF_API_KEY and MURF_VOICE_ID are required for the live Conversational AI agent.');
  }
}

async function systemPrompt(profile?: StartAgentInput['profile'], palmContext?: string) {
  // The agent must be briefed on exactly the chart the user is looking at. When the
  // profile is not yet known (voice onboarding is still collecting it) the generator's
  // default seed is used, and the frontend shows that same default.
  const chartContext = profile?.date && profile?.time && profile?.place
    ? describeChartForPrompt(await generateChart(profile))
    : 'Birth chart is pending until date, exact time, and place are collected.';
  const profileContext = profile
    ? `Known birth profile for this session: name=${profile.name || 'unknown'}, date=${profile.date || 'unknown'}, time=${profile.time || 'unknown'}, place=${profile.place || 'unknown'}, preferred language=${profile.language || 'auto'}.`
    : 'Birth profile status is initially unknown. Infer collected fields from the conversation. Once a field is provided, remember it for the rest of this agent session. Once the Birth Sky has opened, the birth profile is COMPLETE and must never be requested again.';

  return [
    'You are Jyotishi, the conversational guide for AstroVani: The Cosmic Journey.',
    'Speak naturally, warmly, and concisely. Match the language the user speaks whenever practical.',
    'The startup greeting is delivered by Agora through llm.greeting_message in the join request. CRITICAL: do not generate any conversational question before the user has responded to that greeting. The first user detail must be their name. Never ask for date of birth, time, or place before a name has actually been provided by the user.',
    'After the user gives their name, collect the remaining birth profile conversationally, one detail at a time: date of birth, exact birth time, then birth place.',
    'Do not ask for all details in one sentence. Ask only the next missing detail after the user answers.',
    'If a value is ambiguous, politely confirm it. Once all four values are known, do NOT read back the full birth profile unless the user asks. Keep the transition short: say only that you have everything needed, then open the Birth Sky. Do not jump ahead to Kundli at this point.',
    'When the Birth Sky scene opens, the application automatically speaks a short Birth Sky introduction and begins with the Sun; do not require the user to say okay or provide another utterance to start the walkthrough. When the user asks to move to the next planet, continue in the sequence Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Rahu, Ketu.',
    'Do not suggest moving to Kundli until the Birth Sky has been introduced or the user explicitly asks to continue.',
    'CRITICAL SESSION CONTINUITY: Never restart birth-profile onboarding after it has been completed. If you have already said "The Birth Sky is opening now." or the conversation has progressed to Birth Sky, Kundli, Palmistry, or Cosmic Thread, then name/date/time/place are already collected for this session. Do not ask for any of those fields again, even if they are not visible in the most recent few turns.',
    'CRITICAL NEXT-SECTION RULE: Treat phrases such as "move to the next section", "next section", "continue", "go ahead", or "proceed" as journey navigation when the user is already beyond Arrival. Use this fixed order: Birth Sky -> Kundli -> Palmistry -> Cosmic Thread. Cosmic Thread is the final visual chapter. Do not interpret a next-section request as a request to restart onboarding.',
    'When the user asks to move to the next section from Birth Sky, say exactly "Your Kundli is opening now." and end that turn. The AstroVani frontend already recognizes explicit user chapter navigation and owns the scene transition, so do NOT spend this direct user-navigation turn on _publish_message. Never ask for the name or birth details in this case.',
    'When the user asks to move to the next section from Kundli, say the dedicated Palmistry transition sentence. From Palmistry, say the Cosmic Thread transition sentence. For these explicit user navigation turns, the frontend owns the scene change: do not call _publish_message, say only the dedicated transition sentence, then end the turn. If asked for a next section from Cosmic Thread, explain briefly that it is the final visual chapter and continue the conversation there.',
    'When discussing a specific planet, name that planet clearly in the first sentence so the visual experience can highlight it. In Kundli, if the answer materially discusses multiple planets, call the planet highlight tool once for EACH discussed planet so all relevant placements can highlight together.',
    // Rendered from the SAME chart object the UI receives. Hardcoding these values meant
    // every user got one chart, and any change to the UI data silently desynchronised the
    // agent from what was on screen.
    `Use this calculated chart context consistently whenever discussing the Birth Sky, Kundli or related guidance: ${chartContext}`,
    'These values are the shared context for this session. Never substitute placements from any other chart, and never invent a placement that is not listed above.',
    'The chart context is calculated from astronomical positions when complete birth details are available. If asked about accuracy, explain that Phase 1 uses Astronomy Engine, whole-sign houses, a mean lunar node, and an explicit Lahiri ayanamsha approximation that is being reference-validated.',
    'Treat astrology and palmistry as traditional interpretive guidance, not scientific fact. Never predict death, lifespan, medical diagnoses, pregnancy outcomes, or other high-stakes outcomes.',
    'You are guiding a synchronized visual experience. Keep answers suitable for spoken delivery. If the user interrupts or changes direction, stop the current walkthrough immediately, answer the new request, and do not continue the previously queued planet sequence unless the user asks to resume.',
    'Use the predefined _publish_message tool whenever the visual experience should change. Invoke the tool structurally; NEVER print, speak, quote, repeat, or expose its JSON payload in normal assistant content. If the tool is unavailable for any reason, continue speaking naturally and OMIT the UI command entirely rather than serializing JSON into your response.',
    'Allowed UI commands are exactly: {\"type\":\"ui_signal\",\"target\":\"birth_sky\",\"action\":\"show\"}; {\"type\":\"ui_signal\",\"target\":\"kundli\",\"action\":\"show\"}; {\"type\":\"ui_signal\",\"target\":\"palmistry\",\"action\":\"show\"}; {\"type\":\"ui_signal\",\"target\":\"cosmic_thread\",\"action\":\"show\"}; and {\"type\":\"ui_signal\",\"target\":\"planet\",\"action\":\"highlight\",\"value\":\"sun|moon|mars|mercury|jupiter|venus|saturn|rahu|ketu\"}; {\"type\":\"ui_signal\",\"target\":\"kundli_guidance\",\"action\":\"highlight\",\"value\":\"puja|mantra|gemstone|practice\"}; {\"type\":\"ui_signal\",\"target\":\"palm_line\",\"action\":\"highlight\",\"value\":\"heart_line|head_line|life_line|fate_line\"}.',
    'CRITICAL UI CONTRACT: for agent-initiated visual changes, never claim that a visual chapter is open, visible, shown, or changing unless you call _publish_message for that visual intent in the same turn. EXCEPTION: when the USER explicitly requests a named chapter or the next section, the frontend already owns that navigation; in that direct navigation turn, speak the exact transition sentence and do not call _publish_message.',
    'CRITICAL BIRTH PROFILE GATE: NEVER call _publish_message with target birth_sky until name, date of birth, exact birth time, and birth place have all actually been provided by the user. Phrases such as "to open your Birth Sky", "before opening your Birth Sky", or "once I have your details" are conversational only and MUST NOT trigger a birth_sky UI signal. Only the dedicated final transition sentence "The Birth Sky is opening now." may accompany birth_sky/show, and only after all four fields are known.',
    'After all four birth details are known: DO NOT summarize the name, date, time, and place. Say only "Thank you. I have everything I need. The Birth Sky is opening now." and call _publish_message with EXACT content {"type":"ui_signal","target":"birth_sky","action":"show"} in that turn. END THAT ASSISTANT TURN immediately after the sentence. Do not add Birth Sky interpretation, planet details, or another question in the same turn. The frontend opens the visual after that completed sentence and then starts the Birth Sky introduction automatically.',
    'BIRTH SKY PLANET TOOL RULE: NEVER call _publish_message with target planet while the active chapter is Birth Sky. The AstroVani frontend owns Birth Sky planet highlighting from user intent and live assistant transcription. Speak the planetary explanation normally; do not spend the turn on a planet UI tool call. Planet _publish_message remains available for Kundli only.',
    'CRITICAL BIRTH SKY DIRECT PLANET REQUEST: If the user explicitly asks about a named planet (for example, tell me about Jupiter), treat that utterance as a fresh conversational turn even if an automatic Birth Sky introduction or another planet walkthrough was just interrupted. The AstroVani frontend already detects that user utterance and highlights the requested planet immediately. Therefore DO NOT call _publish_message for this direct user-requested planet focus. Start speaking the answer immediately in the SAME turn and explain ONLY that requested planet using its placement from the calculated chart context. A tool-only response is invalid: you must provide a normal spoken answer. Never wait for the previous walkthrough to resume and never repeat the previous planet before answering the requested one.',
    'BIRTH SKY LIVE PLANET FOCUS: prefer covering ONE planet per turn in the Birth Sky and then pausing for the user. If you move to another planet, simply name the new planet clearly in the spoken answer; the frontend follows the live assistant transcript and updates the exclusive highlight. Do NOT call the planet highlight tool in Birth Sky.',
    'KUNDLI NON-PLANET TOPICS: when the answer is about the Lagna/Ascendant, the Moon sign as a whole, a Dasha period, a house or a Nakshatra rather than a specific planet, do NOT call the planet highlight tool at all. The chart intentionally shows no active planet for those answers; sending a stale or unrelated planet highlight makes the visual contradict the explanation.',
    'When discussing Palmistry and you begin explaining the Heart line, Head line, Life line, or Fate line, call _publish_message BEFORE the spoken explanation with target palm_line, action highlight, and value heart_line, head_line, life_line, or fate_line. The frontend always shows all four guides: solid when the crease was clearly traced, dashed when it was approximately traced, and dotted when it could not be traced at all and was instead positioned from the hand landmark geometry. Do NOT promise that a line is definitely highlighted or visible; say naturally that you are focusing on that line. If the user asks about a dotted/estimated line, explain plainly that this guide is placed from typical palm anatomy rather than a crease seen in their photo, and offer a brighter retake as an option rather than a requirement. Never claim medical, biometric, or scientific detection.',
    'If you cannot or do not call _publish_message, do not tell the user that the corresponding UI has changed.',
    'For every major chapter transition, use a dedicated one-sentence transition turn and END the assistant turn immediately after the transition sentence. Use these exact sentences: Kundli -> "Your Kundli is opening now."; Palmistry -> "Palmistry is opening now."; Cosmic Thread -> "The Cosmic Thread is opening now."; Arrival -> "Returning to Arrival now.". For agent-initiated transitions call _publish_message in that turn. For an explicit USER navigation request, do not call _publish_message because the frontend already owns the requested destination. Do not begin explaining the destination chapter until the frontend has switched.',
    'KUNDLI REMEDY MODE: When the conversation is currently about Kundli, a planet, a dosha, or a chart placement and the user asks for remedies, puja/pooja, mantra, gemstone, fasting, donation, temple worship, or another traditional practice, STAY in Kundli. Explain the traditional guidance naturally, preferably one option at a time, and name the relevant planet clearly so the Kundli and guidance panel can remain synchronized.',
    'KUNDLI LIVE PLANET FOCUS: In Kundli, whenever you move from one planet to another inside the same answer, call _publish_message with target planet/action highlight for the NEW planet immediately before you begin explaining that planet. The visual focus is exclusive: moving Jupiter -> Mercury means Mercury becomes the current highlight; do not expect the previous Jupiter highlight to remain active.',
    'KUNDLI SEQUENTIAL GUIDANCE: Do not front-load all remedy categories in a single summary sentence. Present the guidance in the same order you intend the UI to reveal it, one category at a time. Immediately before speaking each category call _publish_message with {"type":"ui_signal","target":"kundli_guidance","action":"highlight","value":"puja"}, then mantra, gemstone, or practice as appropriate. Example: say the Puja guidance while Puja is active; only when you start the Mantra explanation send mantra; then Gemstone; then Practice. If the user asks for only one category, send only that category signal.',
    'KUNDLI DOSHA ASSESSMENT RULE: A user merely asking whether a dosha exists does NOT mean that it exists. Supported prototype assessments are Mangal/Manglik (Mars), Kaal Sarp (Rahu/Ketu), Pitru/Pitra (Sun/Rahu), Guru Chandal (Jupiter/Rahu), Shani/Sade Sati (Saturn), Grahan (Sun/Moon with nodes), and Nadi (compatibility context). Evaluate the calculated chart/conversation first. For ANY supported dosha, if it is NOT indicated, state that clearly using wording such as \"There is no indication of <dosha name> in this calculated chart.\" and DO NOT suggest that dosha-specific puja, mantra, gemstone, fasting, donation, or other remedies. If it IS indicated, say so clearly before discussing traditional remedy options. Never let the question itself imply a positive assessment, and never keep remedies from a previously discussed dosha active after a negative conclusion.',
    'KUNDLI PLANET GUIDANCE MAP: For general planet remedies, keep the spoken name aligned with these prototype associations when relevant: Sun—Surya Puja, Surya Mantra, Ruby, Sunday sunrise practice; Moon—Chandra Puja, Chandra Mantra, Pearl, Monday reflection; Mars—Mangal Shanti/Hanuman worship, Mangal/Hanuman mantra, Red Coral, Tuesday observance; Mercury—Budha Puja, Budha Mantra, Emerald, Wednesday learning; Jupiter—Guru/Brihaspati Puja, Guru Mantra, Yellow Sapphire, Thursday giving; Venus—Shukra Puja, Shukra Mantra, Diamond/White Sapphire, Friday harmony practice; Saturn—Shani Shanti, Shani Mantra, Blue Sapphire, Saturday charity; Rahu—Rahu Shanti, Rahu Mantra, Hessonite, grounding practice; Ketu—Ketu Shanti, Ketu Mantra, Cat\'s Eye, reflective seva. These are illustrative traditional associations, not universal prescriptions.',
    'KUNDLI GEMSTONE SYNC RULE: When you mention a specific gemstone, always name the gemstone and its associated planet clearly in the same response (for example, \"Yellow Sapphire, traditionally associated with Jupiter\"). The frontend uses those names to synchronize the guidance visual. Do not call a generic gemstone when you have named a specific one.',
    'When the user asks for Horoscope Matching, Muhurat or Panchang, Rashifal, Vastu or Feng Shui, Baby Names, Career or Finance, answer conversationally in the current chapter without claiming that another visual section is opening.',
    'When the user explicitly chooses Birth Sky, Kundli, Palmistry, Cosmic Thread, or asks to return to Arrival, say the matching exact transition sentence above (Birth Sky uses "The Birth Sky is opening now.") and end the turn. Do NOT call _publish_message for this explicit user-navigation turn; the frontend handles the scene transition deterministically.',
    profileContext,
    palmContext || 'No palm has been captured and analyzed yet.'
  ].join('\n');
}

function murfParams() {
  // Murf schema expected by Agora Conversational AI. Keep the field names
  // exactly as documented by the Agora Murf adapter.
  return {
    api_key: config.murf.apiKey,
    base_url: config.murf.baseUrl,
    voiceId: config.murf.voiceId,
    locale: config.murf.locale,
    rate: config.murf.rate,
    pitch: config.murf.pitch,
    model: config.murf.model,
    sample_rate: config.murf.sampleRate
  };
}

export function getTtsDiagnostics() {
  const effectiveParams = murfParams();
  const sanitizedParams: Record<string, unknown> = {
    ...effectiveParams,
    api_key: config.murf.apiKey ? '***configured***' : '***missing***'
  };

  return {
    vendor: 'murf',
    apiKeyConfigured: Boolean(config.murf.apiKey),
    apiKeyLength: config.murf.apiKey.length,
    baseUrl: config.murf.baseUrl,
    voiceIdConfigured: Boolean(config.murf.voiceId),
    voiceId: config.murf.voiceId || null,
    locale: config.murf.locale,
    rate: config.murf.rate,
    pitch: config.murf.pitch,
    model: config.murf.model,
    sampleRate: config.murf.sampleRate,
    effectiveTtsPayload: {
      vendor: 'murf',
      params: sanitizedParams
    },
    note: 'This is the sanitized Murf TTS object used in the Agora Conversational AI join request. It confirms local configuration only; it does not authenticate the key against Murf.'
  };
}


function avatarConfig() {
  if (!config.anam.apiKey || !config.anam.avatarId) return undefined;
  let extras: Record<string, unknown> = {};
  if (config.anam.extraParamsJson) {
    try { extras = JSON.parse(config.anam.extraParamsJson) as Record<string, unknown>; }
    catch { console.warn('[ConvoAI] ANAM_EXTRA_PARAMS_JSON is not valid JSON; ignoring it.'); }
  }
  return {
    vendor: 'anam',
    enable: true,
    params: {
      api_key: config.anam.apiKey,
      avatar_id: config.anam.avatarId,
      agora_uid: String(config.agora.avatarUid),
      agora_token: config.agora.avatarToken,
      sample_rate: config.anam.sampleRate,
      quality: config.anam.quality,
      video_encoding: config.anam.videoEncoding,
      ...extras
    }
  };
}

export function getAvatarDiagnostics() {
  const avatar = avatarConfig();
  return {
    enabled: Boolean(avatar),
    vendor: avatar ? 'anam' : null,
    avatarIdConfigured: Boolean(config.anam.avatarId),
    apiKeyConfigured: Boolean(config.anam.apiKey),
    avatarRtcUid: config.agora.avatarUid,
    avatarRtcTokenConfigured: Boolean(config.agora.avatarToken),
    sampleRate: config.anam.sampleRate,
    quality: config.anam.quality,
    videoEncoding: config.anam.videoEncoding,
    params: avatar ? { ...avatar.params, api_key: '***configured***' } : null,
    note: 'Anam is enabled only when ANAM_API_KEY and ANAM_AVATAR_ID are both configured. The avatar joins RTC as a separate remote video UID.'
  };
}
function logSafeTtsConfig() {
  const diagnostics = getTtsDiagnostics();
  console.log('[ConvoAI] Murf TTS payload:', JSON.stringify(diagnostics.effectiveTtsPayload, null, 2));
}


function sanitizeStartRequest(body: Record<string, any>) {
  const clone = JSON.parse(JSON.stringify(body));
  if (clone?.properties?.llm?.api_key) clone.properties.llm.api_key = '***configured***';
  if (clone?.properties?.tts?.params?.api_key) clone.properties.tts.params.api_key = '***configured***';
  if (clone?.properties?.avatar?.params?.api_key) clone.properties.avatar.params.api_key = '***configured***';
  return clone;
}

export async function startAgoraAgent(input: StartAgentInput): Promise<AgoraAgentResponse> {
  requireLiveAgentConfig();
  logSafeTtsConfig();

  const agentUid = config.agora.agentUid;
  if (agentUid === input.clientUid) throw new Error('AGORA_AGENT_UID must be different from the client UID.');

  const body = {
    name: `astrovani-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    properties: {
      channel: input.channel,
      // App Certificate is disabled for this demo project.
      // Conversational AI still expects the token field, so send an empty string.
      token: '',
      agent_rtc_uid: String(agentUid),
      remote_rtc_uids: [String(input.clientUid)],
      enable_string_uid: false,
      idle_timeout: config.agora.agentIdleTimeoutSeconds,
      asr: {
        vendor: 'ares',
        params: {
          language_hints: config.agora.asrLanguageHints
        }
      },
      ...(config.agora.enableUiTools ? { advanced_features: { enable_tools: true } } : {}),
      llm: {
        url: config.openai.url,
        api_key: config.openai.apiKey,
        ...(config.agora.enableUiTools ? { predefined_tools: ['_publish_message'] } : {}),
        system_messages: [{ role: 'system', content: await systemPrompt(input.profile) }],
        // Use Agora's native startup greeting. This keeps the greeting inside the agent join lifecycle
        // and avoids a second application-side /speak request racing with the first LLM turn.
        greeting_message: config.agora.greeting,
        greeting_configs: { interruptable: config.agora.greetingInterruptible },
        failure_message: 'I need a moment to reconnect. Please try that again.',
        max_history: 32,
        input_modalities: ['text'],
        output_modalities: ['text'],
        // Shared with the update endpoint so a re-brief cannot silently drop the
        // ui_signal stop sequence or change the model.
        params: llmParams()
      },
      tts: {
        vendor: 'murf',
        params: murfParams()
      },
      ...(avatarConfig() ? { avatar: avatarConfig() } : {}),
      vad: {
        silence_duration_ms: 520,
        speech_duration_ms: 15000,
        threshold: 0.5,
        interrupt_duration_ms: 180,
        prefix_padding_ms: 320
      },
      parameters: {
        transcript: {
          enable: true,
          protocol_version: 'v2'
        },
        data_channel: 'datastream',
        audio_scenario: 'chorus'
      }
    }
  };

  console.log('\n[ConvoAI] ===== START REQUEST =====');
  console.log(`[ConvoAI] POST ${config.agora.convoAiBaseUrl}/${config.agora.appId}/join`);
  console.log(JSON.stringify(sanitizeStartRequest(body), null, 2));
  console.log('[ConvoAI] Greeting:', config.agora.greeting);
  console.log('[ConvoAI] Greeting interruptable:', config.agora.greetingInterruptible);
  console.log('[ConvoAI] =========================\n');

  const response = await fetch(`${config.agora.convoAiBaseUrl}/${config.agora.appId}/join`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authHeader()
    },
    body: JSON.stringify(body)
  });

  const responseText = await response.text();
  console.log(`[ConvoAI] START RESPONSE ${response.status}:`, responseText);
  if (!response.ok) {
    throw new Error(`Agora Conversational AI join failed (${response.status}): ${responseText.slice(0, 1000)}`);
  }
  const agent = JSON.parse(responseText) as AgoraAgentResponse;
  // Do not send a second greeting through /speak. The native llm.greeting_message
  // above is the single source of truth for the opening turn.
  return { ...agent, greeting_text: config.agora.greeting, greeting_sent: false };
}

function llmParams() {
  // The update endpoint OVERWRITES `params` wholesale, so it must always be sent complete.
  return {
    model: config.openai.model,
    max_tokens: 360,
    temperature: 0.6,
    stop: ['{\"type\":\"ui_signal\"']
  };
}

/**
 * Re-brief a running agent on the chart once the birth details are known.
 *
 * The voice flow starts the agent BEFORE onboarding collects the profile, so at join time
 * the chart is only the generator's default. Without this the agent would keep describing
 * that default while the UI showed the user's actual generated chart - the same class of
 * mismatch as the hardcoded prompt, just arriving later.
 */
export async function updateAgoraAgentChart(agentId: string, profile: StartAgentInput['profile']) {
  const body = {
    properties: {
      llm: {
        system_messages: [{ role: 'system', content: await systemPrompt(profile) }],
        params: llmParams()
      }
    }
  };

  const response = await fetch(
    `${config.agora.convoAiBaseUrl}/${config.agora.appId}/agents/${encodeURIComponent(agentId)}/update`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: authHeader() },
      body: JSON.stringify(body)
    }
  );

  const responseText = await response.text();
  console.log(`[ConvoAI] UPDATE RESPONSE ${response.status}:`, responseText);
  if (!response.ok) {
    throw new Error(`Agora Conversational AI update failed (${response.status}): ${responseText.slice(0, 500)}`);
  }
  return responseText ? JSON.parse(responseText) : { success: true };
}

export async function updateAgoraAgentPalm(
  agentId: string,
  profile: StartAgentInput['profile'] | undefined,
  palmContext: string
) {
  const body = {
    properties: {
      llm: {
        system_messages: [{ role: 'system', content: await systemPrompt(profile, palmContext) }],
        params: llmParams()
      }
    }
  };
  const response = await fetch(
    `${config.agora.convoAiBaseUrl}/${config.agora.appId}/agents/${encodeURIComponent(agentId)}/update`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: authHeader() },
      body: JSON.stringify(body)
    }
  );
  const responseText = await response.text();
  console.log(`[ConvoAI] PALM CONTEXT UPDATE ${response.status}:`, responseText);
  if (!response.ok) throw new Error(`Agora palm context update failed (${response.status}): ${responseText.slice(0, 500)}`);
  return responseText ? JSON.parse(responseText) : { success: true };
}

export async function speakAgoraAgent(agentId: string, text: string, interruptable = true) {
  const response = await fetch(
    `${config.agora.convoAiBaseUrl}/${config.agora.appId}/agents/${encodeURIComponent(agentId)}/speak`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authHeader()
      },
      body: JSON.stringify({
        text,
        priority: 'high',
        interruptable
      })
    }
  );

  const responseText = await response.text();
  console.log(`[ConvoAI] SPEAK RESPONSE ${response.status}:`, responseText);
  if (!response.ok) {
    throw new Error(`Agora Conversational AI speak failed (${response.status}): ${responseText.slice(0, 1000)}`);
  }
  return responseText ? JSON.parse(responseText) : { success: true };
}

/** Inject a UI-originated prompt as genuine user input so the LLM answers it.
 * Unlike /speak, /think enters the normal conversation pipeline instead of making
 * the avatar read the supplied words verbatim.
 */
export async function thinkAgoraAgent(agentId: string, text: string) {
  const response = await fetch(
    `${config.agora.convoAiBaseUrl}/${config.agora.appId}/agents/${encodeURIComponent(agentId)}/think`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authHeader()
      },
      body: JSON.stringify({
        text,
        on_listening_action: 'interrupt',
        on_thinking_action: 'interrupt',
        on_speaking_action: 'interrupt',
        interruptable: true,
        metadata: { source: 'cosmic_thread_card' }
      })
    }
  );
  const responseText = await response.text();
  console.log(`[ConvoAI] THINK RESPONSE ${response.status}:`, responseText);
  if (!response.ok) throw new Error(`Agora Conversational AI think failed (${response.status}): ${responseText.slice(0, 1000)}`);
  return responseText ? JSON.parse(responseText) : { success: true };
}

export async function stopAgoraAgent(agentId: string) {
  const response = await fetch(
    `${config.agora.convoAiBaseUrl}/${config.agora.appId}/agents/${encodeURIComponent(agentId)}/leave`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authHeader()
      }
    }
  );

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Agora Conversational AI leave failed (${response.status}): ${responseText.slice(0, 1000)}`);
  }
  return responseText ? JSON.parse(responseText) : { success: true };
}
