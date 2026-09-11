import type { BirthProfile, BirthProfileExtraction, ChartData, PalmResult } from './types';

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status})`);
  return body as T;
}

export async function createSession(profile: BirthProfile) {
  return json<{ sessionId: string; chart: ChartData }>(await fetch('/api/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile)
  }));
}

export async function extractBirthProfile(transcript: string[], current: Partial<BirthProfile>) {
  return json<BirthProfileExtraction>(await fetch('/api/profile/extract', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript, current })
  }));
}

export async function createAgoraRtcSession() {
  return json<{
    appId: string;
    channel: string;
    uid: number;
    authentication: 'app-id-only';
    agentUid: number;
    avatarUid: number;
  }>(await fetch('/api/agora/rtc-session', { method: 'POST' }));
}

export async function startAgoraAgent(input: { channel: string; clientUid: number; profile?: BirthProfile }) {
  return json<{ agent_id: string; status?: string; state?: string; greeting_text?: string; greeting_sent?: boolean }>(await fetch('/api/agora/agent/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
  }));
}

export async function greetAgoraAgent(agentId: string) {
  return json<{ success: boolean; text: string }>(await fetch('/api/agora/agent/greet', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId })
  }));
}

/**
 * Re-brief a running agent on the generated chart. Called once voice onboarding has all
 * four birth details, because the agent joined before they existed.
 */
export async function updateAgentChart(agentId: string, profile: BirthProfile) {
  return json<{ success: boolean; chart: ChartData }>(await fetch('/api/agora/agent/chart', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId, profile })
  }));
}

export async function speakAgoraAgent(agentId: string, text: string, interruptable = true) {
  return json<{ success: boolean }>(await fetch('/api/agora/agent/speak', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId, text, interruptable })
  }));
}

export async function thinkAgoraAgent(agentId: string, text: string) {
  return json<{ success: boolean }>(await fetch('/api/agora/agent/think', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId, text })
  }));
}

export async function updateAgentPalm(agentId: string, profile: Partial<BirthProfile> | undefined, palm: PalmResult) {
  return json<{ success: boolean }>(await fetch('/api/agora/agent/palm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId, profile, palm })
  }));
}

export async function stopAgoraAgent(agentId: string) {
  return json<{ success: boolean }>(await fetch('/api/agora/agent/stop', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId })
  }));
}

export async function analyzePalm(
  imageDataUrl: string,
  enhancedImageDataUrl?: string,
  creaseCandidateImageDataUrl?: string,
  cvCandidates?: unknown[],
  // Present only when the capture was rectified into canonical palm space, which lets
  // the backend apply exact anatomical bounds instead of permissive generic ones.
  thumbSide?: 'left' | 'right'
) {
  return json<PalmResult>(await fetch('/api/palm/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageDataUrl, enhancedImageDataUrl, creaseCandidateImageDataUrl, cvCandidates, thumbSide })
  }));
}
