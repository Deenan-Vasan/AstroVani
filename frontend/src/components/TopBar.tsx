import type { AgoraConnectionState } from '../hooks/useAgoraSession';
import type { SceneName } from '../types';

const sceneLabel: Record<SceneName, string> = {
  intro: 'Arrival', sky: 'Birth Sky', kundli: 'Kundli', palm: 'Palmistry', thread: 'Cosmic Thread'
};

export function TopBar({ scene, connectionState }: { scene: SceneName; connectionState: AgoraConnectionState }) {
  const live = connectionState === 'connected';
  return (
    <header className="topbar">
      <div className="brand-wrap">
        <div className="brand-mark">✦</div>
        <div><div className="brand">AstroVani</div><div className="brand-sub">The Cosmic Journey</div></div>
      </div>
      <div className="journey-pill">Current chapter · {sceneLabel[scene]}</div>
      <div className="topbar-actions">
        <span className="live-chip"><span className={live ? 'live-dot' : 'status-dot'} /> {live ? 'Agora Live' : connectionState === 'connecting' ? 'Connecting' : 'Ready'}</span>
        <button className="ghost-btn">Agora Web SDK</button>
      </div>
    </header>
  );
}
