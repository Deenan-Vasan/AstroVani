import { useState } from 'react';
import type { BirthProfile } from '../types';

const initial: BirthProfile = {
  name: 'Deenan',
  date: '1995-07-12',
  time: '22:30',
  place: 'Mumbai, India',
  language: 'English'
};

type Props = {
  onStartVoice: () => void;
  onStartTyped: (profile: BirthProfile) => void;
  loading: boolean;
  connecting: boolean;
  live: boolean;
  profileProgress: Partial<BirthProfile>;
};

export function BirthForm({ onStartVoice, onStartTyped, loading, connecting, live, profileProgress }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(initial);
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

      <div className="typed-fallback">
        <button className="text-link-btn" onClick={() => setShowForm(value => !value)}>
          {showForm ? 'Hide typed details' : 'Prefer to type instead? Enter birth details'}
        </button>
      </div>

      {showForm && (
        <div className="typed-form-wrap">
          <div className="form-grid">
            <label>Name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label>Birth date<input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
            <label>Birth time<input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} /></label>
            <label>Birth place<input value={form.place} onChange={e => setForm({ ...form, place: e.target.value })} /></label>
            <label>Language<select value={form.language} onChange={e => setForm({ ...form, language: e.target.value })}>
              <option>English</option><option>Hindi</option><option>Tamil</option><option>Telugu</option><option>Marathi</option><option>Kannada</option><option>Spanish</option><option>French</option>
            </select></label>
          </div>
          <button className="ghost-btn typed-submit" onClick={() => onStartTyped(form)} disabled={loading || connecting || live}>
            {loading ? 'Preparing your sky…' : 'Continue with typed details →'}
          </button>
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
