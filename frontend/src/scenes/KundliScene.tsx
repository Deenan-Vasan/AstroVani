import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { BirthProfile, ChartData } from '../types';
import type { KundliGuidance } from '../App';

/*
 * North Indian kundli geometry, for the 400x400 board drawn below.
 *
 * The board previously placed each planet at a FIXED point keyed by its name - Sun always
 * top-centre, Moon always mid-left - so the diamond ignored the chart entirely. With one
 * hardcoded chart that was invisible; now that every user gets their own, the board would
 * have been the only element disagreeing with the Chart Snapshot and with Jyotishi.
 *
 * The square (8..392) with both diagonals and the four mid-edge lines forms 12
 * compartments. House 1 is the top-centre kite and the houses run ANTICLOCKWISE.
 * Coordinates below are the centroids of those compartments.
 */
const HOUSE_CENTERS: Record<number, [number, number]> = {
  1: [200, 104], 2: [104, 40], 3: [40, 104], 4: [104, 200],
  5: [40, 296], 6: [104, 360], 7: [200, 296], 8: [296, 360],
  9: [360, 296], 10: [296, 200], 11: [360, 104], 12: [296, 40]
};

/** Where each compartment's sign number sits, nudged clear of the planet stack. */
const HOUSE_SIGN_LABEL: Record<number, [number, number]> = {
  1: [200, 58], 2: [46, 26], 3: [24, 62], 4: [58, 200],
  5: [24, 338], 6: [46, 374], 7: [200, 342], 8: [354, 374],
  9: [376, 338], 10: [342, 200], 11: [376, 62], 12: [354, 26]
};

const ZODIAC = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
];

/**
 * How much vertical room each compartment really has, and which way to nudge a stack.
 *
 * The corner triangles taper to a point, so a stack centred on the centroid runs out of
 * room: five planets in house 2 pushed the first row onto the border. `band` is the
 * half-height available and `bias` shifts the stack toward the wide end (down for the top
 * corners, up for the bottom ones). Spacing is then clamped so a stack of ANY size fits -
 * a stellium of five or six planets in one house is entirely possible in a real chart.
 */
const HOUSE_STACK: Record<number, { band: number; bias: number }> = {
  1: { band: 62, bias: 8 }, 4: { band: 62, bias: 0 }, 7: { band: 62, bias: -8 }, 10: { band: 62, bias: 0 },
  2: { band: 30, bias: 12 }, 12: { band: 30, bias: 12 },
  6: { band: 30, bias: -12 }, 8: { band: 30, bias: -12 },
  3: { band: 34, bias: 0 }, 5: { band: 34, bias: 0 }, 9: { band: 34, bias: 0 }, 11: { band: 34, bias: 0 }
};

/** Traditional two-letter abbreviations, so several planets fit in one compartment. */
const PLANET_SHORT: Record<string, string> = {
  Sun: 'Su', Moon: 'Mo', Mars: 'Ma', Mercury: 'Me', Jupiter: 'Ju',
  Venus: 'Ve', Saturn: 'Sa', Rahu: 'Ra', Ketu: 'Ke'
};

const planetGlyphs: Record<string, string> = {
  Sun: '☉', Moon: '☾', Mars: '♂', Mercury: '☿', Jupiter: '♃', Venus: '♀', Saturn: '♄', Rahu: '☊', Ketu: '☋'
};

const elementLegend = [
  ['Fire', '🔥'], ['Earth', '◉'], ['Air', '◆'], ['Water', '◉'], ['Shadow', '☊']
] as const;

type GuidanceKind = 'puja' | 'mantra' | 'gemstone' | 'practice';
type GuidanceCard = {
  kind: GuidanceKind;
  icon: string;
  label: string;
  title: string;
  body: string;
  bestDay?: string;
  suggestedTime?: string;
  detailLabel?: string;
  detailValue?: string;
  purpose?: string;
  futureAction?: string;
};

const guidanceLibrary: Record<string, GuidanceCard[]> = {
  General: [
    { kind: 'puja', icon: '🛕', label: 'TEMPLE / PUJA', title: 'Ganesha Puja', body: 'Illustrative traditional worship associated with auspicious beginnings and removing obstacles.', bestDay: 'Traditional day', suggestedTime: 'Morning', detailLabel: 'Context', detailValue: 'New beginnings', purpose: 'Traditional focus on clarity, preparation and an auspicious start.', futureAction: 'Book Puja · future' },
    { kind: 'mantra', icon: 'ॐ', label: 'MANTRA', title: 'Ganesha Mantra', body: 'A traditional mantra practice associated with beginning a new undertaking.', bestDay: 'Flexible', suggestedTime: 'Morning', detailLabel: 'Practice', detailValue: '108 repetitions', purpose: 'Reflective focus before a new beginning.' },
    { kind: 'gemstone', icon: '💎', label: 'GEMSTONE', title: 'Chart-specific gemstone', body: 'No gemstone is assumed for a general life topic without a supporting planetary assessment.', bestDay: '—', suggestedTime: '—', detailLabel: 'Association', detailValue: 'Chart-dependent', purpose: 'Avoid unsupported universal gemstone recommendations.' },
    { kind: 'practice', icon: '🪔', label: 'PRACTICE', title: 'Auspicious Beginning Practice', body: 'Illustrative planning, gratitude, charity and mindful preparation before a new undertaking.', bestDay: 'Flexible', suggestedTime: 'Before beginning', detailLabel: 'Example', detailValue: 'Planning / charity', purpose: 'A grounded traditional routine for a considered start.' }
  ],
  Sun: [
    { kind: 'puja', icon: '🛕', label: 'TEMPLE / PUJA', title: 'Surya Arghya / Surya Puja', body: 'Illustrative Sun-focused worship and sunrise offering.', bestDay: 'Sunday', suggestedTime: 'Sunrise', detailLabel: 'Example', detailValue: 'Surya temple / sunrise', purpose: 'Traditional focus on clarity, confidence and vitality.', futureAction: 'Book Puja · future' },
    { kind: 'mantra', icon: 'ॐ', label: 'MANTRA', title: 'Surya Mantra', body: 'A traditional Sunday mantra practice associated with the Sun.', bestDay: 'Sunday', suggestedTime: 'Sunrise', detailLabel: 'Practice', detailValue: '108 repetitions', purpose: 'Reflective focus on clarity and confidence.' },
    { kind: 'gemstone', icon: '💎', label: 'GEMSTONE', title: 'Ruby', body: 'Traditionally associated with the Sun; suitability should be reviewed before use.', bestDay: 'Sunday', suggestedTime: 'Daytime', detailLabel: 'Association', detailValue: 'Sun', purpose: 'Illustrative gemstone association only.', futureAction: 'View Gemstone · future' },
    { kind: 'practice', icon: '🪔', label: 'PRACTICE', title: 'Sunday Sunrise Practice', body: 'Illustrative sunrise reflection, gratitude and service.', bestDay: 'Sunday', suggestedTime: 'Sunrise', detailLabel: 'Example', detailValue: 'Sunrise offering', purpose: 'Traditional routine centered on confidence and discipline.' }
  ],
  Moon: [
    { kind: 'puja', icon: '🛕', label: 'TEMPLE / PUJA', title: 'Chandra Puja', body: 'Illustrative Moon-focused worship associated with calm and emotional balance.', bestDay: 'Monday', suggestedTime: 'Evening', detailLabel: 'Example venue', detailValue: 'Shiva / Chandra temple', purpose: 'Traditional focus on calm, reflection and emotional steadiness.', futureAction: 'Book Puja · future' },
    { kind: 'mantra', icon: 'ॐ', label: 'MANTRA', title: 'Chandra Mantra', body: 'A traditional Monday mantra practice associated with the Moon.', bestDay: 'Monday', suggestedTime: 'Evening', detailLabel: 'Practice', detailValue: '108 repetitions', purpose: 'Reflective practice for calm and emotional awareness.' },
    { kind: 'gemstone', icon: '💎', label: 'GEMSTONE', title: 'Pearl', body: 'Traditionally associated with the Moon; suitability should be reviewed before use.', bestDay: 'Monday', suggestedTime: 'Daytime', detailLabel: 'Association', detailValue: 'Moon', purpose: 'Illustrative gemstone association only.', futureAction: 'View Gemstone · future' },
    { kind: 'practice', icon: '🪔', label: 'PRACTICE', title: 'Monday Reflection', body: 'Illustrative hydration, reflection and family-oriented care.', bestDay: 'Monday', suggestedTime: 'Flexible', detailLabel: 'Example', detailValue: 'Reflection / care', purpose: 'Traditional routine centered on emotional steadiness.' }
  ],
  Mars: [
    { kind: 'puja', icon: '🛕', label: 'TEMPLE / PUJA', title: 'Mangal Shanti Puja', body: 'Illustrative Mars-focused shanti puja or Hanuman worship.', bestDay: 'Tuesday', suggestedTime: 'Morning', detailLabel: 'Example venue', detailValue: 'Navagraha Temple', purpose: 'Traditional focus on calm, discipline and constructive Mars energy.', futureAction: 'Book Puja · future' },
    { kind: 'mantra', icon: 'ॐ', label: 'MANTRA', title: 'Mangal / Hanuman Mantra', body: 'A traditional Tuesday mantra practice shown as conversational guidance.', bestDay: 'Tuesday', suggestedTime: 'Sunrise', detailLabel: 'Practice', detailValue: '108 repetitions', purpose: 'A reflective practice associated with courage, discipline and focus.' },
    { kind: 'gemstone', icon: '💎', label: 'GEMSTONE', title: 'Red Coral', body: 'Traditionally associated with Mars; suitability should be evaluated before use.', bestDay: 'Tuesday', suggestedTime: 'Daytime', detailLabel: 'Association', detailValue: 'Mars', purpose: 'Illustrative gemstone association only; suitability is not assumed.', futureAction: 'View Gemstone · future' },
    { kind: 'practice', icon: '🪔', label: 'PRACTICE', title: 'Tuesday Observance', body: 'Illustrative fasting, charity, or seva themes associated with Tuesday.', bestDay: 'Tuesday', suggestedTime: 'Flexible', detailLabel: 'Example', detailValue: 'Charity / seva', purpose: 'A simple reflective or service-oriented traditional practice.' }
  ],
  Mercury: [
    { kind: 'puja', icon: '🛕', label: 'TEMPLE / PUJA', title: 'Budha Puja', body: 'Illustrative Mercury-focused worship associated with learning and communication.', bestDay: 'Wednesday', suggestedTime: 'Morning', detailLabel: 'Example venue', detailValue: 'Vishnu / Navagraha temple', purpose: 'Traditional focus on learning, speech and analytical clarity.', futureAction: 'Book Puja · future' },
    { kind: 'mantra', icon: 'ॐ', label: 'MANTRA', title: 'Budha Mantra', body: 'A traditional Wednesday mantra practice associated with Mercury.', bestDay: 'Wednesday', suggestedTime: 'Morning', detailLabel: 'Practice', detailValue: '108 repetitions', purpose: 'Reflective focus on clarity, communication and study.' },
    { kind: 'gemstone', icon: '💎', label: 'GEMSTONE', title: 'Emerald', body: 'Traditionally associated with Mercury; suitability should be reviewed before use.', bestDay: 'Wednesday', suggestedTime: 'Daytime', detailLabel: 'Association', detailValue: 'Mercury', purpose: 'Illustrative gemstone association only.', futureAction: 'View Gemstone · future' },
    { kind: 'practice', icon: '🪔', label: 'PRACTICE', title: 'Wednesday Learning', body: 'Illustrative study, journaling, teaching or communication practice.', bestDay: 'Wednesday', suggestedTime: 'Flexible', detailLabel: 'Example', detailValue: 'Study / teaching', purpose: 'Traditional routine centered on learning and clear expression.' }
  ],
  Jupiter: [
    { kind: 'puja', icon: '🛕', label: 'TEMPLE / PUJA', title: 'Guru / Brihaspati Puja', body: 'Illustrative Jupiter-focused worship associated with wisdom and guidance.', bestDay: 'Thursday', suggestedTime: 'Morning', detailLabel: 'Example venue', detailValue: 'Vishnu / Guru temple', purpose: 'Traditional focus on learning, counsel, generosity and steady growth.', futureAction: 'Book Puja · future' },
    { kind: 'mantra', icon: 'ॐ', label: 'MANTRA', title: 'Guru Mantra', body: 'A traditional Thursday mantra practice associated with Jupiter.', bestDay: 'Thursday', suggestedTime: 'Morning', detailLabel: 'Practice', detailValue: '108 repetitions', purpose: 'A reflective practice centered on wisdom, clarity and growth.' },
    { kind: 'gemstone', icon: '💎', label: 'GEMSTONE', title: 'Yellow Sapphire', body: 'Traditionally associated with Jupiter; suitability should be reviewed before use.', bestDay: 'Thursday', suggestedTime: 'Daytime', detailLabel: 'Association', detailValue: 'Jupiter', purpose: 'Illustrative gemstone association for Jupiter; not a universal recommendation.', futureAction: 'View Gemstone · future' },
    { kind: 'practice', icon: '🪔', label: 'PRACTICE', title: 'Thursday Giving', body: 'Illustrative charity, teaching, mentoring or gratitude-oriented practice.', bestDay: 'Thursday', suggestedTime: 'Flexible', detailLabel: 'Example', detailValue: 'Education / food donation', purpose: 'A traditional service-oriented practice emphasizing generosity and learning.' }
  ],
  Venus: [
    { kind: 'puja', icon: '🛕', label: 'TEMPLE / PUJA', title: 'Shukra Puja', body: 'Illustrative Venus-focused worship associated with harmony and aesthetics.', bestDay: 'Friday', suggestedTime: 'Morning', detailLabel: 'Example venue', detailValue: 'Lakshmi / Shukra temple', purpose: 'Traditional focus on harmony, relationships and refinement.', futureAction: 'Book Puja · future' },
    { kind: 'mantra', icon: 'ॐ', label: 'MANTRA', title: 'Shukra Mantra', body: 'A traditional Friday mantra practice associated with Venus.', bestDay: 'Friday', suggestedTime: 'Morning', detailLabel: 'Practice', detailValue: '108 repetitions', purpose: 'Reflective focus on harmony and appreciation.' },
    { kind: 'gemstone', icon: '💎', label: 'GEMSTONE', title: 'Diamond / White Sapphire', body: 'Traditional Venus gemstone associations; suitability should be reviewed before use.', bestDay: 'Friday', suggestedTime: 'Daytime', detailLabel: 'Association', detailValue: 'Venus', purpose: 'Illustrative gemstone association only.', futureAction: 'View Gemstone · future' },
    { kind: 'practice', icon: '🪔', label: 'PRACTICE', title: 'Friday Harmony Practice', body: 'Illustrative beauty, gratitude, relationship-care or charity themes.', bestDay: 'Friday', suggestedTime: 'Flexible', detailLabel: 'Example', detailValue: 'Gratitude / care', purpose: 'Traditional routine centered on harmony and refinement.' }
  ],
  Saturn: [
    { kind: 'puja', icon: '🛕', label: 'TEMPLE / PUJA', title: 'Shani Shanti Puja', body: 'Illustrative Saturn-focused worship or temple offering.', bestDay: 'Saturday', suggestedTime: 'Sunrise', detailLabel: 'Example venue', detailValue: 'Shani Temple', purpose: 'Traditional focus on patience, responsibility and steady progress.', futureAction: 'Book Puja · future' },
    { kind: 'mantra', icon: 'ॐ', label: 'MANTRA', title: 'Shani Mantra', body: 'A traditional Saturday mantra practice for reflective discipline.', bestDay: 'Saturday', suggestedTime: 'Morning', detailLabel: 'Practice', detailValue: '108 repetitions', purpose: 'A reflective practice centered on steadiness and discipline.' },
    { kind: 'gemstone', icon: '💎', label: 'GEMSTONE', title: 'Blue Sapphire', body: 'A strong traditional Saturn association; show only as an illustrative option.', bestDay: 'Saturday', suggestedTime: 'Daytime', detailLabel: 'Association', detailValue: 'Saturn', purpose: 'Illustrative gemstone association; suitability should be reviewed before use.', futureAction: 'View Gemstone · future' },
    { kind: 'practice', icon: '🪔', label: 'PRACTICE', title: 'Saturday Charity', body: 'Illustrative service, donation, and disciplined routine themes.', bestDay: 'Saturday', suggestedTime: 'Flexible', detailLabel: 'Example', detailValue: 'Food / essential donation', purpose: 'A service-oriented practice emphasizing humility and consistency.' }
  ],
  Rahu: [
    { kind: 'puja', icon: '🛕', label: 'TEMPLE / PUJA', title: 'Rahu Shanti', body: 'Illustrative graha-shanti worship associated with Rahu.', bestDay: 'Saturday', suggestedTime: 'Morning', detailLabel: 'Example venue', detailValue: 'Navagraha Temple', purpose: 'Traditional grounding and clarity themes.', futureAction: 'Book Puja · future' },
    { kind: 'mantra', icon: 'ॐ', label: 'MANTRA', title: 'Rahu Mantra', body: 'A traditional mantra option presented for demonstration.', bestDay: 'Saturday', suggestedTime: 'Morning', detailLabel: 'Practice', detailValue: '108 repetitions', purpose: 'A reflective traditional practice associated with grounding.' },
    { kind: 'gemstone', icon: '💎', label: 'GEMSTONE', title: 'Hessonite', body: 'Traditionally associated with Rahu; not a universal recommendation.', bestDay: 'Saturday', suggestedTime: 'Daytime', detailLabel: 'Association', detailValue: 'Rahu', purpose: 'Illustrative gemstone association only.', futureAction: 'View Gemstone · future' },
    { kind: 'practice', icon: '🪔', label: 'PRACTICE', title: 'Grounding Practice', body: 'Illustrative charity and reflective routine suggestions.', bestDay: 'Saturday', suggestedTime: 'Flexible', detailLabel: 'Example', detailValue: 'Service / reflection', purpose: 'A calm, grounded routine presented as traditional guidance.' }
  ],
  Ketu: [
    { kind: 'puja', icon: '🛕', label: 'TEMPLE / PUJA', title: 'Ketu Shanti', body: 'Illustrative graha-shanti worship associated with Ketu.', bestDay: 'Tuesday', suggestedTime: 'Morning', detailLabel: 'Example venue', detailValue: 'Navagraha Temple', purpose: 'Traditional focus on reflection and detachment.', futureAction: 'Book Puja · future' },
    { kind: 'mantra', icon: 'ॐ', label: 'MANTRA', title: 'Ketu Mantra', body: 'A traditional mantra practice shown as a demo option.', bestDay: 'Tuesday', suggestedTime: 'Morning', detailLabel: 'Practice', detailValue: '108 repetitions', purpose: 'A reflective practice associated with simplicity and inward focus.' },
    { kind: 'gemstone', icon: '💎', label: 'GEMSTONE', title: "Cat's Eye", body: 'Traditionally associated with Ketu; suitability should be evaluated.', bestDay: 'Tuesday', suggestedTime: 'Daytime', detailLabel: 'Association', detailValue: 'Ketu', purpose: 'Illustrative gemstone association only.', futureAction: 'View Gemstone · future' },
    { kind: 'practice', icon: '🪔', label: 'PRACTICE', title: 'Reflective Seva', body: 'Illustrative service and simplicity-oriented practices.', bestDay: 'Tuesday', suggestedTime: 'Flexible', detailLabel: 'Example', detailValue: 'Simple seva', purpose: 'A traditional service-oriented practice emphasizing simplicity.' }
  ]
};

const doshaGuidanceLibrary: Record<string, GuidanceCard[]> = {
  mangal: guidanceLibrary.Mars,
  kaal_sarp: [
    { kind: 'puja', icon: '🛕', label: 'TEMPLE / PUJA', title: 'Rahu–Ketu Shanti Puja', body: 'Illustrative traditional Rahu–Ketu-focused shanti worship.', bestDay: 'Saturday', suggestedTime: 'Morning', detailLabel: 'Example venue', detailValue: 'Navagraha temple', purpose: 'Traditional focus on grounding, clarity and balance.', futureAction: 'Book Puja · future' },
    { kind: 'mantra', icon: 'ॐ', label: 'MANTRA', title: 'Rahu–Ketu Mantra', body: 'Illustrative mantra practice associated with the lunar nodes.', bestDay: 'Saturday', suggestedTime: 'Morning', detailLabel: 'Practice', detailValue: '108 repetitions', purpose: 'Reflective grounding practice.' },
    { kind: 'gemstone', icon: '💎', label: 'GEMSTONE', title: 'Hessonite / Cat’s Eye', body: 'Traditional node-linked gemstone associations; never assume suitability.', bestDay: 'Traditional day', suggestedTime: 'Daytime', detailLabel: 'Association', detailValue: 'Rahu / Ketu', purpose: 'Illustrative gemstone associations only.', futureAction: 'View Gemstone · future' },
    { kind: 'practice', icon: '🪔', label: 'PRACTICE', title: 'Grounding & Charity', body: 'Illustrative service, disciplined routine and reflective practice.', bestDay: 'Saturday', suggestedTime: 'Flexible', detailLabel: 'Example', detailValue: 'Charity / seva', purpose: 'Traditional grounding-oriented routine.' }
  ],
  pitru: [
    { kind: 'puja', icon: '🛕', label: 'TEMPLE / PUJA', title: 'Pitru Tarpan / Shraddha', body: 'Illustrative ancestral remembrance and traditional offering practice.', bestDay: 'Amavasya / tradition', suggestedTime: 'Morning', detailLabel: 'Example', detailValue: 'Tarpan / ancestral rite', purpose: 'Traditional remembrance, gratitude and family lineage reflection.', futureAction: 'Book Puja · future' },
    { kind: 'mantra', icon: 'ॐ', label: 'MANTRA', title: 'Pitru Shanti Prayer', body: 'Illustrative ancestral remembrance mantra/prayer.', bestDay: 'Traditional day', suggestedTime: 'Morning', detailLabel: 'Practice', detailValue: 'Prayer / remembrance', purpose: 'Reflective gratitude toward ancestors.' },
    { kind: 'gemstone', icon: '💎', label: 'GEMSTONE', title: 'No default gemstone', body: 'This prototype does not auto-recommend a gemstone for Pitru Dosha.', bestDay: '—', suggestedTime: '—', detailLabel: 'Association', detailValue: 'Context-specific', purpose: 'Avoid universal gemstone claims for this condition.' },
    { kind: 'practice', icon: '🪔', label: 'PRACTICE', title: 'Ancestral Charity', body: 'Illustrative food donation, gratitude and remembrance practices.', bestDay: 'Traditional day', suggestedTime: 'Flexible', detailLabel: 'Example', detailValue: 'Food donation', purpose: 'Traditional remembrance and service themes.' }
  ],
  guru_chandal: [
    { kind: 'puja', icon: '🛕', label: 'TEMPLE / PUJA', title: 'Guru–Rahu Shanti', body: 'Illustrative Jupiter–Rahu-focused traditional worship.', bestDay: 'Thursday', suggestedTime: 'Morning', detailLabel: 'Example venue', detailValue: 'Guru / Navagraha temple', purpose: 'Traditional focus on discernment, learning and grounding.', futureAction: 'Book Puja · future' },
    { kind: 'mantra', icon: 'ॐ', label: 'MANTRA', title: 'Guru Mantra', body: 'Illustrative Jupiter-focused mantra practice.', bestDay: 'Thursday', suggestedTime: 'Morning', detailLabel: 'Practice', detailValue: '108 repetitions', purpose: 'Reflective focus on wisdom and discernment.' },
    { kind: 'gemstone', icon: '💎', label: 'GEMSTONE', title: 'Yellow Sapphire', body: 'Traditional Jupiter association; suitability should be reviewed before use.', bestDay: 'Thursday', suggestedTime: 'Daytime', detailLabel: 'Association', detailValue: 'Jupiter', purpose: 'Illustrative gemstone association only.', futureAction: 'View Gemstone · future' },
    { kind: 'practice', icon: '🪔', label: 'PRACTICE', title: 'Thursday Learning & Giving', body: 'Illustrative teaching, mentoring and charity practice.', bestDay: 'Thursday', suggestedTime: 'Flexible', detailLabel: 'Example', detailValue: 'Education / charity', purpose: 'Traditional wisdom and service themes.' }
  ],
  shani: guidanceLibrary.Saturn,
  grahan: [
    { kind: 'puja', icon: '🛕', label: 'TEMPLE / PUJA', title: 'Surya / Chandra Grahan Shanti', body: 'Illustrative luminary and node-focused shanti worship.', bestDay: 'Traditional timing', suggestedTime: 'As advised', detailLabel: 'Example venue', detailValue: 'Navagraha temple', purpose: 'Traditional focus on clarity and steadiness.', futureAction: 'Book Puja · future' },
    { kind: 'mantra', icon: 'ॐ', label: 'MANTRA', title: 'Surya / Chandra Mantra', body: 'Illustrative mantra selected according to the luminary involved.', bestDay: 'Traditional timing', suggestedTime: 'As advised', detailLabel: 'Practice', detailValue: '108 repetitions', purpose: 'Reflective clarity and grounding.' },
    { kind: 'gemstone', icon: '💎', label: 'GEMSTONE', title: 'No automatic gemstone', body: 'Gemstone choice depends on the full chart and is not auto-assigned.', bestDay: '—', suggestedTime: '—', detailLabel: 'Association', detailValue: 'Chart-dependent', purpose: 'Avoid universal gemstone recommendations.' },
    { kind: 'practice', icon: '🪔', label: 'PRACTICE', title: 'Meditation & Charity', body: 'Illustrative reflection, restraint and charity-oriented practice.', bestDay: 'Traditional timing', suggestedTime: 'Flexible', detailLabel: 'Example', detailValue: 'Reflection / donation', purpose: 'Traditional grounding-oriented routine.' }
  ],
  nadi: [
    { kind: 'puja', icon: '🛕', label: 'TEMPLE / PUJA', title: 'Nadi Shanti / Compatibility Guidance', body: 'Illustrative traditional compatibility-focused guidance; no universal ritual is assumed.', bestDay: 'As advised', suggestedTime: 'Flexible', detailLabel: 'Context', detailValue: 'Compatibility review', purpose: 'Traditional compatibility and family discussion context.', futureAction: 'Book Consultation · future' },
    { kind: 'mantra', icon: 'ॐ', label: 'MANTRA', title: 'General Shanti Mantra', body: 'Illustrative calming prayer/mantra when requested.', bestDay: 'Flexible', suggestedTime: 'Morning', detailLabel: 'Practice', detailValue: 'Prayer / reflection', purpose: 'Reflective, non-diagnostic guidance.' },
    { kind: 'gemstone', icon: '💎', label: 'GEMSTONE', title: 'No default gemstone', body: 'Nadi Dosha is not mapped to a default gemstone in this prototype.', bestDay: '—', suggestedTime: '—', detailLabel: 'Association', detailValue: 'None by default', purpose: 'Avoid unsupported gemstone claims.' },
    { kind: 'practice', icon: '🪔', label: 'PRACTICE', title: 'Compatibility Discussion', body: 'Illustrative family discussion, reflection and consultation practice.', bestDay: 'Flexible', suggestedTime: 'Flexible', detailLabel: 'Example', detailValue: 'Consultation / reflection', purpose: 'Traditional compatibility context without deterministic claims.' }
  ]
};

function cardsFor(planet: string, gemstoneName?: string, doshaKey?: string): GuidanceCard[] {
  const base = doshaKey && doshaGuidanceLibrary[doshaKey]
    ? doshaGuidanceLibrary[doshaKey]
    : guidanceLibrary[planet] ?? guidanceLibrary.Jupiter;

  if (!gemstoneName) return base;
  return base.map(card => card.kind === 'gemstone'
    ? { ...card, title: gemstoneName, body: `Jyotishi mentioned ${gemstoneName} in the current guidance. This remains an illustrative traditional association and suitability should be reviewed before use.` }
    : card);
}

function gemstoneVisualClass(title: string) {
  const key = title.toLowerCase();
  if (key.includes('yellow sapphire')) return 'gem-yellow-sapphire';
  if (key.includes('white sapphire')) return 'gem-white-sapphire';
  if (key.includes('blue sapphire')) return 'gem-blue-sapphire';
  if (key.includes('red coral') || key === 'coral') return 'gem-red-coral';
  if (key.includes('emerald')) return 'gem-emerald';
  if (key.includes('ruby')) return 'gem-ruby';
  if (key.includes('pearl')) return 'gem-pearl';
  if (key.includes('diamond')) return 'gem-diamond';
  if (key.includes('hessonite')) return 'gem-hessonite';
  if (key.includes("cat's eye") || key.includes('cats eye')) return 'gem-catseye';
  if (key === 'sapphire') return 'gem-sapphire';
  return 'gem-generic';
}

const guidanceVisuals: Record<string, {
  accent: string;
  glow: string;
  symbol: string;
  motion: string;
  puja: { offering: string; secondary: string; motif: string };
  mantra: { beads: string; syllable: string };
  practice: { icon: string; label: string };
}> = {
  General: { accent: '#efc36a', glow: 'rgba(239,195,106,.34)', symbol: 'ॐ', motion: '14s', puja: { offering: '', secondary: '', motif: 'AUSPICIOUS BEGINNING' }, mantra: { beads: '', syllable: 'ॐ' }, practice: { icon: '✦', label: 'Mindful preparation' } },
  Sun: { accent: '#ffb43b', glow: 'rgba(255,180,59,.34)', symbol: '☉', motion: '9s', puja: { offering: 'lotus', secondary: 'water', motif: 'SUNRISE · ARGHYA' }, mantra: { beads: 'rudraksha', syllable: 'ॐ' }, practice: { icon: '🌅', label: 'Sunrise reflection' } },
  Moon: { accent: '#d9e7ff', glow: 'rgba(217,231,255,.32)', symbol: '☾', motion: '18s', puja: { offering: 'white lotus', secondary: 'silver vessel', motif: 'MOONLIGHT · WATER' }, mantra: { beads: 'pearl', syllable: 'ॐ' }, practice: { icon: '🌙', label: 'Quiet reflection' } },
  Mars: { accent: '#ff6f5b', glow: 'rgba(255,111,91,.34)', symbol: '♂', motion: '8s', puja: { offering: 'hibiscus', secondary: 'red sandal', motif: 'FIRE · COURAGE' }, mantra: { beads: 'red sandalwood', syllable: 'ॐ' }, practice: { icon: '🔥', label: 'Discipline & service' } },
  Mercury: { accent: '#67d89a', glow: 'rgba(103,216,154,.34)', symbol: '☿', motion: '11s', puja: { offering: 'sacred leaves', secondary: 'green gram', motif: 'LEARNING · SPEECH' }, mantra: { beads: 'green onyx', syllable: 'ॐ' }, practice: { icon: '📚', label: 'Study & clear speech' } },
  Jupiter: { accent: '#f1c85a', glow: 'rgba(241,200,90,.34)', symbol: '♃', motion: '15s', puja: { offering: 'yellow flowers', secondary: 'turmeric', motif: 'WISDOM · GURU' }, mantra: { beads: 'tulsi', syllable: 'ॐ' }, practice: { icon: '🪔', label: 'Teaching & giving' } },
  Venus: { accent: '#f4a7d7', glow: 'rgba(244,167,215,.34)', symbol: '♀', motion: '17s', puja: { offering: 'pink lotus', secondary: 'fragrance', motif: 'HARMONY · BEAUTY' }, mantra: { beads: 'rose quartz', syllable: 'ॐ' }, practice: { icon: '🌺', label: 'Harmony & gratitude' } },
  Saturn: { accent: '#7f9cff', glow: 'rgba(127,156,255,.34)', symbol: '♄', motion: '24s', puja: { offering: 'sesame', secondary: 'oil lamp', motif: 'SERVICE · PATIENCE' }, mantra: { beads: 'black onyx', syllable: 'ॐ' }, practice: { icon: '🤲', label: 'Service & consistency' } },
  Rahu: { accent: '#b88ae8', glow: 'rgba(184,138,232,.34)', symbol: '☊', motion: '13s', puja: { offering: 'durva grass', secondary: 'incense', motif: 'ECLIPSE · GROUNDING' }, mantra: { beads: 'hessonite', syllable: 'ॐ' }, practice: { icon: '🧘', label: 'Grounding & restraint' } },
  Ketu: { accent: '#83d3bf', glow: 'rgba(131,211,191,.34)', symbol: '☋', motion: '20s', puja: { offering: 'white flowers', secondary: 'flag', motif: 'STILLNESS · RELEASE' }, mantra: { beads: 'cat eye', syllable: 'ॐ' }, practice: { icon: '🏔️', label: 'Meditation & simplicity' } }
};

function visualForPlanet(planet: string) {
  return guidanceVisuals[planet] ?? guidanceVisuals.General;
}

function GuidanceVisual({ card, planet }: { card: GuidanceCard; planet: string }) {
  const visual = visualForPlanet(planet);
  const style = {
    '--guidance-accent': visual.accent,
    '--guidance-glow': visual.glow,
    '--guidance-motion': visual.motion
  } as CSSProperties;
  const planetClass = `guidance-${planet.toLowerCase().replace(/[^a-z]+/g, '-')}`;

  if (card.kind === 'puja') {
    return <div className={`remedy-visual remedy-visual-puja planet-guidance-visual ${planetClass}`} style={style} aria-label={`${card.title} animated ritual illustration`}>
      <svg className="ritual-scene" viewBox="0 0 420 280" role="img" aria-hidden="true">
        <defs>
          <radialGradient id={`pujaHalo-${planet}`}><stop stopColor={visual.accent} stopOpacity=".62"/><stop offset="1" stopColor={visual.accent} stopOpacity="0"/></radialGradient>
          <linearGradient id={`pujaStone-${planet}`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#8d6748"/><stop offset="1" stopColor="#281821"/></linearGradient>
          <filter id={`pujaGlow-${planet}`}><feGaussianBlur stdDeviation="5"/></filter>
        </defs>
        <rect width="420" height="280" fill="#090611"/>
        <circle className="shrine-halo" cx="210" cy="102" r="94" fill={`url(#pujaHalo-${planet})`}/>
        <ellipse className="diorama-orbit orbit-far" cx="210" cy="178" rx="151" ry="38"/>
        <ellipse className="diorama-orbit orbit-near" cx="210" cy="178" rx="116" ry="25"/>
        <path className="shrine-arch" d="M92 204V88Q92 30 140 24H280Q328 30 328 88V204"/>
        <path className="shrine-inner" d="M124 199V94Q124 58 157 53H263Q296 58 296 94V199"/>
        <path className="shrine-canopy" d="M70 63L210 10 350 63 332 77H88Z"/>
        <path className="shrine-trim" d="M105 53H315M126 43H294"/>
        <circle className="ritual-mandala" cx="210" cy="112" r="57"/>
        <circle className="ritual-mandala inner" cx="210" cy="112" r="43"/>
        <text className="ritual-symbol-svg" x="210" y="132" textAnchor="middle">{visual.symbol}</text>
        <path className="altar-top" d="M76 202Q210 182 344 202L330 222H90Z" fill={`url(#pujaStone-${planet})`}/>
        <path className="altar-base floating-island" d="M94 221H326L344 239Q315 271 210 276Q105 271 76 239Z" fill="#21131b"/>
        <g className="flower-bed" fill={visual.accent}>
          {Array.from({length: 11}).map((_, i) => <circle key={i} cx={112 + i * 20} cy={213 + (i % 2) * 5} r="6" opacity={.5 + (i % 3) * .18}/>) }
        </g>
        {[112,308].map((x, i) => <g className={`ritual-lamp lamp-${i}`} key={x}>
          <path d={`M${x-13} 194Q${x} 205 ${x+13} 194Q${x+8} 211 ${x} 213Q${x-8} 211 ${x-13} 194Z`} fill="#b77935"/>
          <path className="svg-flame-outer" d={`M${x} 195C${x-12} 182 ${x+2} 171 ${x} 158C${x+16} 176 ${x+9} 189 ${x} 195Z`} fill="#ffad32"/>
          <path className="svg-flame-inner" d={`M${x} 192C${x-5} 184 ${x+1} 179 ${x} 173C${x+7} 182 ${x+3} 189 ${x} 192Z`} fill="#fff2a8"/>
        </g>)}
        {[142,278].map((x, i) => <g className={`incense incense-${i}`} key={x}>
          <path d={`M${x} 203L${x+4} 151`} stroke="#d7a760" strokeWidth="2"/>
          <path className="svg-smoke" d={`M${x+4} 151C${x-9} 137 ${x+17} 126 ${x+1} 110C${x-10} 99 ${x+13} 88 ${x+5} 73`} fill="none" stroke={visual.accent} strokeOpacity=".45" strokeWidth="3"/>
        </g>)}
        <g className="ritual-vessels" fill="none" stroke={visual.accent} strokeWidth="2">
          <path d="M172 201Q172 177 185 168Q198 177 198 201Z"/><path d="M178 168H192L189 159H181Z"/>
          <path d="M222 201Q222 180 235 172Q248 180 248 201Z"/><path d="M227 172H243"/>
        </g>
        <g className="ritual-sparks" fill={visual.accent}>{Array.from({length: 12}).map((_,i)=><circle key={i} cx={40+(i*31)%350} cy={34+(i*47)%145} r={i%3===0?2:1} style={{animationDelay:`${i*.31}s`}}/>)}</g>
      </svg>
      <div className="ritual-motif">{visual.puja.motif}</div>
      <div className="visual-caption"><span>PLANET-SPECIFIC PUJA VISUAL</span><strong>{card.title}</strong></div>
    </div>;
  }

  if (card.kind === 'gemstone') {
    return <div className={`remedy-visual remedy-visual-gemstone ${gemstoneVisualClass(card.title)} gemstone-${planet.toLowerCase()} planet-guidance-visual ${planetClass}`} style={style}>
      <div className="gem-planet-symbol">{visual.symbol}</div>
      <div className="gem-orbit orbit-one"/><div className="gem-orbit orbit-two"/><div className="gem-shine"/>
      <div className="gem-sparkles">{Array.from({ length: 6 }).map((_, i) => <i key={i} style={{ animationDelay: `${i * .7}s` }} />)}</div>
      <div className="gemstone-model"><span className="gem-facet gem-facet-a"/><span className="gem-facet gem-facet-b"/><span className="gem-facet gem-facet-c"/><span className="gem-core"/></div>
      <div className="visual-caption"><span>{planet.toUpperCase()} · TRADITIONAL GEMSTONE</span><strong>{card.title}</strong></div>
    </div>;
  }

  if (card.kind === 'mantra') {
    return <div className={`remedy-visual remedy-visual-mantra planet-guidance-visual ${planetClass}`} style={style}>
      <div className="mantra-planet-symbol">{visual.symbol}</div>
      <div className="mantra-ring ring-a"/><div className="mantra-ring ring-b"/>
      <div className="mantra-om">{visual.mantra.syllable}</div>
      <svg className="mala-infinity" viewBox="0 0 320 190" aria-hidden="true">
        <path className="mala-thread" d="M28 95C65 28 121 28 160 95C199 162 255 162 292 95C255 28 199 28 160 95C121 162 65 162 28 95Z"/>
        {Array.from({length: 28}).map((_,i)=>{
          const t=(i/28)*Math.PI*2; const x=160+126*Math.sin(t); const y=95+55*Math.sin(t)*Math.cos(t);
          return <circle className="mala-bead-svg" key={i} cx={x} cy={y} r={i%7===0?7:5} style={{'--bead-index':i} as CSSProperties}/>;
        })}
      </svg>
      <div className="mantra-material">{visual.mantra.beads}</div>
      <div className="mantra-wave">{Array.from({ length: 24 }).map((_, i) => <i key={i} style={{ animationDelay: `${i * 45}ms` }} />)}</div>
      <div className="visual-caption"><span>{planet.toUpperCase()} · MANTRA PRACTICE</span><strong>{card.title}</strong></div>
    </div>;
  }

  return <div className="remedy-visual remedy-visual-practice planet-guidance-visual" style={style}>
    <div className="practice-day">{card.bestDay?.slice(0, 3).toUpperCase()}</div>
    <div className="practice-planet-symbol">{visual.symbol}</div>
    <div className="practice-landscape"><span className="practice-icon">{visual.practice.icon}</span><span className="practice-path"/></div>
    <div className="practice-halo"/><div className="practice-breath breath-a"/><div className="practice-breath breath-b"/>
    <div className="practice-copy">{visual.practice.label}</div>
    <div className="visual-caption"><span>{planet.toUpperCase()} · TRADITIONAL PRACTICE</span><strong>{card.title}</strong></div>
  </div>;
}

function GuidanceExperience({ guidance }: { guidance: KundliGuidance }) {
  const cards = useMemo(() => cardsFor(guidance.planet, guidance.gemstoneName, guidance.doshaKey), [guidance.planet, guidance.gemstoneName]);
  const initial = guidance.activeKind ?? cards[0]?.kind ?? 'puja';
  const [selectedKind, setSelectedKind] = useState<GuidanceKind>(initial);

  useEffect(() => {
    if (guidance.activeKind) setSelectedKind(guidance.activeKind);
    else setSelectedKind(cards[0]?.kind ?? 'puja');
  }, [guidance.activeKind, guidance.planet, cards]);

  const selected = cards.find(card => card.kind === selectedKind) ?? cards[0];
  if (!selected) return null;

  return <>
    <div className="guidance-experience">
      <div className="guidance-kind-rail" aria-label="Traditional guidance categories">
        {cards.map(card => <button key={card.kind} className={`guidance-kind-tab ${selected.kind === card.kind ? 'active' : ''}`} onClick={() => setSelectedKind(card.kind)} type="button">
          <span>{card.icon}</span><small>{card.label.replace('TEMPLE / ', '')}</small>
        </button>)}
      </div>
      <GuidanceVisual card={selected} planet={guidance.planet} />
      <div className="guidance-detail">
        <div className="guidance-detail-label">{selected.label}</div>
        <h4>{selected.title}</h4>
        <p>{selected.body}</p>
        <div className="guidance-detail-grid">
          <div><span>BEST DAY</span><strong>{selected.bestDay ?? 'Traditional day'}</strong></div>
          <div><span>SUGGESTED TIME</span><strong>{selected.suggestedTime ?? 'Flexible'}</strong></div>
          <div><span>{selected.detailLabel ?? 'CONTEXT'}</span><strong>{selected.detailValue ?? guidance.topic ?? guidance.planet}</strong></div>
          <div><span>PURPOSE</span><strong>{selected.purpose ?? 'Traditional reflective guidance'}</strong></div>
        </div>
        {selected.futureAction && <button type="button" className="future-commerce-btn" disabled title="Future commerce / booking integration">{selected.futureAction}</button>}
      </div>
    </div>
    <div className="guidance-overview">
      {cards.map(card => <button key={card.kind} type="button" className={`guidance-overview-card ${selected.kind === card.kind ? 'active' : ''}`} onClick={() => setSelectedKind(card.kind)}>
        <div className={`guidance-overview-visual overview-${card.kind}`}>{card.icon}</div>
        <div><span>{card.label}</span><strong>{card.title}</strong><small>{card.body}</small></div>
      </button>)}
    </div>
  </>;
}

export function KundliScene({ chart, profile, focusPlanets = [], guidance, onNext }: { chart: ChartData; profile?: Partial<BirthProfile>; focusPlanets?: string[]; guidance?: KundliGuidance; onNext: () => void }) {
  const active = new Set(focusPlanets.map(name => name.toLowerCase()));
  const dateTime = [profile?.date, profile?.time].filter(Boolean).join(' · ');
  // House 1 is the Lagna sign; every other house follows in zodiacal order from it.
  const lagnaIndex = Math.max(0, ZODIAC.indexOf(chart.lagna));
  return (
    <div className="scene-wrap kundli-scene">
      <div className="scene-copy"><div className="eyebrow">CHAPTER 03 · COSMOS → KUNDLI</div><h2>Your sky, translated into a Vedic map.</h2><p>All nine illustrative Navagraha placements remain visible. Jyotishi can move from chart interpretation into synchronized traditional guidance.</p>
        <div className="kundli-profile-chips">
          {profile?.name && <span>✦ {profile.name}</span>}
          {profile?.place && <span>⌖ {profile.place}</span>}
          {dateTime && <span>◷ {dateTime}</span>}
          <span className="kundli-context-chip">ⓘ Illustrative Vedic chart</span>
        </div>
      </div>
      <div className={`kundli-layout ${guidance?.mode === 'remedies' ? 'with-guidance-experience' : ''}`}>
        <div className="kundli-board glass-panel">
          <svg viewBox="0 0 400 400" aria-label="Illustrative Kundli chart">
            <rect x="8" y="8" width="384" height="384" rx="14" fill="rgba(13,10,26,.35)" stroke="#8067a4" strokeWidth="2" />
            <line x1="8" y1="8" x2="392" y2="392" stroke="#624d83"/><line x1="392" y1="8" x2="8" y2="392" stroke="#624d83"/>
            <line x1="200" y1="8" x2="8" y2="200" stroke="#624d83"/><line x1="200" y1="8" x2="392" y2="200" stroke="#624d83"/>
            <line x1="8" y1="200" x2="200" y2="392" stroke="#624d83"/><line x1="392" y1="200" x2="200" y2="392" stroke="#624d83"/>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(house => {
              // House 1 carries the Lagna sign; each subsequent house is the next sign.
              const signIndex = (lagnaIndex + house - 1) % 12;
              const [labelX, labelY] = HOUSE_SIGN_LABEL[house];
              const [cx, cy] = HOUSE_CENTERS[house];
              const occupants = chart.planets.filter(p => p.house === house);

              // Compress the stack as a house fills up, and clamp it to the room the
              // compartment actually has so even a stellium stays inside its box.
              const { band, bias } = HOUSE_STACK[house];
              const count = occupants.length;
              const preferred = count >= 5 ? 13 : count === 4 ? 16 : count === 3 ? 19 : 22;
              const spacing = count > 1 ? Math.min(preferred, (2 * band) / (count - 1)) : 0;
              const glyphSize = count >= 5 ? 11 : count === 4 ? 12 : count === 3 ? 14 : 16;
              const labelSize = count >= 5 ? 8 : count === 4 ? 8.5 : count === 3 ? 9.5 : 10.5;
              const highlightWidth = count >= 4 ? 44 : 58;
              const top = cy + bias - ((count - 1) * spacing) / 2;

              return (
                <g key={house}>
                  <text x={labelX} y={labelY} textAnchor="middle" fill="rgba(198,178,228,.55)" fontSize="10" fontWeight="600">
                    <title>{`House ${house} · ${ZODIAC[signIndex]}`}</title>
                    {signIndex + 1}
                  </text>
                  {house === 1 && <text x={labelX} y={labelY + 12} textAnchor="middle" fill="rgba(243,212,139,.75)" fontSize="8" fontWeight="700">La</text>}

                  {occupants.map((p, index) => {
                    const y = top + index * spacing;
                    const guidanceMatches = !focusPlanets.length && guidance?.planet.toLowerCase() === p.name.toLowerCase();
                    const selected = active.has(p.name.toLowerCase()) || guidanceMatches;
                    return (
                      <g key={p.name} className={selected ? 'kundli-planet-active' : ''}>
                        {selected && <rect x={cx - highlightWidth / 2} y={y - glyphSize} width={highlightWidth} height={glyphSize + 8} rx="7"
                          fill="rgba(243,212,139,.18)" stroke="#f3d48b" strokeWidth="1.5" />}
                        <text x={cx} y={y} textAnchor="middle" fill={selected ? '#ffd977' : '#d5c5e8'} fontSize={glyphSize} fontWeight="700">
                          <title>{`${p.name} · ${p.sign} · House ${p.house} · ${p.degree}${p.strength === 'Retrograde' ? ' (retrograde)' : ''}`}</title>
                          {planetGlyphs[p.name] ?? '✦'}
                          <tspan fontSize={labelSize} dx="3" fill={selected ? '#ffe6a7' : '#c5b7db'}>
                            {PLANET_SHORT[p.name] ?? p.name}{p.strength === 'Retrograde' ? '℞' : ''}
                          </tspan>
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
          <div className="kundli-chart-key"><strong>Chart key</strong><span>Small numbers = zodiac signs</span><span>Planet houses = cards below</span></div>
          <div className="kundli-element-legend">{elementLegend.map(([name, icon]) => <span key={name}><i>{icon}</i>{name}</span>)}</div>
        </div>
        {!guidance ? (
          <div className="chart-summary glass-panel"><div className="eyebrow">CHART SNAPSHOT</div><div className="metric"><span>Lagna</span><strong>{chart.lagna}</strong></div><div className="metric"><span>Moon Sign</span><strong>{chart.moonSign}</strong></div><div className="metric"><span>Nakshatra</span><strong>{chart.nakshatra}</strong></div><div className="metric"><span>Current Dasha</span><strong>{chart.dasha}</strong></div><div className="chart-note">{focusPlanets.length ? `${focusPlanets.join(' and ')} ${focusPlanets.length > 1 ? 'are' : 'is'} currently in focus because Jyotishi is discussing ${focusPlanets.length > 1 ? 'them' : 'it'}.` : 'Ask Jyotishi about any planet; the matching placement will highlight here.'}</div></div>
        ) : (
          <div className="jyotishi-guidance glass-panel" aria-live="polite">
            <div className="guidance-head">
              <div><div className="eyebrow">JYOTISHI GUIDANCE</div><h3>{guidance.title}</h3></div>
              <div className="guidance-planet">{guidance.planet}</div>
            </div>
            <p className="guidance-subtitle">{guidance.subtitle}</p>
            {guidance.mode === 'not_indicated' ? (
              <div className="guidance-assessment guidance-assessment-clear">
                <div className="assessment-icon">✓</div>
                <div><span>ASSESSMENT RESULT</span><strong>Not indicated</strong><p>{guidance.assessmentText}</p></div>
              </div>
            ) : guidance.mode === 'assessment' ? (
              <div className="guidance-assessment">
                <div className="assessment-icon">⌛</div>
                <div><span>ASSESSING CHART</span><strong>{guidance.assessmentLabel ?? 'Checking the Kundli'}</strong><p>{guidance.assessmentText}</p></div>
              </div>
            ) : (
              <GuidanceExperience guidance={guidance} />
            )}
            <div className="guidance-disclaimer">Traditional astrology-style guidance for this prototype. Remedy suggestions are shown only when the conversational assessment supports them; they are illustrative and are not guarantees or medical advice.</div>
          </div>
        )}
      </div>
      <div className="kundli-glance glass-panel">
        <div className="kundli-glance-title">NAVAGRAHA AT A GLANCE</div>
        <div className="kundli-glance-grid">
          {chart.planets.map(p => {
            const selected = active.has(p.name.toLowerCase());
            return <div key={p.name} className={`kundli-glance-card ${selected ? 'active' : ''}`}>
              <span className="kundli-glance-glyph">{planetGlyphs[p.name] ?? '✦'}</span>
              <strong>{p.name}</strong><small>{p.sign}</small><small>House {p.house}</small><small>{p.degree}</small>
            </div>;
          })}
        </div>
      </div>
      <button className="primary-btn scene-next kundli-next" onClick={onNext}>Continue to Your Cosmic Imprint →</button>
    </div>
  );
}
