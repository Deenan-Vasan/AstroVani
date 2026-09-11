import { useMemo, useState } from 'react';
import type { BirthProfile, ChartData } from '../types';

/*
 * The Cosmic Thread used to be entirely hardcoded: a fixed node list
 * ['Birth','Mars','Rahu','Jupiter','Saturn','Venus','Now','Future'] and four static
 * branch cards that ignored the chart completely. Everything below is now derived from
 * ChartData using standard, deterministic Jyotisha rules, so the timeline and the cards
 * describe THIS chart.
 *
 * The underlying chart is still the project's illustrative dataset - deriving from it
 * does not make it a real ephemeris calculation, and the caption says so.
 */

// Vimshottari Dasha: fixed cyclic order and period lengths in years (total 120).
const VIMSHOTTARI_ORDER = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury'] as const;
const VIMSHOTTARI_YEARS: Record<string, number> = {
  Ketu: 7, Venus: 20, Sun: 6, Moon: 10, Mars: 7, Rahu: 18, Jupiter: 16, Saturn: 19, Mercury: 17
};

// The Dasha sequence begins at the lord of the birth Nakshatra.
const NAKSHATRA_LORDS: Record<string, string> = {
  ashwini: 'Ketu', magha: 'Ketu', mula: 'Ketu', moola: 'Ketu',
  bharani: 'Venus', 'purva phalguni': 'Venus', 'purva ashadha': 'Venus',
  krittika: 'Sun', 'uttara phalguni': 'Sun', 'uttara ashadha': 'Sun',
  rohini: 'Moon', hasta: 'Moon', shravana: 'Moon',
  mrigashira: 'Mars', mrigashirsha: 'Mars', chitra: 'Mars', dhanishta: 'Mars',
  ardra: 'Rahu', swati: 'Rahu', shatabhisha: 'Rahu',
  punarvasu: 'Jupiter', vishakha: 'Jupiter', 'purva bhadrapada': 'Jupiter',
  pushya: 'Saturn', anuradha: 'Saturn', 'uttara bhadrapada': 'Saturn',
  ashlesha: 'Mercury', jyeshtha: 'Mercury', revati: 'Mercury'
};

const SIGN_LORDS: Record<string, string> = {
  aries: 'Mars', taurus: 'Venus', gemini: 'Mercury', cancer: 'Moon',
  leo: 'Sun', virgo: 'Mercury', libra: 'Venus', scorpio: 'Mars',
  sagittarius: 'Jupiter', capricorn: 'Saturn', aquarius: 'Saturn', pisces: 'Jupiter'
};

const PLANET_GEMSTONES: Record<string, string> = {
  Sun: 'Ruby', Moon: 'Pearl', Mars: 'Red Coral', Mercury: 'Emerald', Jupiter: 'Yellow Sapphire',
  Venus: 'Diamond / White Sapphire', Saturn: 'Blue Sapphire', Rahu: 'Hessonite', Ketu: "Cat's Eye"
};

const PLANET_GLYPHS: Record<string, string> = {
  Sun: '☉', Moon: '☾', Mars: '♂', Mercury: '☿', Jupiter: '♃', Venus: '♀', Saturn: '♄', Rahu: '☊', Ketu: '☋'
};

const PLANET_THEMES: Record<string, string> = {
  Sun: 'confidence and visibility', Moon: 'emotional rhythm and care', Mars: 'drive and initiative',
  Mercury: 'communication and analysis', Jupiter: 'growth, learning and counsel', Venus: 'harmony, art and relationships',
  Saturn: 'patience, structure and endurance', Rahu: 'unfamiliar territory and ambition', Ketu: 'reflection and detachment'
};

/** "Punarvasu · Pada 2" -> "Jupiter". Falls back to the current Dasha lord. */
function nakshatraLord(nakshatra: string, fallback: string) {
  const name = nakshatra.split(/[·|,(]/)[0].trim().toLowerCase();
  return NAKSHATRA_LORDS[name] ?? fallback;
}

/** "Venus / Mercury" -> { maha: 'Venus', antar: 'Mercury' }. */
function parseDasha(dasha: string) {
  const [maha, antar] = dasha.split('/').map(part => part.trim());
  return { maha: maha || 'Venus', antar: antar || undefined };
}

type DashaNode = { planet: string; years: number; state: 'past' | 'current' | 'future' };

function buildDashaTimeline(chart: ChartData): { nodes: DashaNode[]; maha: string; antar?: string; startLord: string } {
  const { maha, antar } = parseDasha(chart.dasha);
  const startLord = nakshatraLord(chart.nakshatra, maha);
  const startIndex = Math.max(0, VIMSHOTTARI_ORDER.indexOf(startLord as typeof VIMSHOTTARI_ORDER[number]));

  // One full 120-year cycle beginning at the birth Nakshatra lord.
  const sequence = Array.from({ length: VIMSHOTTARI_ORDER.length }, (_, i) =>
    VIMSHOTTARI_ORDER[(startIndex + i) % VIMSHOTTARI_ORDER.length]);

  const currentIndex = sequence.indexOf(maha as typeof VIMSHOTTARI_ORDER[number]);
  const nodes: DashaNode[] = sequence.map((planet, i) => ({
    planet,
    years: VIMSHOTTARI_YEARS[planet] ?? 0,
    state: currentIndex < 0 ? 'future' : i < currentIndex ? 'past' : i === currentIndex ? 'current' : 'future'
  }));
  return { nodes, maha, antar, startLord };
}

type Branch = { key: string; title: string; tags: string[]; copy: string; prompt: string };

const BRANCH_META: Record<string, { eyebrow: string; action: string; icon: string }> = {
  career: { eyebrow: 'DIRECTION & MOMENTUM', action: 'Explore career', icon: '⛰' },
  relationships: { eyebrow: 'CONNECTION & HARMONY', action: 'Explore relationships', icon: '∞' },
  remedies: { eyebrow: 'TRADITIONAL SUPPORT', action: 'View guidance', icon: '🪔' },
  gemstones: { eyebrow: 'PLANETARY ASSOCIATION', action: 'Explore gemstone', icon: '◆' }
};

function buildBranches(chart: ChartData, maha: string, antar?: string): Branch[] {
  const byHouse = (house: number) => chart.planets.filter(p => p.house === house);
  const find = (name: string) => chart.planets.find(p => p.name === name);
  const describe = (name: string) => {
    const p = find(name);
    return p ? `${name} in ${p.sign} · House ${p.house}` : name;
  };
  const lagnaLord = SIGN_LORDS[chart.lagna.toLowerCase()] ?? maha;

  const career = byHouse(10);
  const partnership = byHouse(7);
  const dashaLords = [maha, ...(antar && antar !== maha ? [antar] : [])];

  return [
    {
      key: 'career',
      title: 'Career',
      tags: [`${maha} Dasha`, career.length ? `House 10 · ${career.map(p => p.name).join(', ')}` : 'House 10 empty'],
      copy: career.length
        ? `${career.map(p => describe(p.name)).join(' and ')} sits in the house of profession, alongside a ${maha} period emphasising ${PLANET_THEMES[maha] ?? 'its own themes'}.`
        : `No Navagraha occupies House 10 here, so the ${maha} Dasha and the Lagna lord ${describe(lagnaLord)} carry the career signal.`,
      prompt: 'Tell me about my career'
    },
    {
      key: 'relationships',
      title: 'Relationships',
      tags: [partnership.length ? `House 7 · ${partnership.map(p => p.name).join(', ')}` : 'House 7 empty', describe('Venus').replace(' · ', ' ')],
      copy: partnership.length
        ? `${partnership.map(p => describe(p.name)).join(' and ')} occupies the partnership house, with Venus in ${find('Venus')?.sign} shaping how harmony is expressed.`
        : `House 7 is unoccupied, so Venus in ${find('Venus')?.sign} and the Lagna lord ${lagnaLord} describe the partnership tone.`,
      prompt: 'What does my chart say about relationships?'
    },
    {
      key: 'remedies',
      title: 'Remedies',
      tags: dashaLords,
      copy: `Traditional guidance in this period is oriented toward ${dashaLords.join(' and ')} — ${dashaLords.map(p => PLANET_THEMES[p] ?? 'its themes').join(', and ')}.`,
      prompt: `What remedies suit my ${maha} Dasha?`
    },
    {
      key: 'gemstones',
      title: 'Gemstones',
      tags: Array.from(new Set([PLANET_GEMSTONES[maha] ?? '—', PLANET_GEMSTONES[lagnaLord] ?? '—'])),
      copy: `${PLANET_GEMSTONES[maha]} is the traditional stone for the ruling ${maha} Dasha, and ${PLANET_GEMSTONES[lagnaLord]} for the ${chart.lagna} Lagna lord ${lagnaLord}. Suitability should always be reviewed before use.`,
      prompt: 'Which gemstone is associated with my chart?'
    }
  ];
}

export function CosmicThreadScene({ chart, profile, focusPlanets = [], onExplore }: {
  chart: ChartData;
  profile?: Partial<BirthProfile>;
  focusPlanets?: string[];
  onExplore?: (prompt: string, branchKey: string) => void;
}) {
  const { nodes, maha, antar, startLord } = useMemo(() => buildDashaTimeline(chart), [chart]);
  const branches = useMemo(() => buildBranches(chart, maha, antar), [chart, maha, antar]);
  const active = new Set(focusPlanets.map(name => name.toLowerCase()));
  const [selectedBranch, setSelectedBranch] = useState<string>();

  return (
    <div className="scene-wrap thread-scene">
      <div className="scene-copy">
        <div className="eyebrow">CHAPTER 05 · THE COSMIC THREAD</div>
        <h2>One continuous story from birth to what comes next.</h2>
        <p>
          Your Vimshottari sequence begins at <strong>{startLord}</strong>, lord of {chart.nakshatra.split(/[·|,(]/)[0].trim()},
          and currently runs <strong>{maha}{antar ? ` / ${antar}` : ''}</strong>. Career, relationships, remedies and gemstones
          below are read from this chart.
        </p>
        <div className="kundli-profile-chips">
          {profile?.name && <span>✦ {profile.name}</span>}
          <span>◈ {chart.lagna} Lagna</span>
          <span>☾ {chart.moonSign} Moon</span>
          <span className="kundli-context-chip">ⓘ Illustrative Vedic chart</span>
        </div>
      </div>

      <div className="timeline glass-panel thread-timeline">
        <div className="thread-timeline-head">
          <strong>YOUR VIMSHOTTARI TIMELINE</strong>
          <div className="thread-legend"><span className="past">Past</span><span className="current">Current</span><span className="future">Upcoming</span></div>
        </div>
        <div className="timeline-line" />
        {nodes.map((node, i) => (
          <div
            className={`timeline-node ${node.state} ${active.has(node.planet.toLowerCase()) ? 'spoken' : ''}`}
            style={{ left: `${6 + i * (88 / Math.max(1, nodes.length - 1))}%` }}
            key={node.planet}
          >
            <span className="node-dot">{PLANET_GLYPHS[node.planet]}</span>
            <strong>{node.planet}</strong>
            <small>{node.years} yrs{node.state === 'current' ? ' · now' : ''}</small>
          </div>
        ))}
        <div className="timeline-caption">
          <span>Vimshottari Mahadasha sequence · derived from {chart.nakshatra}</span>
          <strong>Current · {maha}{antar ? ` / ${antar}` : ''}</strong>
        </div>
      </div>

      <div className="branch-grid">
        {branches.map(branch => {
          const meta = BRANCH_META[branch.key];
          return (
          <div className={`branch-card glass-panel ${branch.tags.some(t => active.has(t.toLowerCase())) ? 'active' : ''} ${selectedBranch === branch.key ? 'selected' : ''}`} key={branch.key}>
            <div className={`thread-card-visual visual-${branch.key}`}>
              <span className="thread-card-orbit orbit-a"/><span className="thread-card-orbit orbit-b"/>
              <span className="thread-card-symbol">{meta.icon}</span>
              {branch.key === 'career' && <span className="career-path"/>}
              {branch.key === 'remedies' && <><span className="ritual-flame">♨</span><span className="ritual-planet">{PLANET_GLYPHS[maha]}</span></>}
              {branch.key === 'gemstones' && <span className="gem-reflection"/>}
            </div>
            <div className="branch-eyebrow">{meta.eyebrow}</div>
            <h3>{branch.title}</h3>
            <div className="tag-row">{branch.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
            <p>{branch.copy}</p>
            {branch.key === 'gemstones' && <div className="gem-safety">Review suitability before wearing.</div>}
            <button
              className="ghost-btn"
              type="button"
              onClick={() => {
                setSelectedBranch(branch.key);
                onExplore?.(branch.prompt, branch.key);
              }}
              title={onExplore ? `Ask Jyotishi: ${branch.prompt}` : 'Start the voice session to explore this'}
              disabled={!onExplore}
            >
              {onExplore ? `${meta.action} →` : 'Start the session to explore'}
            </button>
          </div>
        )})}
      </div>

      {selectedBranch && <div className="thread-selection-status" aria-live="polite">
        <span>✦</span> Jyotishi is exploring <strong>{branches.find(branch => branch.key === selectedBranch)?.title}</strong> from this Cosmic Thread.
      </div>}

    </div>
  );
}
