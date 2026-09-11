import { randomInt } from 'node:crypto';

export function makeChannelName(prefix = 'astrovani') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeRtcUid() {
  return randomInt(100000, 999999999);
}
