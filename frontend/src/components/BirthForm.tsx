import type { BirthProfile } from '../types';

type Props = {
  onStartVoice: () => void;
  loading: boolean;
  connecting: boolean;
  live: boolean;
  profileProgress: Partial<BirthProfile>;
};

export function BirthForm({ onStartVoice, loading, connecting, live, profileProgress }: Props) {
  const captured = [profileProgress.name, profileProgress.date, profileProgress.time, profileProgress.place].filter(Boolean).length;

  return (
    <div className="birth-card glass-panel voice-first-arrival">
      <div className="eyebrow">CHAPTER 01 · ARRIVAL</div>
      <h1>Travel back to the moment the universe welcomed you.</h1>
      <p className="arrival-lede">Start with your voice. Jyotishi will ask for your birth details naturally, remember them for this session, and open your birth sky when the profile is complete.</p>

      <div className="voice-start-panel">
        <div className="voice-orb">✦</div>
        <div className="voice-start-copy">
          <strong>{connecting ? 'Connecting your Cosmic Guide…' : live ? 'Jyotishi is listening…' : 'Ready for your Cosmic Journey'}</strong>
          <span>{connecting ? 'Allow microphone and camera access when your browser asks.' : live ? 'Answer the guide naturally. Your details will appear below as they are captured.' : 'You can answer in any supported language.'}</span>
        </div>
        <button className="primary-btn hero-start-btn" onClick={onStartVoice} disabled={loading || connecting || live}>
          {connecting ? 'Connecting…' : live ? '🎙 Live conversation in progress' : '✦ Start Cosmic Journey'}
        </button>
      </div>

      {(connecting || live || captured > 0) && (
        <div className="profile-progress-card">
          <div className="profile-progress-title"><span>Your cosmic profile</span><small>{captured}/4 captured</small></div>
          <div className="profile-progress-grid">
            <ProgressItem label="Name" value={profileProgress.name} />
            <ProgressItem label="Birth date" value={profileProgress.date} />
            <ProgressItem label="Birth time" value={profileProgress.time} />
            <ProgressItem label="Birth place" value={profileProgress.place} />
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressItem({ label, value }: { label: string; value?: string }) {
  return (
    <div className={`profile-progress-item ${value ? 'complete' : ''}`}>
      <span className="profile-check">{value ? '✓' : '○'}</span>
      <div><strong>{label}</strong><small>{value || 'Waiting…'}</small></div>
    </div>
  );
}
