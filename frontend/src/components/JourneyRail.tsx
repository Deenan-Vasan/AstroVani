import type { SceneName } from '../types';

const items: Array<{ id: SceneName; label: string; icon: string }> = [
  { id: 'intro', label: 'Arrival', icon: '◉' },
  { id: 'sky', label: 'Birth Sky', icon: '☄' },
  { id: 'kundli', label: 'Kundli', icon: '◇' },
  { id: 'palm', label: 'Palmistry', icon: '✋' },
  { id: 'thread', label: 'Cosmic Thread', icon: '〰' }
];

/**
 * Every chapter after Arrival is built from the user's own birth details, so they stay
 * locked until the cosmic profile has been completed. `unlocked` flips on when it is.
 */
export function JourneyRail({ scene, onChange, unlocked }: { scene: SceneName; onChange: (scene: SceneName) => void; unlocked: boolean }) {
  return (
    <nav className="journey-rail glass-panel">
      <div className="eyebrow">JOURNEY FLOW</div>
      {items.map((item, index) => {
        const locked = item.id !== 'intro' && !unlocked;
        return (
          <button
            key={item.id}
            className={`journey-item ${scene === item.id ? 'active' : ''} ${locked ? 'locked' : ''}`}
            onClick={() => { if (!locked) onChange(item.id); }}
            disabled={locked}
            aria-disabled={locked}
            title={locked ? 'Complete your cosmic profile first' : undefined}
          >
            <span className="journey-index">0{index + 1}</span>
            <span className="journey-icon">{locked ? '🔒' : item.icon}</span>
            <span>{item.label}</span>
          </button>
        );
      })}
      <div className="journey-coverage">{unlocked ? 'Five connected chapters · one continuous Jyotishi session' : 'Share your birth details with Jyotishi to unlock the other chapters'}</div>
    </nav>
  );
}
