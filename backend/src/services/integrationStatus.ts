import { config } from '../config.js';

export function getIntegrationStatus() {
  return {
    mode: config.mockMode ? 'mock-astrology' : 'live',
    agoraRtc: Boolean(config.agora.appId),
    agoraConversationalAi: Boolean(config.agora.customerId && config.agora.customerSecret),
    openai: Boolean(config.openai.apiKey),
    anam: Boolean(config.anam.apiKey && config.anam.avatarId),
    murf: Boolean(config.murf.apiKey && config.murf.voiceId),
    astrology: 'mock'
  };
}
