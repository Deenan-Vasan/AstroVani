import { useCallback, useEffect, useRef, useState } from 'react';
import { createSession, extractBirthProfile, updateAgentChart, updateAgentPalm } from './api';
import { TopBar } from './components/TopBar';
import { GuidePanel } from './components/GuidePanel';
import { JourneyRail } from './components/JourneyRail';
import { BirthForm } from './components/BirthForm';
import { BirthSkyScene } from './scenes/BirthSkyScene';
import { KundliScene } from './scenes/KundliScene';
import { PalmScene, type PalmLineId } from './scenes/PalmScene';
import { CosmicThreadScene } from './scenes/CosmicThreadScene';
import { useAgoraSession, type AgentActivityState, type TranscriptEvent, type UiSignal } from './hooks/useAgoraSession';
import type { BirthProfile, ChartData, PalmResult, SceneName } from './types';

/*
 * ERROR-PATH PLACEHOLDER ONLY.
 *
 * The live chart now comes from the backend generator, seeded by the birth details, so
 * every user gets their own. This constant renders only if `/api/session` fails outright.
 * In that case the agent will have been briefed on a different chart, so treat its
 * appearance as a bug signal rather than a normal state.
 */
const fallbackChart: ChartData = {
  lagna: 'Scorpio', moonSign: 'Gemini', nakshatra: 'Punarvasu · Pada 2', dasha: 'Venus / Mercury',
  planets: [
    { name: 'Sun', sign: 'Capricorn', house: 3, degree: '12°44′', strength: 'Strong' },
    { name: 'Moon', sign: 'Gemini', house: 8, degree: '7°22′', strength: 'Neutral' },
    { name: 'Mars', sign: 'Taurus', house: 7, degree: '24°01′', strength: 'Strong' },
    { name: 'Mercury', sign: 'Scorpio', house: 1, degree: '3°18′', strength: 'Neutral' },
    { name: 'Jupiter', sign: 'Virgo', house: 11, degree: '19°55′', strength: 'Retrograde' },
    { name: 'Venus', sign: 'Aquarius', house: 4, degree: '8°33′', strength: 'Strong' },
    { name: 'Saturn', sign: 'Pisces', house: 5, degree: '11°47′', strength: 'Retrograde' },
    { name: 'Rahu', sign: 'Libra', house: 12, degree: '16°09′', strength: 'Node' },
    { name: 'Ketu', sign: 'Aries', house: 6, degree: '16°09′', strength: 'Node' }
  ]
};

const planetNames = ['Sun','Moon','Mars','Mercury','Jupiter','Venus','Saturn','Rahu','Ketu'] as const;

/** Planet explicitly requested by the USER.
 *
 * This intentionally does not wait for the assistant or _publish_message. A direct
 * request such as "tell me about Jupiter" is enough to move the visual focus at the
 * start of the conversational turn. The agent's planet/highlight publish_message remains
 * authoritative reinforcement once it arrives.
 */
function planetFromUserText(text: string) {
  const normalized = text.toLowerCase();
  const candidates = planetNames
    .map(name => ({ name, index: normalized.search(new RegExp(`\\b${name.toLowerCase()}\\b`, 'i')) }))
    .filter(item => item.index >= 0)
    .sort((a, b) => a.index - b.index);
  if (!candidates.length) return undefined;

  // Prefer explicit conversational requests. This avoids treating a comparison/list
  // such as "Sun and Jupiter" as a forced switch unless the user is actually asking
  // about one of them. For a normal single-planet utterance the first candidate wins.
  for (const item of candidates) {
    const name = item.name.toLowerCase();
    const requestPatterns = [
      new RegExp(`(?:tell|talk|explain|describe|show|focus|what|how|why|about|regarding|discuss|look at)[^.!?]{0,80}\\b${name}\\b`, 'i'),
      new RegExp(`\\b${name}\\b[^.!?]{0,80}(?:tell|explain|mean|means|placement|house|sign|degree|effect|influence)`, 'i')
    ];
    if (requestPatterns.some(pattern => pattern.test(text))) return item.name;
  }
  return candidates.length === 1 ? candidates[0].name : undefined;
}


function buildDirectPlanetFallback(chart: ChartData, planetName: string) {
  const planet = chart.planets.find(p => p.name.toLowerCase() === planetName.toLowerCase());
  if (!planet) return `Let us look at ${planetName}. I can explain its placement and traditional significance in your Birth Sky.`;

  const themes: Record<string, string> = {
    Sun: 'identity, confidence, vitality and purpose',
    Moon: 'emotions, instincts, comfort and inner responses',
    Mars: 'drive, courage, initiative and how you act',
    Mercury: 'communication, learning, analysis and decision-making',
    Jupiter: 'growth, wisdom, guidance and expansion',
    Venus: 'relationships, harmony, values, beauty and enjoyment',
    Saturn: 'discipline, responsibility, patience and long-term growth',
    Rahu: 'ambition, experimentation, strong desires and unfamiliar directions',
    Ketu: 'detachment, introspection, past patterns and spiritual reflection'
  };

  const retrograde = planet.retrograde || /retrograde/i.test(planet.strength) ? ' It is also retrograde in this chart.' : '';
  const nodeNote = planet.name === 'Rahu' || planet.name === 'Ketu'
    ? ' As a lunar node, this is interpreted symbolically rather than as a physical planet.'
    : '';
  const theme = themes[planet.name] || 'the life themes traditionally associated with this planet';

  return `${planet.name} is in ${planet.sign} in your ${ordinal(planet.house)} house at ${spokenDegree(planet.degree)}.${retrograde}${nodeNote} In traditional Vedic interpretation, ${planet.name} is associated with ${theme}. This placement can be explored through the sign, house and its relationship with the rest of your chart.`;
}

function topicFromGuidanceRequest(text: string) {
  const match = text.match(/\b(business|career|marriage|relationship|health|education|study|finance|wealth|property|travel)\b/i);
  return match ? match[1][0].toUpperCase() + match[1].slice(1).toLowerCase() : 'General';
}

function isDirectKundliGuidanceRequest(text: string) {
  return /\b(traditional\s+guidance|guidance|remed(?:y|ies)|pooja|puja|mantra|gemstone|practice)\b/i.test(text);
}

function requestedGuidanceKind(text: string): KundliGuidance['activeKind'] | undefined {
  if (/\b(pooja|puja|temple|worship|ritual)\b/i.test(text)) return 'puja';
  if (/\bmantra\b/i.test(text)) return 'mantra';
  if (/\b(gemstone|coral|sapphire|emerald|diamond|ruby|pearl|hessonite|cat(?:'s)? eye)\b/i.test(text)) return 'gemstone';
  if (/\b(practice|fast(?:ing)?|donat(?:e|ion)|charity|seva|observance)\b/i.test(text)) return 'practice';
  return undefined;
}

function buildKundliGuidanceFallback(topic: string, kind: KundliGuidance['activeKind'] = 'puja') {
  if (kind === 'mantra') {
    return `For ${topic.toLowerCase()}, let us focus on traditional mantra guidance. A simple Ganesha mantra is traditionally used to centre attention before a new undertaking. You may recite it mindfully, often for 108 repetitions, while also planning the practical steps carefully. This is illustrative spiritual guidance rather than a guaranteed outcome.`;
  }
  if (kind === 'gemstone') {
    return `For ${topic.toLowerCase()}, gemstone guidance should be connected to the relevant planet and the complete chart rather than chosen generically. Let us first identify the associated planet before considering its traditional gemstone. This is illustrative spiritual guidance rather than a guaranteed outcome.`;
  }
  if (kind === 'practice') {
    return `For ${topic.toLowerCase()}, let us focus on a grounded traditional practice: begin with gratitude, plan carefully, and consider a simple act of charity before the new undertaking. This is illustrative spiritual guidance rather than a guaranteed outcome.`;
  }
  if (topic === 'Business' || topic === 'Career') {
    return `For ${topic.toLowerCase()}, let us begin with traditional puja guidance. Ganesha Puja is traditionally associated with auspicious beginnings, clarity and removing obstacles before a new undertaking. You may keep the intention practical as well: plan carefully, begin with gratitude, and consider a simple act of charity. This is illustrative spiritual guidance rather than a guaranteed outcome. Would you like the associated mantra or practice next?`;
  }
  return `Let us begin with traditional puja guidance for ${topic.toLowerCase()}. A simple Ganesha Puja is traditionally associated with clarity, preparation and an auspicious beginning. You may also pair it with mindful planning, gratitude and a small act of charity. This is illustrative spiritual guidance rather than a guaranteed outcome. Would you like the associated mantra or practice next?`;
}

/**
 * Blank out parenthetical asides, preserving character offsets.
 *
 * A bracket glosses a term rather than discusses it:
 *   "no indication of Pitru dosha (related to the Sun and Rahu), Guru Chandal dosha
 *    (related to Jupiter and Rahu), … Grahan dosha (related to the Sun and Moon …)"
 * Every planet there is a definition, not a subject. Counting them as mentions made a
 * "no dosha found" answer highlight whichever planet happened to sit in the last
 * bracket - Moon.
 *
 * Replaced with spaces rather than removed so that character offsets stay valid: the
 * speech-pacing schedule measures position in the SPOKEN text, and brackets are spoken.
 */
function maskParentheticals(text: string) {
  return text.replace(/\([^)]{0,200}\)/g, match => ' '.repeat(match.length));
}

function planetFromAgentText(text: string) {
  // Prefer the planet introduced at the beginning of the assistant turn. This avoids
  // selecting the next planet merely because the current explanation ends with
  // phrases such as "Would you like to continue to Mercury next?".
  const opening = maskParentheticals(text).slice(0, 240);
  for (const name of planetNames) {
    const patterns = [
      new RegExp(`\\b(?:explore|highlight|focus on|begin with|start with|move to|look at|discuss)\\s+(?:the\\s+)?${name}\\b`, 'i'),
      new RegExp(`\\b${name}\\s+(?:is|appears|sits|rests|represents|shows)\\b`, 'i')
    ];
    if (patterns.some(pattern => pattern.test(opening))) return name;
  }
  // Fallback to the first planet mention in the opening portion only.
  const mentions = planetNames
    .map(name => ({ name, index: opening.search(new RegExp(`\\b${name}\\b`, 'i')) }))
    .filter(item => item.index >= 0)
    .sort((a, b) => a.index - b.index);
  return mentions[0]?.name;
}


// Verbs that mark a planet as actually being described rather than merely named.
const PLANET_PREDICATES = 'is|are|appears|sits|rests|lies|resides|represents|signifies|rules|influences|indicates|shows|governs|suggests|brings|encourages|enhances|occupies|placed|positioned|located';
// A planet is very often introduced with an appositive clause before its verb:
//   "Venus, associated with love, beauty, and harmony, is in Aquarius"
//   "Mercury, on the other hand, represents communication"
// The original patterns required the verb IMMEDIATELY after the name, so both of those
// failed and a two-planet Dasha answer registered as discussing no planets at all.
const PLANET_CLAUSE_GAP = '(?:\\s*,[^.;]{0,80},)?\\s+(?:also\\s+|often\\s+|typically\\s+|currently\\s+)?';

/**
 * Planets discussed in this text, with the character offset at which each is actually
 * DESCRIBED.
 *
 * The distinction matters for pacing. "You are currently in the Venus-Mercury Dasha."
 * names both planets in the first sentence, but Mercury is not discussed until much
 * later. Positioning on the first bare mention put the two highlights 0.4s apart, which
 * is the "both highlighted immediately" behaviour being fixed. Positioning on the
 * descriptive clause spreads them across the answer as spoken.
 */
function planetMentionsWithPositions(text: string) {
  const body = maskParentheticals(text).slice(0, 1800);
  const found: Array<{ name: string; index: number }> = [];
  for (const name of planetNames) {
    const n = name.toLowerCase();
    // Patterns that indicate the planet is being DESCRIBED here - these carry position.
    const descriptive = [
      new RegExp(`\\b${n}\\b${PLANET_CLAUSE_GAP}(?:${PLANET_PREDICATES})\\b`, 'i'),
      new RegExp(`\\b(?:with|while|and|as|for)\\s+${n}\\b${PLANET_CLAUSE_GAP}(?:${PLANET_PREDICATES})\\b`, 'i'),
      new RegExp(`\\b(?:explore|highlight|focus on|begin with|start with|move to|look at|discuss|talk about)\\s+(?:the\\s+)?${n}\\b`, 'i')
    ];
    // Patterns that only QUALIFY the planet as relevant ("the Venus-Mercury Dasha").
    // They make it eligible but never define where it is discussed.
    const qualifying = [
      new RegExp(`\\b${n}\\b[\\s/-]{0,3}(?:and\\s+)?(?:\\w+\\s+)?(?:dasha|antardasha|bhukti|period)\\b`, 'i'),
      new RegExp(`\\b(?:dasha|antardasha|bhukti|period)\\s+of\\s+(?:\\w+\\s+and\\s+)?${n}\\b`, 'i')
    ];

    let index = -1;
    for (const pattern of descriptive) {
      const match = pattern.exec(body);
      if (match && (index < 0 || match.index < index)) index = match.index;
    }
    if (index < 0) {
      if (!qualifying.some(pattern => pattern.test(body))) continue;
      // Eligible but never described: fall back to its first mention.
      index = body.search(new RegExp(`\\b${n}\\b`, 'i'));
      if (index < 0) continue;
    }
    found.push({ name, index });
  }
  return found.sort((a, b) => a.index - b.index);
}

function planetMentionsInOrder(text: string) {
  // Ordered by where each planet is described, not by the declaration order of
  // `planetNames` - the narration order is what the visuals should follow.
  return planetMentionsWithPositions(text).map(item => item.name);
}

function planetsFromAgentText(text: string) {
  // Kundli may discuss multiple planets in the same answer. Highlight every planet
  // that is substantively described, while ignoring a planet mentioned only as a
  // suggestion for what to explore next.
  const matches = planetMentionsInOrder(text);
  // If no substantive pattern matched, use the first planet mentioned near the
  // beginning so legacy single-planet turns still synchronize.
  if (!matches.length) {
    const first = planetFromAgentText(text);
    if (first) return [first];
  }
  return matches;
}


/**
 * Drop trailing offer sentences. "Would you like to explore remedies?" is Jyotishi
 * OFFERING something, not delivering it, and treating it as content makes the UI act on
 * things that have not happened yet.
 */
function withoutSuggestionSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    // "If you're interested, I can share remedies related to this Dasha." is an offer
    // too, and matching "remedies" inside it opened the guidance panel before a single
    // remedy had been described.
    .filter(sentence => !/^(?:would you like|do you want|shall we|should we|would you prefer|if you(?:'d| would) like|if you(?:'re| are) interested|if you(?:'d| would) prefer|feel free to|let me know|i can (?:share|offer|walk|tell|guide)|i could (?:share|offer|walk|tell|guide)|just let me know|happy to)/i.test(sentence.trim()))
    .join(' ');
}

/**
 * Approximate TTS speaking rate, characters per second.
 *
 * The whole assistant turn arrives as text long before the avatar has finished speaking
 * it, so transcript-driven highlighting runs ahead of the voice: a Venus-then-Mercury
 * answer jumped straight to Mercury while the audio was still on Venus. Scheduling each
 * highlight from its character offset keeps the chart roughly in step with what is
 * actually being heard.
 *
 * This is a heuristic, not a real audio timeline. ~15 chars/sec matches typical
 * conversational TTS; raise it if highlights lag, lower it if they lead.
 */
const SPEECH_CHARS_PER_SECOND = 15;
const MAX_HIGHLIGHT_DELAY_MS = 30_000;

type PacedHighlight = { planet: string; delayMs: number };

/** Where each discussed planet is described, converted to an estimated speaking time. */
function pacedPlanetSchedule(text: string): PacedHighlight[] {
  const body = withoutSuggestionSentences(text);
  const mentions = planetMentionsWithPositions(body);
  if (mentions.length < 2) return [];
  // Normalize against the first planet so the chart lights up immediately rather than
  // sitting blank through the introductory clause.
  const origin = mentions[0].index;
  return mentions.map(({ name, index }) => ({
    planet: name,
    delayMs: Math.min(MAX_HIGHLIGHT_DELAY_MS, Math.max(0, (index - origin) / SPEECH_CHARS_PER_SECOND) * 1000)
  }));
}

function currentPlanetFromAgentProgress(text: string) {
  // Live Kundli synchronization should follow the planet Jyotishi is discussing
  // *now*, not keep every planet that appeared earlier in the same answer. Ignore
  // trailing suggestion questions ("Would you like to explore Mercury next?") and
  // choose the latest actual planet mention in the spoken body.
  const body = maskParentheticals(withoutSuggestionSentences(text)).slice(0, 1800);
  let latest: { name: string; index: number } | undefined;
  for (const name of planetNames) {
    const regex = new RegExp(`\\b${name}\\b`, 'ig');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(body)) !== null) {
      if (!latest || match.index > latest.index) latest = { name, index: match.index };
    }
  }
  return latest?.name;
}


export type KundliGuidance = {
  planet: string;
  topic?: string;
  title: string;
  subtitle: string;
  mode?: 'remedies' | 'assessment' | 'not_indicated';
  assessmentText?: string;
  activeKind?: 'puja' | 'mantra' | 'gemstone' | 'practice';
  gemstoneName?: string;
  assessmentLabel?: string;
  doshaKey?: SupportedDoshaKey;
};

export type SupportedDoshaKey =
  | 'mangal'
  | 'kaal_sarp'
  | 'pitru'
  | 'guru_chandal'
  | 'shani'
  | 'grahan'
  | 'nadi';

type DoshaDefinition = {
  key: SupportedDoshaKey;
  label: string;
  planets: string[];
  patterns: RegExp[];
};

export const supportedDoshas: DoshaDefinition[] = [
  { key: 'mangal', label: 'Mangal / Manglik Dosha', planets: ['Mars'], patterns: [/\bmangal\b/i, /\bmanglik\b/i, /\bkuja\s+dosha\b/i] },
  { key: 'kaal_sarp', label: 'Kaal Sarp Dosha', planets: ['Rahu', 'Ketu'], patterns: [/\bkaal\s*sarp(?:a)?\b/i, /\bkala\s*sarpa\b/i] },
  { key: 'pitru', label: 'Pitru / Pitra Dosha', planets: ['Sun', 'Rahu'], patterns: [/\bpitru\b/i, /\bpitra\b/i, /\bpitri\b/i, /\bancestral\s+dosha\b/i] },
  { key: 'guru_chandal', label: 'Guru Chandal Dosha', planets: ['Jupiter', 'Rahu'], patterns: [/\bguru\s+chandal\b/i, /\bguru\s+chandaal\b/i] },
  { key: 'shani', label: 'Shani Affliction / Sade Sati', planets: ['Saturn'], patterns: [/\bshani\b/i, /\bsade\s+sati\b/i, /\bsaturn\s+dosha\b/i] },
  { key: 'grahan', label: 'Grahan Dosha', planets: ['Sun', 'Moon', 'Rahu', 'Ketu'], patterns: [/\bgrahan\b/i, /\beclipse\s+dosha\b/i] },
  { key: 'nadi', label: 'Nadi Dosha', planets: ['Moon'], patterns: [/\bnadi\s+dosha\b/i, /\bnadi\s+dosh\b/i] }
];

function detectDosha(text: string): DoshaDefinition | undefined {
  return supportedDoshas.find(dosha => dosha.patterns.some(pattern => pattern.test(text)));
}

function planetForGuidance(text: string, fallbackPlanets: string[] = []) {
  // When the caller has already resolved which planet this answer is about, trust it.
  // The chain below has a FIXED priority order (Mars, Saturn, Rahu, Ketu, Jupiter, Venus,
  // Mercury, Moon, Sun) which is not "the planet currently being discussed". In a
  // "Venus and Mercury Dasha" answer that silently returned Venus while the chart
  // highlighted Mercury - the panel and the chart disagreed about the same sentence.
  if (fallbackPlanets[0]) return fallbackPlanets[0];

  let planet: string | undefined;
  if (/\b(mangal|mars)\b/i.test(text)) planet = 'Mars';
  else if (/\b(shani|saturn)\b/i.test(text)) planet = 'Saturn';
  else if (/\b(rahu)\b/i.test(text)) planet = 'Rahu';
  else if (/\b(ketu)\b/i.test(text)) planet = 'Ketu';
  else if (/\b(jupiter|guru|brihaspati)\b/i.test(text)) planet = 'Jupiter';
  else if (/\b(venus|shukra)\b/i.test(text)) planet = 'Venus';
  else if (/\b(mercury|budh)\b/i.test(text)) planet = 'Mercury';
  else if (/\b(moon|chandra)\b/i.test(text)) planet = 'Moon';
  else if (/\b(sun|surya)\b/i.test(text)) planet = 'Sun';
  // Deliberately NOT `|| 'Mars'`. The old default asserted Mars whenever nothing
  // resolved, which is how a Venus-Mercury Dasha answer produced a Mangal Shanti Puja
  // panel. Returning undefined lets the caller show chart-level guidance instead of
  // confidently naming the wrong planet.
  return planet;
}

function guidanceFromUserText(text: string, fallbackPlanets: string[] = []): KundliGuidance | undefined {
  const asksAboutDosha = /\b(dosha|dosh|manglik|mangal|kaal\s*sarp|pitru|pitra|guru\s+chandal|shani|sade\s+sati|grahan|nadi)\b/i.test(text) &&
    /\b(do i|have|any|check|whether|is there|am i|show|tell|dosha|dosh)\b/i.test(text);
  if (!asksAboutDosha) return undefined;

  const dosha = detectDosha(text);
  const planet = dosha?.planets[0] || fallbackPlanets[0] || 'Chart';
  return {
    planet,
    doshaKey: dosha?.key,
    mode: 'assessment',
    title: dosha ? `${dosha.label} Assessment` : 'Dosha Assessment',
    subtitle: 'Jyotishi is checking the current illustrative Kundli before showing any traditional guidance.',
    assessmentLabel: dosha ? `Checking ${dosha.label}` : 'Checking the Kundli',
    assessmentText: 'Assessment in progress. Remedy cards will appear only if the conversational conclusion explicitly supports that remedy path.'
  };
}

function extractGemstoneName(text: string): string | undefined {
  const names = [
    ['yellow sapphire', 'Yellow Sapphire'],
    ['blue sapphire', 'Blue Sapphire'],
    ['red coral', 'Red Coral'],
    ['white sapphire', 'White Sapphire'],
    ["cat's eye", "Cat's Eye"],
    ['cats eye', "Cat's Eye"],
    ['hessonite', 'Hessonite'],
    ['emerald', 'Emerald'],
    ['diamond', 'Diamond'],
    ['ruby', 'Ruby'],
    ['pearl', 'Pearl'],
    ['coral', 'Red Coral'],
    ['sapphire', 'Sapphire']
  ] as const;
  const lower = text.toLowerCase();
  for (const [needle, label] of names) {
    if (lower.includes(needle)) return label;
  }
  return undefined;
}

function hasNegativeAssessment(text: string) {
  return [
    /\b(?:do not|don't|does not|doesn't|did not|didn't)\s+(?:appear to\s+)?have\b/i,
    /\bno\s+(?:clear\s+)?(?:indication|evidence|sign)s?\s+of\b/i,
    /\bnot\s+(?:present|indicated|shown|formed|found|applicable)\b/i,
    /\b(?:absent|unlikely)\b/i,
    /\bdoes not traditionally indicate\b/i
  ].some(pattern => pattern.test(text));
}

function hasPositiveAssessment(text: string) {
  return [
    /\b(?:is|appears|seems)\s+(?:clearly\s+)?(?:present|indicated|shown|formed)\b/i,
    /\b(?:there is|there appears to be)\s+(?:a|an|some)?\s*(?:clear\s+)?(?:indication|sign|evidence)\b/i,
    /\b(?:you have|your chart has|your kundli has)\b/i
  ].some(pattern => pattern.test(text));
}

function guidanceFromText(fullText: string, fallbackPlanets: string[] = []): KundliGuidance | undefined {
  // Detect intent from the DELIVERED content only. "Would you like to explore remedies or
  // guidance related to Venus or Mercury?" is an offer at the end of an ordinary Dasha
  // explanation; matching it opened the remedy panel before any remedy was discussed.
  const text = withoutSuggestionSentences(fullText);
  const remedyIntent = /\b(remed(?:y|ies)|dosha|dosh|pooja|puja|mantra|gemstone|coral|sapphire|emerald|diamond|ruby|pearl|hessonite|cat(?:'s)? eye|fast(?:ing)?|donat(?:e|ion)|ritual|temple|worship|shanti|charity|seva|observance)\b/i.test(text);
  if (!remedyIntent) return undefined;

  const dosha = detectDosha(text);
  const negative = /\b(dosha|dosh)\b/i.test(text) && hasNegativeAssessment(text);
  if (negative) {
    return {
      planet: dosha?.planets[0] || fallbackPlanets[0] || 'Chart',
      doshaKey: dosha?.key,
      mode: 'not_indicated',
      title: dosha ? `${dosha.label} Assessment` : 'Dosha Assessment',
      subtitle: dosha ? `${dosha.label} is not indicated in this conversational assessment.` : 'No dosha was indicated in this conversational assessment.',
      assessmentLabel: dosha?.label || 'Dosha assessment',
      assessmentText: `Jyotishi did not identify ${dosha ? dosha.label : 'a dosha'} in the current illustrative chart context, so condition-specific puja, mantra, gemstone and practice cards are hidden.`
    };
  }

  const planet = dosha?.planets[0] || planetForGuidance(text, fallbackPlanets);
  // Topic-level guidance is valid even when Jyotishi does not attribute it to a
  // Navagraha. Keep the chart neutral and use a general guidance experience instead of
  // inventing Mercury, Jupiter, or whichever planet happened to be active previously.
  if (!planet) {
    const topicMatch = text.match(/\b(business|career|marriage|relationship|health|education|study|finance|wealth|property|travel)\b/i);
    const topic = topicMatch ? topicMatch[1][0].toUpperCase() + topicMatch[1].slice(1).toLowerCase() : 'General';
    const activeKind: KundliGuidance['activeKind'] = /\b(pooja|puja|temple|worship|ritual)\b/i.test(text) ? 'puja'
      : /\bmantra\b/i.test(text) ? 'mantra'
      : /\b(gemstone|coral|sapphire|emerald|diamond|ruby|pearl|hessonite|cat(?:'s)? eye)\b/i.test(text) ? 'gemstone'
      : /\b(fast(?:ing)?|donat(?:e|ion)|practice|charity|seva|observance)\b/i.test(text) ? 'practice'
      : undefined;
    return {
      planet: 'General',
      topic,
      mode: 'remedies',
      title: `Traditional Guidance · ${topic}`,
      subtitle: 'Illustrative chart-level options synchronized with Jyotishi. These are traditional astrology practices, not guaranteed outcomes.',
      activeKind,
      gemstoneName: extractGemstoneName(text)
    };
  }
  const doshaPositive = Boolean(dosha && hasPositiveAssessment(text));

  // Determine the remedy Jyotishi is explaining *now*, not a category that is
  // merely mentioned as the next option. Example: "Let's start with a Puja ...
  // Would you like to hear about a mantra next?" must keep PUJA active.
  const futureCue = /(?:would you like|do you want|shall we|we can|i can|next(?:,|\s+we)?|after that|later).{0,90}?(?:puja|pooja|mantra|gemstone|coral|sapphire|emerald|diamond|ruby|pearl|hessonite|cat(?:'s)? eye|practice|charity|seva|observance)/gi;
  const currentText = text.replace(futureCue, ' ');
  const explicitCurrent: Array<{ kind: KundliGuidance['activeKind']; pattern: RegExp }> = [
    { kind: 'puja', pattern: /\b(?:start|begin|focus|perform|performing|recommend|first|doing|do)\b.{0,70}\b(?:pooja|puja|worship|shanti|ritual|temple)\b/i },
    { kind: 'mantra', pattern: /\b(?:start|begin|focus|chant|chanting|recite|reciting|recommend|first|practice)\b.{0,70}\bmantra\b/i },
    { kind: 'gemstone', pattern: /\b(?:start|begin|focus|wear|wearing|consider|recommend|first|gemstone)\b.{0,70}\b(?:gemstone|coral|sapphire|emerald|diamond|ruby|pearl|hessonite|cat(?:'s)? eye)\b/i },
    { kind: 'practice', pattern: /\b(?:start|begin|focus|observe|observing|fast|fasting|donate|donation|charity|seva|practice|first)\b.{0,70}\b(?:practice|charity|seva|observance|fast(?:ing)?|donat(?:e|ion))\b/i }
  ];
  const explicit = explicitCurrent.find(item => item.pattern.test(currentText));

  const kindMatches: Array<{ kind: KundliGuidance['activeKind']; index: number }> = [];
  const collectFirst = (kind: KundliGuidance['activeKind'], pattern: RegExp) => {
    const match = pattern.exec(currentText);
    if (match) kindMatches.push({ kind, index: match.index });
  };
  collectFirst('puja', /\b(pooja|puja|temple|worship|shanti|ritual)\b/i);
  collectFirst('mantra', /\bmantra\b/i);
  collectFirst('gemstone', /\b(gemstone|coral|sapphire|emerald|diamond|ruby|pearl|hessonite|cat(?:'s)? eye)\b/i);
  collectFirst('practice', /\b(fast(?:ing)?|donat(?:e|ion)|practice|charity|seva|observance|tuesday|saturday|thursday|friday|monday|sunday|wednesday)\b/i);
  kindMatches.sort((a, b) => a.index - b.index);
  const activeKind = explicit?.kind ?? kindMatches[0]?.kind;

  // If the answer only confirms a supported dosha without discussing remedies yet,
  // keep the panel in assessment mode instead of prematurely showing all remedy cards.
  if (dosha && doshaPositive && !activeKind) {
    return {
      planet,
      doshaKey: dosha.key,
      mode: 'assessment',
      title: `${dosha.label} Assessment`,
      subtitle: `${dosha.label} is indicated in this conversational assessment.`,
      assessmentLabel: `${dosha.label} · indicated`,
      assessmentText: 'Jyotishi has identified the condition. Traditional guidance will appear when the conversation moves into remedies, puja, mantra, gemstone or practice.'
    };
  }

  return {
    planet,
    doshaKey: dosha?.key,
    mode: 'remedies',
    title: dosha ? `Traditional Guidance · ${dosha.label}` : `Traditional Guidance · ${planet}`,
    subtitle: 'Illustrative options synchronized with Jyotishi. These are traditional astrology practices, not guaranteed outcomes.',
    activeKind,
    gemstoneName: extractGemstoneName(text)
  };
}

const palmLineNames: Array<{ id: PalmLineId; patterns: RegExp[] }> = [
  { id: 'heart_line', patterns: [/\bheart\s+line\b/i, /\bheartline\b/i] },
  { id: 'head_line', patterns: [/\bhead\s+line\b/i, /\bheadline\b/i] },
  { id: 'life_line', patterns: [/\blife\s+line\b/i, /\blifeline\b/i] },
  { id: 'fate_line', patterns: [/\bfate\s+line\b/i, /\bfateline\b/i] }
];

function palmLineFromAgentText(text: string): PalmLineId | undefined {
  const opening = text.slice(0, 280);
  for (const line of palmLineNames) {
    if (line.patterns.some(pattern => pattern.test(opening))) return line.id;
  }
  return undefined;
}

function buildPalmLineFallback(result: PalmResult | null, lineId: PalmLineId) {
  const label = lineId.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  const line = result?.lines.find(item => item.id === lineId);
  if (!line) return `Let us focus on your ${label}. I do not have a clear captured reading for that line yet, so please retake the palm image in brighter, even lighting if you would like a more grounded interpretation.`;
  if (line.status === 'not_clear' || line.status === 'estimated') {
    return `Let us focus on your ${line.name}. This guide is placed from typical palm anatomy because the crease was not clear enough in the captured image. I should not make a confident reading from it. You can retake the image with your palm flat, close and evenly lit.`;
  }
  const morphology = line.observation && line.observation !== 'indeterminate' ? ` It appears ${line.observation}.` : '';
  return `Let us focus on your ${line.name}. ${line.traditionalReading}${morphology} This is a traditional palmistry-style interpretation, not a medical or scientific assessment.`;
}

function sceneFromAgentText(text: string): SceneName | undefined {
  // Only dedicated transition sentences may drive chapter navigation.
  // General conversational phrases such as "to open your Birth Sky, tell me..."
  // must never be interpreted as a navigation command.
  const rules: Array<{ scene: SceneName; patterns: RegExp[] }> = [
    { scene: 'sky', patterns: [/\bthe birth sky is opening now\b/i] },
    { scene: 'kundli', patterns: [/\byour kundli is opening now\b/i, /\bkundli is opening now\b/i] },
    { scene: 'palm', patterns: [/\bpalmistry is opening now\b/i] },
    { scene: 'thread', patterns: [/\bthe cosmic thread is opening now\b/i] },
    { scene: 'intro', patterns: [/\breturning to arrival now\b/i] }
  ];
  for (const rule of rules) {
    if (rule.patterns.some(pattern => pattern.test(text))) return rule.scene;
  }
  return undefined;
}

function nextSceneFromJourney(scene: SceneName): SceneName | undefined {
  const order: Partial<Record<SceneName, SceneName>> = {
    sky: 'kundli',
    kundli: 'palm',
    palm: 'thread'
  };
  return order[scene];
}

/**
 * Does this user turn actually introduce a new Kundli subject?
 *
 * A Kundli user turn used to reset the planet highlight and the guidance panel
 * unconditionally. That is right for "now tell me about Saturn", but it also fired on
 * greetings, one-word acknowledgements and ASR garbage - a mis-heard "Hello, can you hear
 * me" arriving as "Hello, phone basic." wiped an active remedy panel mid-conversation and
 * looked like the UI randomly reverting to the Chart Snapshot.
 *
 * So reset only when the turn names something the visuals should follow.
 */
function introducesNewKundliSubject(text: string) {
  return /\b(sun|moon|mars|mercury|jupiter|venus|saturn|rahu|ketu|surya|chandra|mangal|budh|guru|brihaspati|shukra|shani)\b/i.test(text)
    || /\b(lagna|ascendant|dasha|nakshatra|house|rashi|chart|kundli)\b/i.test(text)
    || /\b(dosha|dosh|manglik|kaal\s*sarp|pitru|pitra|guru\s+chandal|sade\s+sati|grahan|nadi)\b/i.test(text)
    || /\b(traditional\s+guidance|guidance|remed(?:y|ies)|pooja|puja|mantra|gemstone|practice|fast(?:ing)?|donat(?:e|ion)|charity|seva|temple|ritual)\b/i.test(text);
}

/**
 * Is this assistant turn ordinary chart reading rather than remedy guidance? Used to
 * decide when the guidance panel should hand back to the Chart Snapshot.
 */
function isChartInterpretationAnswer(text: string) {
  return /\b(house|lagna|ascendant|dasha|nakshatra|degrees?|placement|retrograde|conjunction|aspect|moon sign|rashi)\b/i.test(text);
}

/**
 * Lagna and house readings own the Kundli chart, not a Navagraha remedy panel.
 * Some ConvoAI transcript packets contain text retained from the preceding turn, so a
 * stale planet name (for example Venus) can coexist with a fresh Lagna answer. Give the
 * explicit non-planet subject priority over generic planet extraction.
 */
function isLagnaOrHouseAnswer(text: string) {
  return /\b(?:your\s+)?(?:lagna|ascendant)\b/i.test(text)
    || /\b(?:first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th|seventh|7th|eighth|8th|ninth|9th|tenth|10th|eleventh|11th|twelfth|12th)\s+house\b/i.test(text)
    || /\bhouse\s+(?:1[0-2]|[1-9])\b/i.test(text);
}

/**
 * A survey answer that concludes no dosha is present.
 *
 * "There is no indication of Pitru dosha …, Guru Chandal dosha …, or Nadi dosha …"
 * enumerates conditions in order to RULE THEM OUT. Nothing is being discussed, so the
 * chart must not spotlight a planet - doing so implies the opposite of what was said.
 */
function isNegativeDoshaAnswer(text: string) {
  return /\b(dosha|dosh|sade\s+sati)\b/i.test(text) && hasNegativeAssessment(text);
}

function isNextSectionRequest(text: string) {
  // Only explicit "next section/chapter" language advances the journey. Bare words
  // like "continue" or "proceed" are common conversational requests and must not
  // navigate away from the current astrology section.
  return /\b(?:move|go|continue|proceed|advance)?\s*(?:to\s+)?(?:the\s+)?next\s+(?:section|chapter)\b/i.test(text)
    || /\b(?:move\s+on|go\s+ahead|proceed)\s+(?:to\s+)?(?:the\s+)?next\s+(?:section|chapter)\b/i.test(text);
}

function sceneFromUserNavigation(text: string, current: SceneName): SceneName | undefined {
  const normalized = text.trim();
  if (isNextSectionRequest(normalized)) return nextSceneFromJourney(current);

  // Chapter navigation must be EXPLICIT. A previous version allowed a polite phrase
  // such as "I want..." to satisfy the navigation gate, and the generic Arrival alias
  // "start" then misclassified "I want to know if it is a good time to start a business"
  // as a request to leave Kundli. Normal astrology questions must never move chapters.
  const hasExplicitNavVerb = /\b(?:go|move|switch|open|show|navigate|return|visit|proceed)\b/i.test(normalized)
    || /\btake\s+(?:me|us)\b/i.test(normalized)
    || /\bgo\s+back\b/i.test(normalized)
    || /\bback\s+to\b/i.test(normalized);
  if (!hasExplicitNavVerb) return undefined;

  const rules: Array<{ scene: SceneName; pattern: RegExp }> = [
    { scene: 'sky', pattern: /\b(?:birth\s*sky|birthsky)\b/i },
    { scene: 'kundli', pattern: /\b(?:kundli|kundali|vedic\s+chart)\b/i },
    { scene: 'palm', pattern: /\b(?:palmistry|palm\s*(?:reading|section|street))\b/i },
    { scene: 'thread', pattern: /\b(?:cosmic\s*thread|cosmicthread)\b/i },
    // Do not use bare "start" or "home" as Arrival aliases: both are common in
    // ordinary questions ("start a business", "home purchase", etc.).
    { scene: 'intro', pattern: /\b(?:arrival|home(?:\s+screen)?|start\s+screen|beginning\s+of\s+(?:the\s+)?journey)\b/i }
  ];
  return rules.find(rule => rule.pattern.test(normalized))?.scene;
}

function chapterTransitionSentence(scene: SceneName) {
  const sentences: Record<SceneName, string> = {
    intro: 'Returning to Arrival now.',
    sky: 'The Birth Sky is opening now.',
    kundli: 'Your Kundli is opening now.',
    palm: 'Palmistry is opening now.',
    thread: 'The Cosmic Thread is opening now.'
  };
  return sentences[scene];
}

/** "3" -> "3rd". Spoken intros read better with an ordinal than a bare number. */
function ordinal(n: number) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** "12°44′" -> "12 degrees 44 minutes", so TTS does not read the symbols aloud. */
function spokenDegree(degree: string) {
  const match = degree.match(/(\d+)\D+(\d+)/);
  return match ? `${match[1]} degrees ${match[2]} minutes` : degree;
}

function hasCompleteBirthProfile(profile: Partial<BirthProfile>) {
  return Boolean(profile.name?.trim() && profile.date?.trim() && profile.time?.trim() && profile.place?.trim());
}

function mergeDefinedProfile(current: Partial<BirthProfile>, result: Partial<BirthProfile> & { complete?: boolean }) {
  const next: Partial<BirthProfile> = { ...current };
  for (const key of ['name', 'date', 'time', 'place', 'language'] as const) {
    const value = result[key];
    if (typeof value === 'string' && value.trim()) next[key] = value.trim();
  }
  return next;
}

export default function App() {
  const [scene, setScene] = useState<SceneName>('intro');
  const [chart, setChart] = useState<ChartData>(fallbackChart);
  const [profile, setProfile] = useState<BirthProfile>();
  const [profileProgress, setProfileProgress] = useState<Partial<BirthProfile>>({});
  const [loading, setLoading] = useState(false);
  const [transcript, setTranscript] = useState<string[]>([
    'System: Ready. Start the Cosmic Journey to meet Jyotishi.'
  ]);
  const [spokenPlanet, setSpokenPlanet] = useState<string>();
  const [spokenPlanets, setSpokenPlanets] = useState<string[]>([]);
  const [spokenPalmLine, setSpokenPalmLine] = useState<PalmLineId>();
  const [kundliGuidance, setKundliGuidance] = useState<KundliGuidance>();
  const transcriptRef = useRef<string[]>([]);
  const extractionBusyRef = useRef(false);
  const profileCompletedRef = useRef(false);
  const profileProgressRef = useRef<Partial<BirthProfile>>({});
  const birthSkyTransitionTimerRef = useRef<number | undefined>(undefined);
  const pendingBirthSkySignalRef = useRef(false);
  const birthSkyAnnouncementRef = useRef(false);
  const birthSkyTransitionPhraseRef = useRef(false);
  const birthSkyIntroSpokenRef = useRef(false);
  // True only when the user interrupts before the automatic Birth Sky intro starts.
  // This prevents a React re-render from re-queuing the intro after an interruption.
  const birthSkyAutoIntroCancelledRef = useRef(false);
  const kundliIntroSpokenRef = useRef(false);
  const palmIntroSpokenRef = useRef(false);
  const threadIntroSpokenRef = useRef(false);
  const pendingChapterSignalRef = useRef<SceneName | null>(null);
  const birthSkyAutoIntroTimerRef = useRef<number | undefined>(undefined);
  const kundliAutoIntroTimerRef = useRef<number | undefined>(undefined);
  const palmAutoIntroTimerRef = useRef<number | undefined>(undefined);
  const threadAutoIntroTimerRef = useRef<number | undefined>(undefined);
  const chapterNavigationFallbackTimerRef = useRef<number | undefined>(undefined);
  const chapterNavigationHardCommitTimerRef = useRef<number | undefined>(undefined);
  const chapterNavigationRequestRef = useRef<{ id: number; target: SceneName; at: number } | null>(null);
  const chapterNavigationSeqRef = useRef(0);
  const walkthroughGenerationRef = useRef(0);
  const requestedNextSceneRef = useRef<SceneName | null>(null);
  const lastPlanetUiSignalAtRef = useRef(0);
  // An explicit Birth Sky planet request from the user owns the visual focus until
  // Jyotishi actually starts/completes an answer about that same planet. This prevents
  // stale transcript history (for example the preceding Sun intro) from stealing focus.
  const birthSkyUserPlanetLockRef = useRef<{ planet: string; at: number } | null>(null);
  // Some ConvoAI providers treat _publish_message as a terminal tool action. If a
  // direct planet question produces only a UI tool call and no spoken assistant turn,
  // this timer provides a deterministic chart-grounded spoken fallback through /speak.
  const directPlanetFallbackTimerRef = useRef<number | undefined>(undefined);
  const directPlanetFallbackRequestRef = useRef<{ id: number; planet: string; at: number } | null>(null);
  const directPlanetFallbackSeqRef = useRef(0);
  const kundliGuidanceFallbackTimerRef = useRef<number | undefined>(undefined);
  const kundliGuidanceFallbackRequestRef = useRef<{ id: number; topic: string; kind: KundliGuidance['activeKind']; at: number } | null>(null);
  const kundliGuidanceFallbackSeqRef = useRef(0);
  const palmLineFallbackTimerRef = useRef<number | undefined>(undefined);
  const palmLineFallbackRequestRef = useRef<{ id: number; line: PalmLineId; at: number } | null>(null);
  const palmLineFallbackSeqRef = useRef(0);
  const palmResultRef = useRef<PalmResult | null>(null);
  const agentSpeakRef = useRef<((text: string, options?: { interruptable?: boolean }) => Promise<void>) | null>(null);
  const lastGuidanceUiSignalAtRef = useRef(0);
  // ASR providers can split "show the mantra for Jupiter" into two final-looking
  // user packets. Keep the first guidance intent alive long enough for a trailing
  // planet/topic fragment to arrive instead of flashing back to Chart Snapshot.
  const pendingGuidanceUserIntentRef = useRef<{ kind: KundliGuidance['activeKind']; at: number } | null>(null);
  // Index in the transcript of the most recent USER turn. The transcript safety-net
  // effect below re-reads the latest Jyotishi line whenever `transcript` changes, and
  // without this it would re-apply the PREVIOUS answer's planet immediately after a new
  // user question had deliberately cleared it.
  const lastUserTurnIndexRef = useRef(-1);
  // Timers that walk the planet highlight through a multi-planet answer in time with the
  // spoken audio. Cleared on any new turn or interruption.
  const pacedHighlightTimersRef = useRef<number[]>([]);
  // `completeProfile` is declared before the Agora hook, so it reads the agent id through
  // a ref that an effect keeps in sync.
  const agentIdRef = useRef<string | null>(null);
  // Keep a newly opened Kundli visually neutral until the user asks a Kundli question.
  // This prevents stale planet/remedy state from a previous turn from appearing on entry.
  const kundliAwaitingFirstUserTurnRef = useRef(false);
  // Keep latest visual state in refs so transcript synchronization effects do not need
  // to depend on arrays/objects that they themselves update. This prevents feedback
  // renders such as the Maximum update depth loop seen during Kundli/Palmistry turns.
  const spokenPlanetRef = useRef<string | undefined>(undefined);
  const spokenPlanetsRef = useRef<string[]>([]);
  const kundliGuidanceRef = useRef<KundliGuidance | undefined>(undefined);

  const clearPacedHighlights = useCallback(() => {
    for (const id of pacedHighlightTimersRef.current) window.clearTimeout(id);
    pacedHighlightTimersRef.current = [];
  }, []);

  /**
   * Walk the highlight through the planets of one answer in time with the speech.
   * Returns true when a schedule was started, so callers can skip the instant-set path.
   */
  const startPacedHighlights = useCallback((text: string, onStep?: (planet: string) => void) => {
    const schedule = pacedPlanetSchedule(text);
    clearPacedHighlights();
    if (schedule.length < 2) return false;

    console.log('[AstroVani] Pacing planet highlights to speech:', schedule);
    const generation = walkthroughGenerationRef.current;
    const apply = (planet: string) => {
      setSpokenPlanet(planet);
      setSpokenPlanets([planet]);
      onStep?.(planet);
    };
    for (const { planet, delayMs } of schedule) {
      if (delayMs <= 0) { apply(planet); continue; }
      const id = window.setTimeout(() => {
        // A user turn (or a chapter change) invalidates the generation, so an
        // interrupted answer never keeps advancing the chart behind the user's back.
        if (generation !== walkthroughGenerationRef.current) return;
        apply(planet);
      }, delayMs);
      pacedHighlightTimersRef.current.push(id);
    }
    return true;
  }, [clearPacedHighlights]);

  const appendTranscript = useCallback((line: string) => {
    if (transcriptRef.current[transcriptRef.current.length - 1] === line) return;
    transcriptRef.current = [...transcriptRef.current, line];
    setTranscript(prev => prev[prev.length - 1] === line ? prev : [...prev, line]);
  }, []);

  const completeProfile = useCallback(async (birthProfile: BirthProfile, source: 'voice' | 'typed') => {
    if (profileCompletedRef.current) return;
    profileCompletedRef.current = true;
    setLoading(true);
    setProfile(birthProfile);
    profileProgressRef.current = birthProfile;
    setProfileProgress(birthProfile);
    try {
      const data = await createSession(birthProfile);
      setChart(data.chart);

      // The chart is now generated from the birth details, so it differs per user. In the
      // voice flow the agent joined before those details existed and was briefed on the
      // generator's default chart - re-brief it now, or Jyotishi would describe a
      // different chart than the one on screen.
      if (source === 'voice' && agentIdRef.current) {
        try {
          await updateAgentChart(agentIdRef.current, birthProfile);
          console.log('[AstroVani] Agent re-briefed with the generated chart.');
        } catch (error) {
          console.warn('[AstroVani] Could not re-brief the agent on the generated chart.', error);
        }
      }
      // Capturing 4/4 details must NOT navigate the UI. Voice navigation is
      // synchronized to Jyotishi's explicit Birth Sky transition (tool signal
      // or the matching final spoken turn handled below).
      if (source === 'typed') setScene('sky');
    } catch {
      setChart(fallbackChart);
      if (source === 'typed') setScene('sky');
    } finally {
      setLoading(false);
    }
  }, [appendTranscript]);

  const commitChapterScene = useCallback((nextScene: SceneName, reason: string) => {
    console.log('[AstroVani] Committing chapter scene:', nextScene, reason);

    if (chapterNavigationFallbackTimerRef.current) {
      window.clearTimeout(chapterNavigationFallbackTimerRef.current);
      chapterNavigationFallbackTimerRef.current = undefined;
    }
    if (chapterNavigationHardCommitTimerRef.current) {
      window.clearTimeout(chapterNavigationHardCommitTimerRef.current);
      chapterNavigationHardCommitTimerRef.current = undefined;
    }
    chapterNavigationRequestRef.current = null;
    pendingChapterSignalRef.current = null;
    pendingBirthSkySignalRef.current = false;
    requestedNextSceneRef.current = null;

    if (directPlanetFallbackTimerRef.current) {
      window.clearTimeout(directPlanetFallbackTimerRef.current);
      directPlanetFallbackTimerRef.current = undefined;
    }
    directPlanetFallbackRequestRef.current = null;
    birthSkyUserPlanetLockRef.current = null;
    walkthroughGenerationRef.current += 1;
    clearPacedHighlights();

    if (nextScene === 'sky') {
      setSpokenPalmLine(undefined);
      birthSkyAnnouncementRef.current = true;
      birthSkyTransitionPhraseRef.current = false;
      birthSkyIntroSpokenRef.current = false;
      birthSkyAutoIntroCancelledRef.current = false;
      if (birthSkyTransitionTimerRef.current) window.clearTimeout(birthSkyTransitionTimerRef.current);
      setSpokenPlanet('Sun');
      setSpokenPlanets(['Sun']);
    } else {
      if (nextScene !== 'palm') setSpokenPalmLine(undefined);
      setSpokenPlanet(undefined);
      setSpokenPlanets([]);

      if (nextScene === 'kundli') {
        kundliIntroSpokenRef.current = false;
        kundliAwaitingFirstUserTurnRef.current = true;
        setKundliGuidance(undefined);
      }
      if (nextScene === 'palm') {
        palmIntroSpokenRef.current = false;
        setSpokenPalmLine(undefined);
      }
      if (nextScene === 'thread') threadIntroSpokenRef.current = false;
    }

    setScene(nextScene);
  }, [clearPacedHighlights]);

  const handleTranscriptEvent = useCallback(async (event: TranscriptEvent) => {
    if (event.speaker === 'user') {
      // `emit()` appends to transcriptRef before invoking this callback, so the user's
      // line is already the last entry.
      lastUserTurnIndexRef.current = transcriptRef.current.length - 1;
      // The user has spoken, so any answer still being walked through is over. Bump the
      // generation first so in-flight timers self-cancel, then drop them.
      walkthroughGenerationRef.current += 1;
      clearPacedHighlights();
    }
    if (event.speaker === 'agent') {
      palmLineFallbackRequestRef.current = null;
      if (palmLineFallbackTimerRef.current) {
        window.clearTimeout(palmLineFallbackTimerRef.current);
        palmLineFallbackTimerRef.current = undefined;
      }
      // Any completed assistant turn proves that the provider answered normally.
      kundliGuidanceFallbackRequestRef.current = null;
      if (kundliGuidanceFallbackTimerRef.current) {
        window.clearTimeout(kundliGuidanceFallbackTimerRef.current);
        kundliGuidanceFallbackTimerRef.current = undefined;
      }
      const navigationTarget = chapterNavigationRequestRef.current?.target;
      if (navigationTarget && sceneFromAgentText(event.text) === navigationTarget) {
        if (chapterNavigationFallbackTimerRef.current) {
          window.clearTimeout(chapterNavigationFallbackTimerRef.current);
          chapterNavigationFallbackTimerRef.current = undefined;
        }
      }
      // Chapter navigation is synchronized to the completed assistant turn. Tool
      // signals record visual intent, but the actual React scene switch happens
      // only after Jyotishi finishes the transition sentence. This same contract
      // applies to Birth Sky, Kundli, Palmistry and Cosmic Thread.
      const transcriptScene = sceneFromAgentText(event.text);
      if (transcriptScene === 'sky') {
        // The exact completed transition sentence is authoritative. If profile
        // extraction is still finishing, remember the completed sentence and
        // reconcile as soon as all four fields are available. This avoids the
        // race where Jyotishi finishes speaking before the async extractor updates
        // profileProgressRef.
        birthSkyTransitionPhraseRef.current = true;
      }
      const pendingScene = pendingChapterSignalRef.current;
      const nextScene = transcriptScene || pendingScene || undefined;
      if (nextScene && nextScene !== scene) {
        // Birth Sky has a hard prerequisite, but an exact completed transition
        // sentence is never discarded just because async profile extraction has
        // not finished yet. It is held until the profile becomes complete.
        if (nextScene === 'sky' && !hasCompleteBirthProfile(profileProgressRef.current)) {
          console.info('[AstroVani] Birth Sky transition sentence completed; waiting for profile extraction to reach 4/4.', profileProgressRef.current);
          pendingChapterSignalRef.current = 'sky';
          pendingBirthSkySignalRef.current = true;
        } else {
        const targetMentioned = transcriptScene === nextScene || (
          (nextScene === 'sky' && /\bbirth sky\b/i.test(event.text)) ||
          (nextScene === 'kundli' && /\bkundli\b/i.test(event.text)) ||
          (nextScene === 'palm' && /\bpalmistry\b/i.test(event.text)) ||
          (nextScene === 'thread' && /\bcosmic thread\b/i.test(event.text)) ||
          (nextScene === 'intro' && /\b(arrival|start)\b/i.test(event.text))
        );
        if (targetMentioned) {
          console.log('[AstroVani] Completed chapter transition turn; opening scene:', nextScene, event.text);
          commitChapterScene(nextScene, 'completed assistant transition sentence');
        }
        }
      }
      if (scene === 'sky') {
        // A single Birth Sky turn routinely covers two planets ("Let's start with Venus
        // ... Now, let's move on to Mercury ..."). Pace the highlight through them in
        // time with the speech; fall back to a single instant highlight otherwise.
        if (isNegativeDoshaAnswer(event.text)) {
          console.log('[AstroVani] Negative dosha survey; leaving the Birth Sky focus untouched.');
        } else {
          const lockedPlanet = birthSkyUserPlanetLockRef.current?.planet;
          const answerMentionsLockedPlanet = lockedPlanet ? planetsFromAgentText(event.text).includes(lockedPlanet) : false;
          if (lockedPlanet && !answerMentionsLockedPlanet) {
            console.debug('[AstroVani] Ignoring stale Birth Sky completed turn while user focus is locked:', lockedPlanet);
          } else {
            // Once Jyotishi answers the requested planet, the normal agent/UI synchronization
            // may own focus again for subsequent conversational turns.
            if (lockedPlanet && answerMentionsLockedPlanet) {
              birthSkyUserPlanetLockRef.current = null;
              directPlanetFallbackRequestRef.current = null;
              if (directPlanetFallbackTimerRef.current) {
                window.clearTimeout(directPlanetFallbackTimerRef.current);
                directPlanetFallbackTimerRef.current = undefined;
              }
            }
            if (!startPacedHighlights(event.text)) {
              const planet = currentPlanetFromAgentProgress(event.text) || planetFromAgentText(event.text);
              if (planet) {
                console.log('[AstroVani] Birth Sky completed-turn focus planet:', planet);
                setSpokenPlanet(planet);
                setSpokenPlanets([planet]);
              }
            }
          }
        }
      }
      if (scene === 'kundli') {
        // The automatic "Kundli is now open" introduction is informational only.
        // Keep the chart neutral until the user starts the first Kundli question.
        if (kundliAwaitingFirstUserTurnRef.current) {
          if (/\bkundli\b/i.test(event.text) && /\b(?:open|opening|opened)\b/i.test(event.text)) {
            setSpokenPlanet(undefined);
            setSpokenPlanets([]);
            setKundliGuidance(undefined);
          }
        } else {
        const nonPlanetSubject = isLagnaOrHouseAnswer(event.text);
        const currentPlanet = nonPlanetSubject ? undefined : currentPlanetFromAgentProgress(event.text);
        const orderedPlanets = planetsFromAgentText(event.text); // narration order
        const schedule = nonPlanetSubject ? [] : pacedPlanetSchedule(event.text);
        const multiPlanet = schedule.length >= 2;
        // For a multi-planet answer the panel must open on the FIRST planet discussed and
        // then move with the speech, not jump to whichever was mentioned last.
        const focus = nonPlanetSubject ? undefined : (multiPlanet ? schedule[0].planet : (currentPlanet || orderedPlanets[0]));
        const substantiveAnswer = event.text.trim().length > 80;

        // Keep the guidance panel in lockstep with the chart as the highlight advances,
        // so the two can never disagree about which planet is being discussed.
        const negativeDosha = isNegativeDoshaAnswer(event.text);
        const paced = !negativeDosha && startPacedHighlights(event.text, (planet) => {
          setKundliGuidance(prev => (prev && prev.mode === 'remedies' && prev.planet !== planet)
            ? { ...prev, planet, title: `Traditional Guidance · ${planet}` }
            : prev);
        });
        if (negativeDosha) {
          // Ruling conditions out is not discussing a planet. Leave the chart as it is.
          console.log('[AstroVani] Negative dosha survey; leaving the Kundli focus untouched.');
        } else if (paced) {
          console.log('[AstroVani] Kundli highlights paced to speech.');
        } else if (focus) {
          console.log('[AstroVani] Kundli completed-turn focus planet:', focus);
          // The active highlight is a current-focus state, not a history list.
          // When Jyotishi moves Jupiter -> Mercury, Jupiter is released and Mercury
          // becomes the only active visual focus.
          setSpokenPlanets([focus]);
          setSpokenPlanet(focus);
        } else if (substantiveAnswer && Date.now() - lastPlanetUiSignalAtRef.current >= 5000) {
          // A real answer that names no planet - Lagna, Moon sign, a Dasha, a house -
          // must not leave the previous question's planet lit. Short acknowledgements
          // are excluded so a "Sure, one moment" does not drop a valid highlight.
          console.log('[AstroVani] Kundli answer names no planet; clearing highlight.');
          setSpokenPlanet(undefined);
          setSpokenPlanets([]);
        }
        const guidance = nonPlanetSubject ? undefined : guidanceFromText(event.text, focus ? [focus] : spokenPlanetsRef.current);
        if (guidance) {
          console.log('[AstroVani] Switching Kundli snapshot to Jyotishi Guidance:', guidance);
          setKundliGuidance(prev => {
            // If an explicit _publish_message guidance signal just selected the
            // currently spoken remedy category, keep that selection authoritative.
            if (prev?.mode === 'remedies' && Date.now() - lastGuidanceUiSignalAtRef.current < 6000 && prev.activeKind) {
              return { ...guidance, activeKind: prev.activeKind };
            }
            return guidance;
          });
        } else {
          // Hand back to the Chart Snapshot only when the conversation has actually
          // MOVED ON - a different planet, or a return to chart reading. Clearing merely
          // because one answer omitted a remedy keyword makes the panel flicker away
          // mid-conversation (e.g. a Ketu practice answer followed by "engaging in
          // reflective meditation can help..." ), which reads as random.
          setKundliGuidance(prev => {
            if (!prev) return prev;
            const continuingGuidanceTopic = Boolean(
              pendingGuidanceUserIntentRef.current &&
              Date.now() - pendingGuidanceUserIntentRef.current.at < 60_000
            );
            const movedToAnotherPlanet = Boolean(focus && prev.planet && focus !== prev.planet && !continuingGuidanceTopic);
            const backToChartReading = substantiveAnswer && isChartInterpretationAnswer(event.text) && !continuingGuidanceTopic;
            if (movedToAnotherPlanet || backToChartReading) {
              console.log('[AstroVani] Conversation moved off remedies; restoring Chart Snapshot.');
              return undefined;
            }
            return prev;
          });
        }
        }
      }
      if (scene === 'palm') {
        const palmLine = palmLineFromAgentText(event.text);
        if (palmLine) {
          console.log('[AstroVani] Transcript fallback focus palm line:', palmLine);
          setSpokenPalmLine(palmLine);
        }
      }
    }
    if (event.speaker === 'user' && scene === 'kundli') {
      kundliAwaitingFirstUserTurnRef.current = false;
      const directGuidance = isDirectKundliGuidanceRequest(event.text);
      const requestedTopic = topicFromGuidanceRequest(event.text);
      if (!directGuidance && requestedTopic !== 'General' && kundliGuidanceRef.current?.mode === 'remedies') {
        const kind = kundliGuidanceRef.current.activeKind ?? 'puja';
        pendingGuidanceUserIntentRef.current = { kind, at: Date.now() };
        setKundliGuidance(prev => prev ? {
          ...prev,
          topic: requestedTopic,
          title: `Traditional Guidance · ${requestedTopic}`
        } : prev);
      }
      if (directGuidance) {
        const topic = requestedTopic;
        const kind = requestedGuidanceKind(event.text) ?? kundliGuidanceRef.current?.activeKind ?? 'puja';
        const requestedPlanet = planetFromUserText(event.text);
        const planet = requestedPlanet ?? (topic === 'General' ? kundliGuidanceRef.current?.planet : undefined) ?? 'General';
        pendingGuidanceUserIntentRef.current = { kind, at: Date.now() };
        lastGuidanceUiSignalAtRef.current = Date.now();
        if (requestedPlanet) {
          setSpokenPlanet(requestedPlanet);
          setSpokenPlanets([requestedPlanet]);
        }
        setKundliGuidance(prev => ({
          planet,
          topic: topic !== 'General' ? topic : prev?.topic,
          mode: 'remedies',
          activeKind: kind,
          title: `Traditional Guidance · ${planet !== 'General' ? planet : (topic !== 'General' ? topic : prev?.topic ?? 'General')}`,
          subtitle: 'Illustrative options synchronized with Jyotishi. These are traditional astrology practices, not guaranteed outcomes.'
        }));

        if (kundliGuidanceFallbackTimerRef.current) window.clearTimeout(kundliGuidanceFallbackTimerRef.current);
        const requestId = ++kundliGuidanceFallbackSeqRef.current;
        kundliGuidanceFallbackRequestRef.current = { id: requestId, topic, kind, at: Date.now() };
        kundliGuidanceFallbackTimerRef.current = window.setTimeout(() => {
          kundliGuidanceFallbackTimerRef.current = undefined;
          const pending = kundliGuidanceFallbackRequestRef.current;
          if (!pending || pending.id !== requestId) return;
          const speak = agentSpeakRef.current;
          if (!speak) return;
          kundliGuidanceFallbackRequestRef.current = null;
          console.warn('[AstroVani] Kundli guidance request produced no spoken response; using /speak fallback:', topic);
          void speak(buildKundliGuidanceFallback(topic, pending.kind), { interruptable: true }).catch(error => {
            console.warn('[AstroVani] Kundli guidance fallback speech failed.', error);
          });
        }, 2600);
      }
      const guidance = guidanceFromUserText(event.text, spokenPlanetsRef.current);
      if (directGuidance) {
        // The immediate topic-level panel and response watchdog above own this turn.
      } else if (guidance) {
        // An explicit dosha question always takes over the panel.
        setSpokenPlanet(undefined);
        setSpokenPlanets([]);
        setKundliGuidance(guidance);
        const dosha = guidance.doshaKey ? supportedDoshas.find(item => item.key === guidance.doshaKey) : undefined;
        if (dosha?.planets.length) setSpokenPlanets(dosha.planets);
      } else if (introducesNewKundliSubject(event.text)) {
        const pendingGuidance = pendingGuidanceUserIntentRef.current;
        const isRelatedSplitFragment = Boolean(
          kundliGuidanceRef.current?.mode === 'remedies' &&
          pendingGuidance && Date.now() - pendingGuidance.at < 4500 &&
          planetFromUserText(event.text)
        );
        if (isRelatedSplitFragment) {
          const planet = planetFromUserText(event.text)!;
          console.log('[AstroVani] Keeping Traditional Guidance across related split user transcript:', planet);
          setSpokenPlanet(planet);
          setSpokenPlanets([planet]);
          setKundliGuidance(prev => prev ? {
            ...prev,
            planet,
            activeKind: pendingGuidance!.kind,
            title: `Traditional Guidance · ${planet}`
          } : prev);
          return;
        }
        // A genuinely new subject starts a fresh Kundli visual turn, so the previous
        // planet/remedy state must not leak into it.
        console.log('[AstroVani] New Kundli subject from user; resetting visual state.');
        setSpokenPlanet(undefined);
        setSpokenPlanets([]);
        setKundliGuidance(undefined);
        pendingGuidanceUserIntentRef.current = null;
      } else {
        // Greeting, acknowledgement, "tell me more", or ASR noise. Leave the visuals
        // exactly as they are - this turn is not a topic change.
        console.debug('[AstroVani] User turn is not a Kundli subject change; keeping current visuals.', event.text);
      }
    }
    if (event.speaker === 'user' && scene === 'palm') {
      const requestedLine = palmLineFromAgentText(event.text);
      if (requestedLine) {
        setSpokenPalmLine(requestedLine);
        if (palmLineFallbackTimerRef.current) window.clearTimeout(palmLineFallbackTimerRef.current);
        const requestId = ++palmLineFallbackSeqRef.current;
        palmLineFallbackRequestRef.current = { id: requestId, line: requestedLine, at: Date.now() };
        palmLineFallbackTimerRef.current = window.setTimeout(() => {
          palmLineFallbackTimerRef.current = undefined;
          const pending = palmLineFallbackRequestRef.current;
          if (!pending || pending.id !== requestId || pending.line !== requestedLine) return;
          const speak = agentSpeakRef.current;
          if (!speak) return;
          palmLineFallbackRequestRef.current = null;
          console.warn('[AstroVani] Palm line request produced no spoken response; using grounded /speak fallback:', requestedLine);
          void speak(buildPalmLineFallback(palmResultRef.current, requestedLine), { interruptable: true }).catch(error => {
            console.warn('[AstroVani] Palm line fallback speech failed.', error);
          });
        }, 2600);
      }
    }
    if (event.speaker === 'user' && scene !== 'intro') {
      const requested = sceneFromUserNavigation(event.text, scene);
      if (requested && requested !== scene) {
        requestedNextSceneRef.current = requested;
        pendingChapterSignalRef.current = requested;
        console.log('[AstroVani] Direct chapter navigation request:', scene, '->', requested, event.text);

        // Chapter navigation owns the turn. Clear planet/walkthrough state so a late
        // Birth Sky response can never compete with the requested destination.
        birthSkyUserPlanetLockRef.current = null;
        if (directPlanetFallbackTimerRef.current) {
          window.clearTimeout(directPlanetFallbackTimerRef.current);
          directPlanetFallbackTimerRef.current = undefined;
        }
        directPlanetFallbackRequestRef.current = null;

        if (chapterNavigationFallbackTimerRef.current) window.clearTimeout(chapterNavigationFallbackTimerRef.current);
        if (chapterNavigationHardCommitTimerRef.current) window.clearTimeout(chapterNavigationHardCommitTimerRef.current);
        const requestId = ++chapterNavigationSeqRef.current;
        chapterNavigationRequestRef.current = { id: requestId, target: requested, at: Date.now() };

        // Prefer the normal Conversational AI transition. If the provider consumes the
        // turn as a tool-only action and becomes silent, /speak supplies the exact
        // transition sentence. A final hard-commit keeps the UI from ever remaining stuck.
        chapterNavigationFallbackTimerRef.current = window.setTimeout(() => {
          chapterNavigationFallbackTimerRef.current = undefined;
          const pending = chapterNavigationRequestRef.current;
          if (!pending || pending.id !== requestId || pending.target !== requested) return;
          const speak = agentSpeakRef.current;
          if (!speak) return;
          console.warn('[AstroVani] Chapter request produced no completed transition; using /speak fallback:', requested);
          void speak(chapterTransitionSentence(requested), { interruptable: true }).catch(error => {
            console.warn('[AstroVani] Chapter transition fallback speech failed.', error);
          });

          chapterNavigationHardCommitTimerRef.current = window.setTimeout(() => {
            chapterNavigationHardCommitTimerRef.current = undefined;
            const stillPending = chapterNavigationRequestRef.current;
            if (!stillPending || stillPending.id !== requestId || stillPending.target !== requested) return;
            console.warn('[AstroVani] No final transition transcript arrived; hard-committing requested chapter:', requested);
            commitChapterScene(requested, 'navigation watchdog hard commit');
          }, 4200);
        }, 1800);
      }
    }
    if (event.speaker === 'user' && scene === 'sky') {
      // A real user turn owns the conversation immediately. Cancel every application-
      // scheduled Birth Sky continuation so a late Sun walkthrough can never overwrite
      // the user's requested focus.
      walkthroughGenerationRef.current += 1;
      clearPacedHighlights();
      birthSkyAutoIntroCancelledRef.current = true;
      if (birthSkyAutoIntroTimerRef.current) {
        window.clearTimeout(birthSkyAutoIntroTimerRef.current);
        birthSkyAutoIntroTimerRef.current = undefined;
      }

      // Do not wait for the LLM/tool round trip to update the visual. If the user says
      // "tell me about Jupiter", Jupiter becomes active on this final user transcript.
      // Jyotishi still answers through the normal Conversational AI turn; its structural
      // _publish_message planet/highlight signal simply confirms/reinforces this state.
      const requestedPlanet = planetFromUserText(event.text);
      if (requestedPlanet) {
        console.log('[AstroVani] Direct Birth Sky planet request; switching focus immediately:', requestedPlanet);
        lastPlanetUiSignalAtRef.current = 0;
        birthSkyUserPlanetLockRef.current = { planet: requestedPlanet, at: Date.now() };
        setSpokenPlanet(requestedPlanet);
        setSpokenPlanets([requestedPlanet]);

        // A provider may execute _publish_message and end the model turn without ever
        // producing assistant speech. Give the normal conversational turn a short window
        // to start; if it does not, speak a chart-grounded answer ourselves. This is a
        // fallback only, not the primary response path.
        if (directPlanetFallbackTimerRef.current) window.clearTimeout(directPlanetFallbackTimerRef.current);
        const requestId = ++directPlanetFallbackSeqRef.current;
        directPlanetFallbackRequestRef.current = { id: requestId, planet: requestedPlanet, at: Date.now() };
        directPlanetFallbackTimerRef.current = window.setTimeout(() => {
          directPlanetFallbackTimerRef.current = undefined;
          const pending = directPlanetFallbackRequestRef.current;
          if (!pending || pending.id !== requestId || pending.planet !== requestedPlanet) return;
          const speak = agentSpeakRef.current;
          if (!speak) return;
          const answer = buildDirectPlanetFallback(chart, requestedPlanet);
          console.warn('[AstroVani] No spoken response followed direct planet request; using chart-grounded /speak fallback:', requestedPlanet);
          directPlanetFallbackRequestRef.current = null;
          void speak(answer, { interruptable: true }).catch(error => {
            console.warn('[AstroVani] Direct planet fallback speech failed.', error);
          });
        }, 2200);
      }

      console.log('[AstroVani] User interrupted Birth Sky; cancelled queued walkthrough continuation.');
    }
    if (scene !== 'intro' || event.speaker !== 'user' || profileCompletedRef.current || extractionBusyRef.current) return;
    extractionBusyRef.current = true;
    try {
      const current = profileProgressRef.current;
      const result = await extractBirthProfile(transcriptRef.current, current);
      // Never let undefined/null extraction fields erase previously captured data.
      const next = mergeDefinedProfile(current, result);
      delete (next as { complete?: boolean }).complete;
      profileProgressRef.current = next;
      setProfileProgress(next);
      if (next.name && next.date && next.time && next.place) {
        await completeProfile({
          name: next.name,
          date: next.date,
          time: next.time,
          place: next.place,
          language: next.language || 'Auto'
        }, 'voice');

        // Reconcile a transition sentence that may have completed while the
        // asynchronous profile extractor was still processing the user's final
        // answer. Only the exact final phrase can set birthSkyTransitionPhraseRef,
        // so ordinary mentions such as "to open your Birth Sky..." cannot open it.
        if (birthSkyTransitionPhraseRef.current && scene === 'intro') {
          console.log('[AstroVani] Profile reached 4/4 after completed Birth Sky transition; opening Birth Sky now.');
          pendingChapterSignalRef.current = null;
          pendingBirthSkySignalRef.current = false;
          birthSkyTransitionPhraseRef.current = false;
          birthSkyAnnouncementRef.current = true;
          setSpokenPalmLine(undefined);
          setSpokenPlanet('Sun');
          setSpokenPlanets(['Sun']);
          setScene('sky');
        }
      }
    } catch (error) {
      console.warn('Birth profile extraction failed', error);
    } finally {
      extractionBusyRef.current = false;
    }
  }, [completeProfile, scene, startPacedHighlights, clearPacedHighlights, chart, commitChapterScene]);

  const handleUiSignal = useCallback((signal: UiSignal) => {
    const chapterMap: Partial<Record<UiSignal['target'], SceneName>> = {
      arrival: 'intro',
      birth_sky: 'sky',
      kundli: 'kundli',
      palmistry: 'palm',
      cosmic_thread: 'thread'
    };

    if (signal.target === 'palm_line' && signal.action === 'highlight' && signal.value) {
      const line = signal.value.toLowerCase() as PalmLineId;
      if (['heart_line', 'head_line', 'life_line', 'fate_line'].includes(line)) {
        console.log('[AstroVani] Applying palm line highlight signal:', line, signal);
        setSpokenPalmLine(line);
      }
      return;
    }

    if (signal.target === 'kundli_guidance' && signal.action === 'highlight' && signal.value) {
      const kind = signal.value.toLowerCase();
      if (['puja', 'mantra', 'gemstone', 'practice'].includes(kind)) {
        console.log('[AstroVani] Applying sequential Kundli guidance signal:', kind, signal);
        lastGuidanceUiSignalAtRef.current = Date.now();
        setKundliGuidance(prev => prev?.mode === 'remedies'
          ? { ...prev, activeKind: kind as KundliGuidance['activeKind'] }
          : prev);
      }
      return;
    }

    if (signal.target === 'planet' && signal.action === 'highlight' && signal.value) {
      const match = planetNames.find(name => name.toLowerCase() === signal.value?.toLowerCase());
      if (match) {
        // A direct named-planet question in Birth Sky is already highlighted from the
        // user's final transcript. Providers can deliver a delayed _publish_message
        // from the interrupted/previous turn (the logs showed Mercury arriving after a
        // newer Mars request). While the user-turn lock is active, never let an older
        // tool signal steal focus from the planet the user explicitly requested.
        const lockedPlanet = scene === 'sky' ? birthSkyUserPlanetLockRef.current?.planet : undefined;
        if (lockedPlanet && match !== lockedPlanet) {
          console.debug('[AstroVani] Ignoring stale planet ui_signal while direct user focus is locked:', match, '->', lockedPlanet, signal);
          return;
        }
        console.log('[AstroVani] Applying planet highlight signal:', match, signal);
        lastPlanetUiSignalAtRef.current = Date.now();
        setSpokenPlanet(match);
        // In Kundli this is the *current* spoken focus. Replace the old highlight
        // instead of accumulating previous planets from the same conversation.
        setSpokenPlanets([match]);
      }
      return;
    }

    if (signal.action === 'show') {
      if (signal.target === 'birth_sky' && !hasCompleteBirthProfile(profileProgressRef.current)) {
        console.warn('[AstroVani] Deferring premature birth_sky ui_signal; profile is incomplete.', profileProgressRef.current, signal);
        // Keep only the visual intent. This signal cannot open the scene by itself;
        // the exact completed assistant transition sentence is still required.
        pendingChapterSignalRef.current = 'sky';
        pendingBirthSkySignalRef.current = true;
        return;
      }
      const nextScene = chapterMap[signal.target];
      if (nextScene) {
        console.log('[AstroVani] Received Jyotishi chapter UI intent:', signal, '->', nextScene);
        // Never switch a major chapter in the middle of speech. Record the intent
        // and let the completed final assistant transcript commit the transition.
        pendingChapterSignalRef.current = nextScene;
        if (nextScene === 'sky') pendingBirthSkySignalRef.current = true;
      }
    }
  }, [scene]);

  const handleAgentTranscriptProgress = useCallback((event: TranscriptEvent) => {
    if (event.speaker !== 'agent') return;

    // The normal turn has started. Cancel the silence watchdog before doing any visual
    // parsing so a slow, streaming answer is never duplicated by /speak.
    if (event.text.trim() && kundliGuidanceFallbackRequestRef.current) {
      kundliGuidanceFallbackRequestRef.current = null;
      if (kundliGuidanceFallbackTimerRef.current) {
        window.clearTimeout(kundliGuidanceFallbackTimerRef.current);
        kundliGuidanceFallbackTimerRef.current = undefined;
      }
    }
    if (event.text.trim() && palmLineFallbackRequestRef.current) {
      palmLineFallbackRequestRef.current = null;
      if (palmLineFallbackTimerRef.current) {
        window.clearTimeout(palmLineFallbackTimerRef.current);
        palmLineFallbackTimerRef.current = undefined;
      }
    }

    // Streaming transcription outruns the spoken audio, so once a turn is known to cover
    // more than one planet the paced schedule owns the highlight. Instant updates are
    // kept only for single-planet answers, where they give fast feedback with no risk of
    // getting ahead of the voice.
    if (planetMentionsInOrder(event.text).length >= 2) return;
    // Enumerating doshas to rule them out is not discussing a planet.
    if (isNegativeDoshaAnswer(event.text)) return;

    // Birth Sky needs the same live synchronization Kundli already had. Without it the
    // highlight only updated once per completed turn, so a two-planet walkthrough left
    // the first planet lit for the entire answer.
    if (scene === 'sky') {
      const livePlanet = currentPlanetFromAgentProgress(event.text);
      const lockedPlanet = birthSkyUserPlanetLockRef.current?.planet;
      // Ignore packets from the interrupted/previous answer until the requested planet
      // appears in Jyotishi's live transcript. This keeps Mars highlighted immediately.
      if (lockedPlanet && livePlanet && livePlanet !== lockedPlanet) return;
      if (lockedPlanet && livePlanet === lockedPlanet) {
        directPlanetFallbackRequestRef.current = null;
        if (directPlanetFallbackTimerRef.current) {
          window.clearTimeout(directPlanetFallbackTimerRef.current);
          directPlanetFallbackTimerRef.current = undefined;
        }
      }
      if (livePlanet && Date.now() - lastPlanetUiSignalAtRef.current >= 5000) {
        setSpokenPlanet(livePlanet);
        setSpokenPlanets([livePlanet]);
      }
      return;
    }

    if (scene !== 'kundli') return;
    if (kundliAwaitingFirstUserTurnRef.current) return;
    // Assistant transcription packets arrive while Jyotishi is speaking. Use
    // them only for live visual synchronization (never for visible transcript rows).
    // Planet focus follows the latest spoken planet so Jupiter -> Mercury visibly
    // transitions instead of keeping both planets highlighted. Explicit UI tool
    // signals remain authoritative for a short window when available.
    const currentPlanet = currentPlanetFromAgentProgress(event.text);
    if (currentPlanet && Date.now() - lastPlanetUiSignalAtRef.current >= 5000) {
      setSpokenPlanets([currentPlanet]);
      setSpokenPlanet(currentPlanet);
    }

    const guidance = guidanceFromText(event.text, currentPlanet ? [currentPlanet] : []);
    if (guidance) {
      setKundliGuidance(prev => {
        if (prev?.mode === 'remedies' && Date.now() - lastGuidanceUiSignalAtRef.current < 6000 && prev.activeKind) {
          return { ...guidance, activeKind: prev.activeKind };
        }
        return guidance;
      });
    } else if (currentPlanet) {
      // Never unmount Traditional Guidance from an in-progress assistant packet.
      // Early packets often contain a planet before the remedy/category wording;
      // clearing here caused Chart Snapshot -> Guidance flashes during one answer.
      // A completed assistant turn owns any genuine return to chart interpretation.
      console.debug('[AstroVani] Live Kundli planet changed without completed guidance intent; preserving panel until turn completion.', currentPlanet);
    }
  }, [scene]);

  const handleAgentState = useCallback((activity: AgentActivityState) => {
    // Keep agent-state diagnostics, but do not use generic `silent` as the primary
    // transition trigger. In some ConvoAI builds it can arrive before the final
    // assistant transcription for the same turn. The completed transition sentence
    // in handleTranscriptEvent is the authoritative synchronization boundary.
    if (activity === 'silent' && scene === 'intro' && pendingBirthSkySignalRef.current) {
      console.debug('[AstroVani] Agent is silent while Birth Sky intent is pending; waiting for completed transition transcript.');
    }
  }, [scene]);

  const agora = useAgoraSession(appendTranscript, handleTranscriptEvent, handleUiSignal, handleAgentState, handleAgentTranscriptProgress);

  useEffect(() => {
    agentSpeakRef.current = agora.speak;
    return () => {
      agentSpeakRef.current = null;
    };
  }, [agora.speak]);

  useEffect(() => () => {
    if (directPlanetFallbackTimerRef.current) window.clearTimeout(directPlanetFallbackTimerRef.current);
    if (kundliGuidanceFallbackTimerRef.current) window.clearTimeout(kundliGuidanceFallbackTimerRef.current);
    if (palmLineFallbackTimerRef.current) window.clearTimeout(palmLineFallbackTimerRef.current);
    if (chapterNavigationFallbackTimerRef.current) window.clearTimeout(chapterNavigationFallbackTimerRef.current);
    if (chapterNavigationHardCommitTimerRef.current) window.clearTimeout(chapterNavigationHardCommitTimerRef.current);
    if (birthSkyAutoIntroTimerRef.current) window.clearTimeout(birthSkyAutoIntroTimerRef.current);
    if (kundliAutoIntroTimerRef.current) window.clearTimeout(kundliAutoIntroTimerRef.current);
    if (palmAutoIntroTimerRef.current) window.clearTimeout(palmAutoIntroTimerRef.current);
    if (threadAutoIntroTimerRef.current) window.clearTimeout(threadAutoIntroTimerRef.current);
  }, []);

  useEffect(() => {
    if (scene !== 'sky' || birthSkyIntroSpokenRef.current || birthSkyAutoIntroCancelledRef.current || agora.state !== 'connected') return;

    // Do NOT mark this as spoken until the delayed /speak actually starts. The old
    // implementation marked the ref before scheduling. Any React re-render (including
    // the chart/session update that happens while Birth Sky opens) cleaned up the timer
    // while leaving the ref true, permanently suppressing the introduction.
    //
    // Also do not bind this timer to walkthroughGenerationRef: the scene-change cleanup
    // intentionally increments that generation after the Birth Sky render, which made
    // every freshly scheduled intro self-cancel. User interruption has its own explicit
    // cancellation ref + timer clear below.
    birthSkyAutoIntroTimerRef.current = window.setTimeout(() => {
      birthSkyAutoIntroTimerRef.current = undefined;
      if (scene !== 'sky' || birthSkyIntroSpokenRef.current || birthSkyAutoIntroCancelledRef.current) return;

      birthSkyIntroSpokenRef.current = true;
      // Spoken from the ACTIVE chart so Jyotishi and the visual always agree.
      const sun = chart.planets.find(p => p.name === 'Sun');
      const sunPlacement = sun
        ? `The Sun is in ${sun.sign} in your ${ordinal(sun.house)} house at ${spokenDegree(sun.degree)}.`
        : 'The Sun opens your birth sky.';
      const intro = `The Birth Sky is now open. Let us begin with the Sun. ${sunPlacement} This placement traditionally emphasizes self-expression, communication, learning, and the confidence to share your ideas. You can interrupt me at any time or ask about another planet.`;
      console.log('[AstroVani] Starting automatic Birth Sky introduction.');
      void agora.speak(intro, { interruptable: true });
    }, 650);

    return () => {
      if (birthSkyAutoIntroTimerRef.current) {
        window.clearTimeout(birthSkyAutoIntroTimerRef.current);
        birthSkyAutoIntroTimerRef.current = undefined;
      }
    };
  }, [agora, scene, chart]);

  useEffect(() => {
    if (scene !== 'kundli' || kundliIntroSpokenRef.current || agora.state !== 'connected') return;

    // Chapter-entry intros must not depend on walkthroughGenerationRef. The scene-change
    // cleanup intentionally invalidates old walkthrough generations after a chapter switch;
    // using that generation here caused a freshly queued "Kundli is now open" message to
    // cancel itself before it could speak.
    kundliAutoIntroTimerRef.current = window.setTimeout(() => {
      kundliAutoIntroTimerRef.current = undefined;
      if (scene !== 'kundli' || kundliIntroSpokenRef.current) return;
      const speak = agentSpeakRef.current;
      if (!speak) return;

      kundliIntroSpokenRef.current = true;
      const dashaLords = chart.dasha.split('/').map(part => part.trim()).filter(Boolean);
      const spokenDasha = dashaLords.length > 1 ? `${dashaLords[0]} and ${dashaLords[1]}` : (dashaLords[0] || 'not yet determined');
      const intro = `Your Kundli is now open. The same nine Navagraha placements are translated into this Vedic chart. Your Lagna is ${chart.lagna}, your Moon sign is ${chart.moonSign}, and your current illustrative Dasha is ${spokenDasha}. We can explore a planet, house, Dasha, Dosha, gemstone, mantra, puja, or traditional guidance. Would you like me to begin with your Lagna, Moon sign, current Dasha, or a specific planet?`;
      console.log('[AstroVani] Starting automatic Kundli introduction.');
      void speak(intro, { interruptable: true }).catch((error) => {
        kundliIntroSpokenRef.current = false;
        console.warn('[AstroVani] Automatic Kundli introduction failed; will retry while the chapter remains open.', error);
      });
    }, 650);

    return () => {
      if (kundliAutoIntroTimerRef.current) {
        window.clearTimeout(kundliAutoIntroTimerRef.current);
        kundliAutoIntroTimerRef.current = undefined;
      }
    };
  }, [agora.state, scene, chart]);

  useEffect(() => {
    if (scene !== 'palm' || palmIntroSpokenRef.current || agora.state !== 'connected') return;

    palmAutoIntroTimerRef.current = window.setTimeout(() => {
      palmAutoIntroTimerRef.current = undefined;
      if (scene !== 'palm' || palmIntroSpokenRef.current) return;
      const speak = agentSpeakRef.current;
      if (!speak) return;

      palmIntroSpokenRef.current = true;
      const intro = 'Palmistry is now open. Please open the Palm Camera, place one open palm inside the guide, and capture your palm when it is centered, upright, and steady. After the capture, I can guide you through the Heart line, Head line, Life line, and Fate line step by step.';
      console.log('[AstroVani] Starting automatic Palmistry introduction.');
      void speak(intro, { interruptable: true }).catch((error) => {
        palmIntroSpokenRef.current = false;
        console.warn('[AstroVani] Automatic Palmistry introduction failed; will retry while the chapter remains open.', error);
      });
    }, 650);

    return () => {
      if (palmAutoIntroTimerRef.current) {
        window.clearTimeout(palmAutoIntroTimerRef.current);
        palmAutoIntroTimerRef.current = undefined;
      }
    };
  }, [agora.state, scene]);

  useEffect(() => {
    if (scene !== 'thread' || threadIntroSpokenRef.current || agora.state !== 'connected') return;
    threadAutoIntroTimerRef.current = window.setTimeout(() => {
      threadAutoIntroTimerRef.current = undefined;
      if (scene !== 'thread' || threadIntroSpokenRef.current) return;
      const speak = agentSpeakRef.current;
      if (!speak) return;
      threadIntroSpokenRef.current = true;
      console.log('[AstroVani] Starting automatic Cosmic Thread introduction.');
      const intro = 'The Cosmic Thread is now open. This timeline connects your calculated chart themes and planetary periods into one guided journey. Ask me about the current phase, an upcoming period, or a life theme you want to explore.';
      void speak(intro, { interruptable: true }).catch(error => {
        threadIntroSpokenRef.current = false;
        console.warn('[AstroVani] Automatic Cosmic Thread introduction failed; will retry while the chapter remains open.', error);
      });
    }, 550);
    return () => {
      if (threadAutoIntroTimerRef.current) {
        window.clearTimeout(threadAutoIntroTimerRef.current);
        threadAutoIntroTimerRef.current = undefined;
      }
    };
  }, [agora.state, scene]);

  useEffect(() => { spokenPlanetRef.current = spokenPlanet; }, [spokenPlanet]);
  useEffect(() => { spokenPlanetsRef.current = spokenPlanets; }, [spokenPlanets]);
  useEffect(() => { kundliGuidanceRef.current = kundliGuidance; }, [kundliGuidance]);

  // Safety net: keep the visual planet synchronized with the latest completed
  // Jyotishi transcript even when a provider fails to deliver _publish_message.
  // The RTC listener is long-lived, so this React-level effect also guarantees that
  // scene changes cannot leave the old Arrival callback captured by the listener.
  useEffect(() => {
    if (scene !== 'sky' && scene !== 'kundli') return;

    // Find the latest agent line AND its position, because position is what tells us
    // whether it is still relevant.
    let latestAgentIndex = -1;
    for (let i = transcript.length - 1; i >= 0; i--) {
      if (transcript[i].startsWith('Jyotishi: ')) { latestAgentIndex = i; break; }
    }
    if (latestAgentIndex < 0) return;

    // If the newest Jyotishi line is OLDER than the newest user turn, the user has asked
    // something new that Jyotishi has not answered yet. Re-deriving state from that stale
    // line is what made a fresh "start with Lagna" question instantly re-highlight the
    // planet from the previous answer, undoing the deliberate reset in the user branch.
    if (latestAgentIndex < lastUserTurnIndexRef.current) {
      console.debug('[AstroVani] Skipping safety-net sync: newest Jyotishi turn predates the latest user question.');
      return;
    }

    // While a paced walkthrough is running it owns the highlight; the safety net must not
    // yank focus to the last-mentioned planet mid-answer.
    if (pacedHighlightTimersRef.current.length) return;

    const text = transcript[latestAgentIndex].slice('Jyotishi: '.length);
    // Same rule as the completed-turn handler: a "no dosha indicated" survey must not
    // pull focus onto a planet that only appeared inside a parenthetical definition.
    if (isNegativeDoshaAnswer(text)) return;
    if (scene === 'kundli') {
      if (kundliAwaitingFirstUserTurnRef.current) {
        // Keep a newly opened Kundli neutral without creating a render loop. In the old
        // version `setSpokenPlanets([])` allocated a new array every time this effect ran;
        // because `spokenPlanets` is also a dependency, React repeatedly re-rendered until
        // it hit "Maximum update depth exceeded", starving the chapter auto-intro.
        setSpokenPlanet(prev => prev === undefined ? prev : undefined);
        setSpokenPlanets(prev => prev.length === 0 ? prev : []);
        setKundliGuidance(prev => prev === undefined ? prev : undefined);
        return;
      }
      // The paced walkthrough has finished by the time this runs (it returns early
      // otherwise), so the correct resting state is the LAST planet discussed - which is
      // exactly what `currentPlanetFromAgentProgress` resolves.
      const nonPlanetSubject = isLagnaOrHouseAnswer(text);
      const focus = nonPlanetSubject ? undefined : (currentPlanetFromAgentProgress(text) || planetsFromAgentText(text).slice(-1)[0]);
      const substantiveAnswer = text.trim().length > 80;
      if (nonPlanetSubject) {
        setSpokenPlanets(prev => prev.length === 0 ? prev : []);
        setSpokenPlanet(prev => prev === undefined ? prev : undefined);
      }
      if (focus && Date.now() - lastPlanetUiSignalAtRef.current >= 5000) {
        setSpokenPlanets(prev => prev.length === 1 && prev[0] === focus ? prev : [focus]);
        setSpokenPlanet(prev => prev === focus ? prev : focus);
      }
      const guidance = nonPlanetSubject ? undefined : guidanceFromText(text, focus ? [focus] : spokenPlanetsRef.current);
      if (guidance) {
        setKundliGuidance(prev => {
          const next = (prev?.mode === 'remedies' && Date.now() - lastGuidanceUiSignalAtRef.current < 6000 && prev.activeKind)
            ? { ...guidance, activeKind: prev.activeKind }
            : guidance;
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
      } else if (substantiveAnswer && isChartInterpretationAnswer(text) && Date.now() - lastGuidanceUiSignalAtRef.current >= 6000 &&
        !(pendingGuidanceUserIntentRef.current && Date.now() - pendingGuidanceUserIntentRef.current.at < 60_000)) {
        // Mirror the completed-turn rule: hand back to the Chart Snapshot only on a real
        // return to chart reading, not on any answer that lacks a remedy keyword.
        setKundliGuidance(undefined);
      }
      return;
    }
    // Same latest-mention resolution as the completed-turn handler, so a two-planet
    // Birth Sky turn does not get pulled back to the first planet by the safety net.
    const planet = currentPlanetFromAgentProgress(text) || planetFromAgentText(text);
    const lockedPlanet = birthSkyUserPlanetLockRef.current?.planet;
    if (lockedPlanet && planet && planet !== lockedPlanet) {
      console.debug('[AstroVani] Transcript history safety ignored stale planet because user focus is locked:', planet, '->', lockedPlanet);
      return;
    }
    if (planet && planet !== spokenPlanetRef.current && Date.now() - lastPlanetUiSignalAtRef.current >= 5000) {
      console.log('[AstroVani] Transcript history safety focus planet:', planet);
      setSpokenPlanet(prev => prev === planet ? prev : planet);
      setSpokenPlanets(prev => prev.length === 1 && prev[0] === planet ? prev : [planet]);
    }
  }, [scene, transcript]);

  useEffect(() => { agentIdRef.current = agora.agentId; }, [agora.agentId]);

  // Leaving a chapter (or unmounting) must not leave timers running that would highlight
  // a planet in a scene the user is no longer looking at.
  useEffect(() => {
    walkthroughGenerationRef.current += 1;
    clearPacedHighlights();
  }, [scene, clearPacedHighlights]);

  useEffect(() => () => clearPacedHighlights(), [clearPacedHighlights]);

  useEffect(() => {
    if (agora.state === 'connected' && scene === 'intro') {
      appendTranscript('System: Voice session is live. Jyotishi will collect your name, birth date, birth time and birth place.');
    }
  }, [agora.state, appendTranscript, scene]);

  const handlePalmAnalyzed = useCallback(async (palm: PalmResult) => {
    if (scene !== 'palm') return;
    palmResultRef.current = palm;

    // Re-brief the running agent with the exact structured result before speaking. The
    // agent should reason from this context, but never narrate CV confidence, capture
    // percentages, tracing implementation or other diagnostics to the user.
    if (agora.agentId) {
      try {
        await updateAgentPalm(agora.agentId, profile ?? profileProgress, palm);
      } catch (error) {
        console.error('[AstroVani] Failed to re-brief agent with palm analysis', error);
      }
    }

    const readable = palm.lines.filter(line =>
      (line.status === 'detected' || line.status === 'approximate') && line.confidence >= 0.45
    );
    const first = readable[0];
    if (!first) {
      setSpokenPalmLine(undefined);
      try {
        await agora.speak('I can see your palm, but the major lines are not clear enough for a reliable guided reading yet. Please retake it with your palm flat, close to the camera, and evenly lit.', { interruptable: true });
      } catch (error) {
        console.error('[AstroVani] Failed to start palm retake guidance', error);
      }
      return;
    }

    setSpokenPalmLine(first.id);
    const describe = (line: PalmResult['lines'][number]) => {
      const morphology = line.observation && line.observation !== 'indeterminate'
        ? ` It appears ${line.observation}.`
        : '';
      return `${line.name}: ${line.traditionalReading}${morphology}`;
    };
    const second = readable.find(line => line.id !== first.id);
    const opening = `I can see your major palm lines now. Let me begin with your ${first.name}. ${describe(first)}${second ? ` After that, we can look at your ${second.name}.` : ''}`;
    try {
      await agora.speak(opening, { interruptable: true });
    } catch (error) {
      console.error('[AstroVani] Failed to start automatic palm walkthrough', error);
    }
  }, [agora.agentId, agora.speak, profile, profileProgress, scene]);

  async function startVoice() {
    profileCompletedRef.current = false;
    pendingBirthSkySignalRef.current = false;
    pendingChapterSignalRef.current = null;
    requestedNextSceneRef.current = null;
    birthSkyAnnouncementRef.current = false;
    birthSkyTransitionPhraseRef.current = false;
    birthSkyIntroSpokenRef.current = false;
    birthSkyAutoIntroCancelledRef.current = false;
    kundliIntroSpokenRef.current = false;
    palmIntroSpokenRef.current = false;
    threadIntroSpokenRef.current = false;
    chapterNavigationRequestRef.current = null;
    setSpokenPlanet(undefined);
    setSpokenPlanets([]);
    walkthroughGenerationRef.current += 1;
    setSpokenPalmLine(undefined);
    setProfile(undefined);
    profileProgressRef.current = {};
    setProfileProgress({});
    transcriptRef.current = [];
    lastUserTurnIndexRef.current = -1;
    clearPacedHighlights();
    setTranscript(['System: Starting your live Cosmic Journey…']);
    await agora.start();
  }

  async function startTyped(birthProfile: BirthProfile) {
    profileCompletedRef.current = false;
    await agora.start(birthProfile);
    await completeProfile(birthProfile, 'typed');
  }

  return (
    <div className="app-shell">
      <TopBar scene={scene} connectionState={agora.state} />
      <main className="app-main">
        <JourneyRail scene={scene} onChange={setScene} />
        <section className="stage">
          {scene === 'intro' && <BirthForm
            onStartVoice={startVoice}
            onStartTyped={startTyped}
            loading={loading}
            connecting={agora.state === 'connecting'}
            live={agora.state === 'connected'}
            profileProgress={profileProgress}
          />}
          {scene === 'sky' && <BirthSkyScene chart={chart} profile={profile} focusPlanet={spokenPlanet} onNext={() => setScene('kundli')} />}
          {scene === 'kundli' && <KundliScene chart={chart} profile={profile ?? profileProgress} focusPlanets={spokenPlanets} guidance={kundliGuidance} onNext={() => setScene('palm')} />}
          {scene === 'palm' && <PalmScene focusLine={spokenPalmLine} agoraCameraTrack={agora.localVideoTrack} onAnalyzed={handlePalmAnalyzed} onNext={() => setScene('thread')} />}
          {scene === 'thread' && <CosmicThreadScene
            chart={chart}
            profile={profile ?? profileProgress}
            focusPlanets={spokenPlanets}
            onExplore={agora.state === 'connected' ? (prompt) => {
              void agora.ask(prompt).catch(error => console.warn('[AstroVani] Cosmic Thread card query failed.', error));
            } : undefined}
          />}
        </section>
        <GuidePanel
          scene={scene}
          transcript={transcript}
          connectionState={agora.state}
          error={agora.error}
          channel={agora.channel}
          micEnabled={agora.micEnabled}
          cameraEnabled={agora.cameraEnabled}
          localVideoTrack={agora.localVideoTrack}
          remoteVideoTrack={agora.remoteVideoTrack}
          profile={profile}
          profileProgress={profileProgress}
          onDisconnect={agora.stop}
          onToggleMic={agora.toggleMic}
          onToggleCamera={agora.toggleCamera}
        />
      </main>
    </div>
  );
}
