import type { PalmResult } from '../types';

type Line = PalmResult['lines'][number];

/** Straight-line span and the ratio of path length to that span (1 = straight). */
function shape(points: Line['points']) {
  if (points.length < 4) return undefined;
  let path = 0;
  for (let i = 1; i < points.length; i++) path += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  const first = points[0], last = points[points.length - 1];
  const span = Math.hypot(last[0] - first[0], last[1] - first[1]);
  if (span < 0.05) return undefined;
  // Sign changes in direction along the dominant axis = wiggles.
  const horizontal = Math.abs(last[0] - first[0]) >= Math.abs(last[1] - first[1]);
  let turns = 0, prev = 0;
  for (let i = 1; i < points.length; i++) {
    const d = horizontal ? points[i][1] - points[i - 1][1] : points[i][0] - points[i - 1][0];
    if (Math.abs(d) < 0.006) continue;
    const sign = Math.sign(d);
    if (prev && sign !== prev) turns++;
    prev = sign;
  }
  return { span, curl: path / span, turns };
}

const MEANING: Record<string, { long: string; short: string; curved: string; straight: string }> = {
  heart_line: {
    long: 'traditionally read as an expressive, open emotional style',
    short: 'traditionally read as a more reserved, private way of showing feeling',
    curved: 'often linked to warmth and openness in relationships',
    straight: 'often linked to a measured, practical approach to relationships'
  },
  head_line: {
    long: 'traditionally read as thorough, far-sighted thinking',
    short: 'traditionally read as quick, direct decision-making',
    curved: 'often linked to imagination and flexible thinking',
    straight: 'often linked to a logical, analytical thinking style'
  },
  life_line: {
    long: 'traditionally read as steady energy and resilience (never as lifespan)',
    short: 'traditionally read as a more variable energy rhythm (never as lifespan)',
    curved: 'a wide arc is traditionally read as vitality and enthusiasm',
    straight: 'a flatter path is traditionally read as a calmer, reserved energy'
  },
  fate_line: {
    long: 'traditionally read as a strong sense of direction',
    short: 'traditionally read as a path shaped by changes and choices',
    curved: 'often linked to shifts of direction in work',
    straight: 'often linked to a steady, consistent working path'
  }
};

/**
 * One specific sentence describing the traced path of a line, with the matching
 * traditional meaning. Only for lines that were actually traced; returns undefined
 * when the trace is too thin to describe honestly.
 */
export function palmLineSpecifics(line: Line): string | undefined {
  if (line.status !== 'detected' && line.status !== 'approximate') return undefined;
  const s = shape(line.points);
  const meaning = MEANING[line.id];
  if (!s || !meaning) return undefined;

  const lengthScale = line.id === 'life_line' || line.id === 'fate_line' ? s.span / 0.55 : s.span / 0.62;
  const long = lengthScale >= 0.9, short = lengthScale < 0.62;
  const curved = s.curl >= 1.16;
  const straight = s.curl < 1.07;
  const parts: string[] = [];
  parts.push(long ? 'long' : short ? 'short' : 'medium-length');
  parts.push(curved ? 'noticeably curved' : straight ? 'fairly straight' : 'gently curved');
  if (s.turns >= 3) parts.push('slightly wavy');

  const meanings = [long ? meaning.long : short ? meaning.short : '', curved ? meaning.curved : straight ? meaning.straight : '']
    .filter(Boolean);
  const reading = meanings.length ? ` In palmistry this is ${meanings.join('; ')}.` : '';
  const morphology = line.observation && line.observation !== 'indeterminate' ? ` It looks ${line.observation}.` : '';
  return `Your ${line.name.toLowerCase()} traces as ${parts.join(', ')}.${morphology}${reading}`;
}
