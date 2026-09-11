import { useCallback, useEffect, useRef, useState } from 'react';
import AgoraRTC, {
  type IAgoraRTCClient,
  type ICameraVideoTrack,
  type IMicrophoneAudioTrack,
  type IRemoteVideoTrack,
  type UID
} from 'agora-rtc-sdk-ng';
import type { BirthProfile } from '../types';
import { createAgoraRtcSession, speakAgoraAgent, startAgoraAgent, stopAgoraAgent, thinkAgoraAgent } from '../api';

export type AgoraConnectionState = 'idle' | 'connecting' | 'connected' | 'error';
export type TranscriptEvent = { speaker: 'user' | 'agent' | 'system'; text: string };
export type AgentActivityState = 'speaking' | 'silent' | 'listening' | 'unknown';
export type UiSignal = {
  type: 'ui_signal';
  target: 'arrival' | 'birth_sky' | 'kundli' | 'palmistry' | 'cosmic_thread' | 'planet' | 'palm_line' | 'kundli_guidance';
  action: 'show' | 'hide' | 'highlight' | 'reset';
  value?: string;
};

type PendingTurn = {
  speaker: TranscriptEvent['speaker'];
  text: string;
  timer?: number;
};

type RecentUtterance = {
  text: string;
  createdAt: number;
};

export function useAgoraSession(
  onTranscript: (line: string) => void,
  onTranscriptEvent?: (event: TranscriptEvent) => void,
  onUiSignal?: (signal: UiSignal) => void,
  onAgentState?: (state: AgentActivityState) => void,
  onTranscriptProgress?: (event: TranscriptEvent) => void
) {
  const onTranscriptRef = useRef(onTranscript);
  const onTranscriptEventRef = useRef(onTranscriptEvent);
  const onUiSignalRef = useRef(onUiSignal);
  const onAgentStateRef = useRef(onAgentState);
  const onTranscriptProgressRef = useRef(onTranscriptProgress);

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onTranscriptEventRef.current = onTranscriptEvent; }, [onTranscriptEvent]);
  useEffect(() => { onUiSignalRef.current = onUiSignal; }, [onUiSignal]);
  useEffect(() => { onAgentStateRef.current = onAgentState; }, [onAgentState]);
  useEffect(() => { onTranscriptProgressRef.current = onTranscriptProgress; }, [onTranscriptProgress]);

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const micRef = useRef<IMicrophoneAudioTrack | null>(null);
  const cameraRef = useRef<ICameraVideoTrack | null>(null);
  const agentIdRef = useRef<string | null>(null);
  const streamPartsRef = useRef(new Map<string, string[]>());
  const transcriptSeenRef = useRef(new Map<string, number>());
  const pendingTurnsRef = useRef(new Map<string, PendingTurn>());
  const firstAssistantLoggedRef = useRef(false);
  const avatarUidRef = useRef<number | null>(null);
  // Agora/provider builds can echo app-injected or just-spoken assistant text back
  // as a USER transcription packet. Keep a short-lived history so those internal
  // echoes never become fake "YOU" bubbles.
  const syntheticSpeakRef = useRef<RecentUtterance[]>([]);
  const recentAgentUtterancesRef = useRef<RecentUtterance[]>([]);
  const agentActivityRef = useRef<AgentActivityState>('unknown');
  const [state, setState] = useState<AgoraConnectionState>('idle');
  const [error, setError] = useState('');
  const [channel, setChannel] = useState('');
  const [uid, setUid] = useState<number | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [localVideoTrack, setLocalVideoTrack] = useState<ICameraVideoTrack | null>(null);
  const [remoteVideoTrack, setRemoteVideoTrack] = useState<IRemoteVideoTrack | null>(null);
  const [remoteVideoUid, setRemoteVideoUid] = useState<UID | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);

  const emit = useCallback((event: TranscriptEvent) => {
    if (event.speaker === 'agent') {
      rememberRecentUtterance(recentAgentUtterancesRef.current, event.text, 12000);
    }
    const prefix = event.speaker === 'agent' ? 'Jyotishi' : event.speaker === 'user' ? 'You' : 'System';
    onTranscriptRef.current(`${prefix}: ${event.text}`);
    onTranscriptEventRef.current?.(event);
  }, []);

  const clearPendingTurns = useCallback(() => {
    for (const pending of pendingTurnsRef.current.values()) {
      if (pending.timer) window.clearTimeout(pending.timer);
    }
    pendingTurnsRef.current.clear();
  }, []);

  const cleanupRtc = useCallback(async () => {
    clearPendingTurns();
    micRef.current?.stop();
    micRef.current?.close();
    cameraRef.current?.stop();
    cameraRef.current?.close();
    micRef.current = null;
    cameraRef.current = null;
    setLocalVideoTrack(null);
    setRemoteVideoTrack(null);
    setRemoteVideoUid(null);
    const client = clientRef.current;
    clientRef.current = null;
    if (client) {
      try { await client.leave(); } catch { /* already left */ }
    }
  }, [clearPendingTurns]);

  const finalizeTurn = useCallback((key: string) => {
    const pending = pendingTurnsRef.current.get(key);
    if (!pending) return;
    if (pending.timer) window.clearTimeout(pending.timer);
    pendingTurnsRef.current.delete(key);
    let normalized = pending.text.trim();
    if (!normalized) return;

    if (pending.speaker === 'user' && shouldSuppressUserEcho(
      normalized,
      syntheticSpeakRef.current,
      recentAgentUtterancesRef.current,
      agentActivityRef.current
    )) {
      console.debug('[ConvoAI] Suppressed synthetic/assistant echo reported as user transcription:', normalized);
      return;
    }

    // _publish_message can be delivered by some ConvoAI builds as a user-role
    // transcription packet even though it is a control-plane event. Always remove
    // valid UI signals regardless of the reported speaker before rendering.
    const leaked = extractEmbeddedUiSignals(normalized);
    if (leaked.signals.length) {
      for (const signal of leaked.signals) {
        console.warn('[ConvoAI] Recovered ui_signal leaked into transcript:', pending.speaker, signal);
        onUiSignalRef.current?.(signal);
      }
      normalized = leaked.cleanText;
      if (!normalized) return;
    }
    const dedupeKey = `text:${pending.speaker}:${normalized}`;
    if (isDuplicateTranscript(transcriptSeenRef.current, dedupeKey, 30000)) return;
    if (pending.speaker === 'agent' && !firstAssistantLoggedRef.current) {
      firstAssistantLoggedRef.current = true;
      console.log('[ConvoAI transcript] first final assistant event:', { key, text: normalized });
    }
    emit({ speaker: pending.speaker, text: normalized });
  }, [emit]);

  const queueTranscript = useCallback((message: Record<string, unknown>, speaker: TranscriptEvent['speaker'], transcriptText: string) => {
    const key = transcriptTurnKey(message, speaker);
    const previous = pendingTurnsRef.current.get(key);
    if (previous?.timer) window.clearTimeout(previous.timer);

    const pending: PendingTurn = { speaker, text: transcriptText };
    pendingTurnsRef.current.set(key, pending);

    if (hasExplicitFinalFlag(message)) {
      finalizeTurn(key);
      return;
    }

    const data = message.data && typeof message.data === 'object' ? message.data as Record<string, unknown> : undefined;
    const hasFinalMetadata = message.turn_status !== undefined || data?.turn_status !== undefined ||
      message.is_final !== undefined || data?.is_final !== undefined ||
      message.final !== undefined || data?.final !== undefined;

    // For v2 transcription packets with explicit final metadata, never render partials.
    // Keep replacing the buffered text until the final packet arrives.
    if (hasFinalMetadata) return;

    // Fallback only for deployments that do not expose a final flag.
    pending.timer = window.setTimeout(() => finalizeTurn(key), 1600);
  }, [finalizeTurn]);

  const processMessage = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text) return;
    try {
      const message = JSON.parse(text) as Record<string, unknown>;
      const object = String(message.object || message.type || '').toLowerCase();

      // Log fully decoded Data Stream packets before filtering. This makes it
      // possible to verify how _publish_message is represented by the active
      // Conversational AI release/provider combination.
      console.debug('[ConvoAI datastream decoded]', message);

      // _publish_message is treated as semantic UI intent only. Different
      // ConvoAI builds may wrap the tool result in message.user, another message
      // object, or under data.content, so inspect only known content fields rather
      // than hard-requiring one object name. The payload still has to pass the
      // strict whitelist in parseUiSignal().
      const signal = extractUiSignal(message);
      if (signal) {
        console.log('[ConvoAI UI signal]', signal);
        onUiSignalRef.current?.(signal);
        return;
      }

      if (object.includes('message.state') || object === 'agent_state') {
        const activity = getAgentActivityState(message);
        agentActivityRef.current = activity;
        console.debug('[ConvoAI agent state]', activity, message);
        onAgentStateRef.current?.(activity);
        return;
      }
      if (object.includes('transcription')) {
        console.debug('[ConvoAI transcript packet]', {
          object,
          turn_id: message.turn_id ?? (message.data as any)?.turn_id,
          turn_status: message.turn_status ?? (message.data as any)?.turn_status,
          final: message.final ?? (message.data as any)?.final,
          is_final: message.is_final ?? (message.data as any)?.is_final
        });
      }
      let transcriptText = getTranscriptText(message);
      if (!transcriptText) return;
      const speaker = getSpeaker(message);
      if (speaker === 'system') return;

      // Strip leaked UI JSON BEFORE it enters the transcript buffer. In some
      // ConvoAI/provider combinations _publish_message arrives with a USER role.
      // It is still a private UI control event and must never become a chat bubble.
      const leaked = extractEmbeddedUiSignals(transcriptText);
      if (leaked.signals.length) {
        for (const signal of leaked.signals) {
          console.warn('[ConvoAI] Intercepted transcript-carried ui_signal:', speaker, signal);
          onUiSignalRef.current?.(signal);
        }
        transcriptText = leaked.cleanText;
        if (!transcriptText) return;
      }
      if (speaker === 'agent') {
        // Expose the in-progress assistant transcription only to visual state.
        // Visible transcript history still waits for the final packet below.
        onTranscriptProgressRef.current?.({ speaker: 'agent', text: transcriptText });
      }

      queueTranscript(message, speaker, transcriptText);
      return;
    } catch {
      // Plain text is treated as a completed assistant turn.
    }

    if (text.length < 1000 && !text.startsWith('{') && /[A-Za-z\u0900-\u0D7F]/.test(text)) {
      const key = `plain-agent`;
      const pending = pendingTurnsRef.current.get(key);
      if (pending?.timer) window.clearTimeout(pending.timer);
      const next: PendingTurn = { speaker: 'agent', text };
      pendingTurnsRef.current.set(key, next);
      next.timer = window.setTimeout(() => finalizeTurn(key), 850);
    }
  }, [finalizeTurn, queueTranscript]);

  const handleDataStream = useCallback((data: Uint8Array) => {
    try {
      const raw = new TextDecoder().decode(data);
      const segments = raw.split('|');
      if (segments.length >= 4) {
        const [messageId, partIndexRaw, totalRaw, ...payloadParts] = segments;
        const partIndex = Number(partIndexRaw) - 1;
        const total = Number(totalRaw);
        const base64Part = payloadParts.join('|');
        if (messageId && Number.isInteger(partIndex) && partIndex >= 0 && Number.isInteger(total) && total > 0) {
          const parts = streamPartsRef.current.get(messageId) ?? Array(total).fill('');
          if (parts.length !== total) parts.length = total;
          parts[partIndex] = base64Part;
          streamPartsRef.current.set(messageId, parts);
          if (parts.every(Boolean)) {
            streamPartsRef.current.delete(messageId);
            processMessage(decodeBase64Utf8(parts.join('')));
          }
          return;
        }
      }
      processMessage(raw);
    } catch (err) {
      console.warn('Unable to decode Agora data stream message', err);
    }
  }, [processMessage]);

  const speak = useCallback(async (text: string, options?: { interruptable?: boolean }) => {
    const id = agentIdRef.current;
    const normalized = text.trim();
    if (!id || !normalized) return;

    // Register BEFORE the request. Some deployments publish the mirrored USER
    // transcription before the HTTP /speak call resolves.
    const syntheticKey = rememberRecentUtterance(syntheticSpeakRef.current, normalized, 20000);
    try {
      await speakAgoraAgent(id, normalized, options?.interruptable ?? true);
    } catch (error) {
      removeRecentUtterance(syntheticSpeakRef.current, syntheticKey);
      throw error;
    }

    if (!isDuplicateTranscript(transcriptSeenRef.current, `text:agent:${normalized}`, 30000)) {
      emit({ speaker: 'agent', text: normalized });
    }
  }, [emit]);

  const ask = useCallback(async (text: string) => {
    const id = agentIdRef.current;
    const normalized = text.trim();
    if (!id || !normalized) return;
    // Render the button action as a real user turn immediately and seed dedupe so a
    // provider echo of the injected input cannot create a second chat bubble.
    isDuplicateTranscript(transcriptSeenRef.current, `text:user:${normalized}`, 30000);
    emit({ speaker: 'user', text: normalized });
    await thinkAgoraAgent(id, normalized);
  }, [emit]);

  const stop = useCallback(async () => {
    const agentId = agentIdRef.current;
    agentIdRef.current = null;
    setAgentId(null);
    if (agentId) {
      try { await stopAgoraAgent(agentId); } catch (err) { console.warn('Agent stop failed', err); }
    }
    syntheticSpeakRef.current = [];
    recentAgentUtterancesRef.current = [];
    agentActivityRef.current = 'unknown';
    await cleanupRtc();
    setChannel('');
    setUid(null);
    setState('idle');
    setError('');
    emit({ speaker: 'system', text: 'Agora session ended.' });
  }, [cleanupRtc, emit]);

  const start = useCallback(async (profile?: BirthProfile) => {
    if (state === 'connecting' || state === 'connected') return;
    clearPendingTurns();
    transcriptSeenRef.current.clear();
    syntheticSpeakRef.current = [];
    recentAgentUtterancesRef.current = [];
    agentActivityRef.current = 'unknown';
    firstAssistantLoggedRef.current = false;
    setState('connecting');
    setError('');
    try {
      const rtc = await createAgoraRtcSession();
      setChannel(rtc.channel);
      setUid(rtc.uid);
      avatarUidRef.current = rtc.avatarUid;

      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      clientRef.current = client;

      client.on('connection-state-change', (curState) => {
        if (curState === 'CONNECTED') setState('connected');
        if (curState === 'DISCONNECTED') setState('idle');
      });

      client.on('user-joined', user => console.log('[Agora RTC] remote user joined:', user.uid));
      client.on('user-published', async (user, mediaType) => {
        console.log('[Agora RTC] remote user published:', user.uid, mediaType);
        await client.subscribe(user, mediaType);
        if (mediaType === 'audio') user.audioTrack?.play();
        if (mediaType === 'video' && user.videoTrack) {
          setRemoteVideoTrack(user.videoTrack);
          setRemoteVideoUid(user.uid);
          // Greeting is sequenced by the backend after the agent reaches RUNNING.
          // Do not trigger another greeting when the avatar video appears.
        }
      });

      client.on('user-unpublished', (_user, mediaType) => {
        if (mediaType === 'video') {
          setRemoteVideoTrack(null);
          setRemoteVideoUid(null);
        }
      });

      client.on('stream-message', (_uid, data) => handleDataStream(data));

      await client.join(rtc.appId, rtc.channel, null, rtc.uid);
      // Palmistry captures its frames from this same camera source rather than opening a
      // competing getUserMedia session, so the encoder profile also sets the ceiling on
      // palm-crease detail. 1080p_2 asks getUserMedia for 1920x1080 at 30fps, which is
      // ~2.25x the pixels of 720p for the cropped palm region. Costs more upstream
      // bandwidth; drop back to '720p_2' if that becomes a problem on slower networks.
      const [mic, camera] = await AgoraRTC.createMicrophoneAndCameraTracks(
        { AEC: true, ANS: true, AGC: true },
        { encoderConfig: '1080p_2' }
      );
      micRef.current = mic;
      cameraRef.current = camera;
      setLocalVideoTrack(camera);
      await client.publish([mic, camera]);

      const agent = await startAgoraAgent({ channel: rtc.channel, clientUid: rtc.uid, profile });
      agentIdRef.current = agent.agent_id;
      setAgentId(agent.agent_id);
      setState('connected');
      // The greeting is delivered natively by Agora and will arrive through the normal transcript stream.
      // Do not synthesize or replay it from the frontend.
      emit({ speaker: 'system', text: `Agora connected · channel ${rtc.channel}` });
      emit({ speaker: 'system', text: `Conversational AI agent ${agent.status || agent.state || 'started'}.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to connect to Agora.';
      setError(message);
      setState('error');
      emit({ speaker: 'system', text: message });
      await cleanupRtc();
    }
  }, [cleanupRtc, clearPendingTurns, emit, handleDataStream, state]);

  const toggleMic = useCallback(async () => {
    const next = !micEnabled;
    await micRef.current?.setEnabled(next);
    setMicEnabled(next);
  }, [micEnabled]);

  const toggleCamera = useCallback(async () => {
    const next = !cameraEnabled;
    await cameraRef.current?.setEnabled(next);
    setCameraEnabled(next);
  }, [cameraEnabled]);

  useEffect(() => () => { void cleanupRtc(); }, [cleanupRtc]);

  return {
    state, error, channel, uid, micEnabled, cameraEnabled,
    localVideoTrack, remoteVideoTrack, remoteVideoUid, agentId,
    start, stop, speak, ask, toggleMic, toggleCamera
  };
}

function normalizeEchoText(text: string) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9\u0900-\u0D7F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pruneRecentUtterances(items: RecentUtterance[], ttlMs: number) {
  const cutoff = Date.now() - ttlMs;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].createdAt < cutoff) items.splice(index, 1);
  }
}

function rememberRecentUtterance(items: RecentUtterance[], text: string, ttlMs: number) {
  pruneRecentUtterances(items, ttlMs);
  const normalized = normalizeEchoText(text);
  if (!normalized) return '';
  items.push({ text: normalized, createdAt: Date.now() });
  if (items.length > 12) items.splice(0, items.length - 12);
  return normalized;
}

function removeRecentUtterance(items: RecentUtterance[], normalizedText: string) {
  if (!normalizedText) return;
  const index = items.findIndex(item => item.text === normalizedText);
  if (index >= 0) items.splice(index, 1);
}

function consumeMatchingRecentUtterance(items: RecentUtterance[], text: string, ttlMs: number) {
  pruneRecentUtterances(items, ttlMs);
  const normalized = normalizeEchoText(text);
  const index = items.findIndex(item => item.text === normalized);
  if (index < 0) return false;
  items.splice(index, 1);
  return true;
}

function isTransitionEchoPhrase(text: string) {
  const normalized = normalizeEchoText(text);
  return /^(?:your )?(?:kundli|birth sky|palmistry|cosmic thread) (?:is opening now|is now open)$/.test(normalized);
}

function shouldSuppressUserEcho(
  text: string,
  syntheticSpeaks: RecentUtterance[],
  recentAgentUtterances: RecentUtterance[],
  activity: AgentActivityState
) {
  // Strongest signal: this exact text was injected through the app's /speak API.
  if (consumeMatchingRecentUtterance(syntheticSpeaks, text, 20000)) return true;

  // Some ConvoAI builds duplicate a normal assistant turn as a USER packet. Only
  // suppress an exact, very recent assistant match to avoid broad keyword filters.
  if (consumeMatchingRecentUtterance(recentAgentUtterances, text, 8000)) return true;

  // Transition announcements are application/agent control phrases, never genuine
  // user utterances in this app. Some ConvoAI deployments report the mirrored
  // /speak text after the agent has already moved from `speaking` to `listening`,
  // so gating this rule on live activity lets the echo leak into the transcript
  // and (more importantly) makes Kundli think the user has started a real turn.
  // Suppress these exact transition phrases regardless of the current agent state.
  if (isTransitionEchoPhrase(text)) return true;

  return false;
}

function getAgentActivityState(message: Record<string, unknown>): AgentActivityState {
  const data = message.data && typeof message.data === 'object' ? message.data as Record<string, unknown> : undefined;
  const raw = String(message.state ?? data?.state ?? message.status ?? data?.status ?? '').toLowerCase();
  if (raw.includes('speak')) return 'speaking';
  if (raw.includes('silent') || raw.includes('idle')) return 'silent';
  if (raw.includes('listen')) return 'listening';
  return 'unknown';
}

function decodeBase64Utf8(value: string) {
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const allowedUiTargets = new Set(['arrival', 'birth_sky', 'kundli', 'palmistry', 'cosmic_thread', 'planet', 'palm_line', 'kundli_guidance']);
const allowedUiActions = new Set(['show', 'hide', 'highlight', 'reset']);
const allowedPlanets = new Set(['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn', 'rahu', 'ketu']);
const allowedPalmLines = new Set(['heart_line', 'head_line', 'life_line', 'fate_line']);
const allowedGuidanceKinds = new Set(['puja', 'mantra', 'gemstone', 'practice']);

function parseUiSignal(content: string): UiSignal | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed.type !== 'ui_signal') return null;
    const target = String(parsed.target || '');
    const action = String(parsed.action || '');
    const value = parsed.value === undefined ? undefined : String(parsed.value).toLowerCase();
    if (!allowedUiTargets.has(target) || !allowedUiActions.has(action)) return null;
    if (target === 'planet') {
      if (action !== 'highlight' || !value || !allowedPlanets.has(value)) return null;
    } else if (target === 'palm_line') {
      if (action !== 'highlight' || !value || !allowedPalmLines.has(value)) return null;
    } else if (target === 'kundli_guidance') {
      if (action !== 'highlight' || !value || !allowedGuidanceKinds.has(value)) return null;
    } else if (action === 'highlight') {
      return null;
    }
    return { type: 'ui_signal', target: target as UiSignal['target'], action: action as UiSignal['action'], ...(value ? { value } : {}) };
  } catch {
    return null;
  }
}

function extractEmbeddedUiSignals(text: string): { signals: UiSignal[]; cleanText: string } {
  // Compatibility path for providers/models that accidentally print tool payloads
  // into assistant transcription instead of invoking _publish_message structurally.
  // Remove ALL valid ui_signal JSON objects from user-visible transcript text.
  const candidates = text.match(/\{[^{}]{0,500}\}/g) ?? [];
  const signals: UiSignal[] = [];
  let cleanText = text;
  for (const candidate of candidates) {
    const signal = parseUiSignal(candidate);
    if (!signal) continue;
    signals.push(signal);
    cleanText = cleanText.replace(candidate, '');
  }
  return {
    signals,
    cleanText: cleanText
      .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  };
}

function extractUiSignal(message: Record<string, unknown>): UiSignal | null {
  const candidates: unknown[] = [message.content, message.text, message.payload];
  const data = message.data;
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    candidates.push(record.content, record.text, record.payload);
  }

  // Some deployments may already decode content into an object. Others deliver
  // the JSON command as a string. Support both while keeping strict validation.
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const signal = parseUiSignal(candidate.trim());
      if (signal) return signal;
    } else if (candidate && typeof candidate === 'object') {
      try {
        const signal = parseUiSignal(JSON.stringify(candidate));
        if (signal) return signal;
      } catch { /* ignore non-serializable data */ }
    }
  }

  // Last resort: if the entire decoded packet itself is the UI signal.
  try {
    return parseUiSignal(JSON.stringify(message));
  } catch {
    return null;
  }
}

function transcriptTurnKey(message: Record<string, unknown>, speaker: TranscriptEvent['speaker']) {
  const data = message.data && typeof message.data === 'object' ? message.data as Record<string, unknown> : undefined;
  const turnId = message.turn_id ?? data?.turn_id;
  const messageId = message.message_id ?? message.id ?? data?.message_id ?? data?.id;
  if (turnId !== undefined) return `${speaker}:turn:${String(turnId)}`;
  if (messageId !== undefined) return `${speaker}:message:${String(messageId)}`;
  return `${speaker}:current`;
}

function hasExplicitFinalFlag(message: Record<string, unknown>) {
  const data = message.data && typeof message.data === 'object' ? message.data as Record<string, unknown> : undefined;
  const turnStatus = message.turn_status ?? data?.turn_status;
  if (turnStatus === 1 || turnStatus === '1' || turnStatus === 'final' || turnStatus === 'completed') return true;
  const candidates = [message.is_final, message.final, data?.is_final, data?.final];
  return candidates.some(value => value === true || value === 1 || value === '1' || value === 'true' || value === 'final');
}

function isDuplicateTranscript(seen: Map<string, number>, key: string, windowMs = 15000) {
  const now = Date.now();
  for (const [entry, ts] of seen) {
    if (now - ts > windowMs) seen.delete(entry);
  }
  const previous = seen.get(key);
  if (previous && now - previous < windowMs) return true;
  seen.set(key, now);
  return false;
}

function getTranscriptText(message: Record<string, unknown>) {
  const direct = [message.text, message.transcript, message.content].find(value => typeof value === 'string' && value.trim());
  if (typeof direct === 'string') return direct.trim();
  const data = message.data;
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const nested = [record.text, record.transcript, record.content].find(value => typeof value === 'string' && value.trim());
    if (typeof nested === 'string') return nested.trim();
  }
  return '';
}

function getSpeaker(message: Record<string, unknown>): TranscriptEvent['speaker'] {
  const object = String(message.object || message.type || '').toLowerCase();
  if (object === 'assistant.transcription' || object.includes('assistant') || object.includes('agent')) return 'agent';
  if (object === 'user.transcription' || object.includes('user')) return 'user';

  const value = String(message.speaker || message.role || message.source || message.user_type || '').toLowerCase();
  if (value.includes('agent') || value.includes('assistant') || value.includes('bot')) return 'agent';
  if (value.includes('user') || value.includes('human') || value.includes('remote')) return 'user';
  if (message.turn_status !== undefined) return 'agent';
  if (message.final !== undefined || message.user_id !== undefined) return 'user';
  return 'system';
}
