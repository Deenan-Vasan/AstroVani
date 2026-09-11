import type { SceneName } from '../types';

const items: Array<{ id: SceneName; label: string; icon: string }> = [
  { id: 'intro', label: 'Arrival', icon: '◉' },
  { id: 'sky', label: 'Birth Sky', icon: '☄' },
  { id: 'kundli', label: 'Kundli', icon: '◇' },
  { id: 'palm', label: 'Palmistry', icon: '✋' },
  { id: 'thread', label: 'Cosmic Thread', icon: '〰' }
];

export function JourneyRail({ scene, onChange }: { scene: SceneName; onChange: (scene: SceneName) => void }) {
  return (
    <nav className="journey-rail glass-panel">
      <div className="eyebrow">JOURNEY FLOW</div>
      {items.map((item, index) => (
        <button
          key={item.id}
          className={`journey-item ${scene === item.id ? 'active' : ''}`}
          onClick={() => onChange(item.id)}
        >
          <span className="journey-index">0{index + 1}</span>
          <span className="journey-icon">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
      <div className="journey-coverage">Five connected chapters · one continuous Jyotishi session</div>
    </nav>
  );
}
