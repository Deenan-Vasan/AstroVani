import { useEffect, useRef } from 'react';
import type { ICameraVideoTrack, IRemoteVideoTrack } from 'agora-rtc-sdk-ng';
import type { BirthProfile, SceneName } from '../types';
import type { AgoraConnectionState } from '../hooks/useAgoraSession';

const prompts: Record<SceneName, string> = {
  intro: 'Start the journey and answer naturally. I will collect your birth details by voice and remember them for this session.',
  sky: 'This is your illustrative birth sky. Ask me to focus on any Navagraha placement shown here.',
  kundli: 'The sky has transformed into your Kundli. Ask about a house, planet or Dasha.',
  palm: 'Show your palm to the camera. I will guide the framing before capture.',
  thread: 'We can now travel through career, relationships, remedies, gemstones and timing.'
};

type Props = {
  scene: SceneName;
  transcript: string[];
  connectionState: AgoraConnectionState;
  error: string;
  channel: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  localVideoTrack: ICameraVideoTrack | null;
  remoteVideoTrack: IRemoteVideoTrack | null;
  profile?: BirthProfile;
  profileProgress: Partial<BirthProfile>;
  onDisconnect: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
};

export function GuidePanel({
  scene, transcript, connectionState, error, channel, micEnabled, cameraEnabled,
  localVideoTrack, remoteVideoTrack, profileProgress, onDisconnect, onToggleMic, onToggleCamera
}: Props) {
  const localVideoRef = useRef<HTMLDivElement>(null);
  const remoteVideoRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!localVideoTrack || !localVideoRef.current) return;
    localVideoTrack.play(localVideoRef.current);
    return () => localVideoTrack.stop();
  }, [localVideoTrack]);

  useEffect(() => {
    if (!remoteVideoTrack || !remoteVideoRef.current) return;
    remoteVideoTrack.play(remoteVideoRef.current);
    return () => remoteVideoTrack.stop();
  }, [remoteVideoTrack]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [transcript]);

  const live = connectionState === 'connected';
  const connecting = connectionState === 'connecting';
  const captured = [profileProgress.name, profileProgress.date, profileProgress.time, profileProgress.place].filter(Boolean).length;

  return (
    <aside className="guide-panel glass-panel">
      <div className="guide-head">
        <div className="avatar-orb-wrap"><div className="avatar-orb">🔮</div></div>
        <div>
          <div className="eyebrow">AI COSMIC GUIDE</div>
          <h3>Jyotishi</h3>
          <div className={`status-row ${connectionState}`}>
            <span className={live ? 'live-dot' : 'status-dot'} />
            {connecting ? ' Connecting to Agora…' : live ? ' Live · Agora Conversational AI' : connectionState === 'error' ? ' Connection error' : ' Ready'}
          </div>
        </div>
      </div>

      {live && <div className="rtc-video-stack">
        <div className="rtc-video-tile stacked-video avatar-video"><div ref={remoteVideoRef} className="rtc-video-surface" />{!remoteVideoTrack && <div className="rtc-video-placeholder">Avatar waiting</div>}<span>Jyotishi</span><i className="speaking-pulse" /></div>
        <div className="rtc-video-tile stacked-video user-video"><div ref={localVideoRef} className="rtc-video-surface" /><span>You</span></div>
      </div>}

      <p className="guide-prompt">{prompts[scene]}</p>

      {scene === 'intro' && live && (
        <div className="mini-profile-progress">
          <div><span>Voice profile</span><small>{captured}/4</small></div>
          <div className="mini-profile-dots">
            {[profileProgress.name, profileProgress.date, profileProgress.time, profileProgress.place].map((value, index) => <i key={index} className={value ? 'done' : ''} />)}
          </div>
        </div>
      )}

      {channel && <div className="channel-chip">Channel · {channel}</div>}
      {error && <div className="integration-error">{error}</div>}

      <div className="transcript-stack" ref={transcriptRef}>
        {transcript.filter(line => line.startsWith('You:') || line.startsWith('Jyotishi:')).map((line, index) => {
          const isUser = line.startsWith('You:');
          const text = line.replace(/^(You|Jyotishi):\s*/, '');
          return <div className={`transcript-line ${isUser ? 'user-line' : 'agent-line'}`} key={`${line}-${index}`}>
            <div className="transcript-speaker"><span>{isUser ? 'YOU' : 'JYOTISHI'}</span>{!isUser && <i>AI</i>}</div>
            <div className="transcript-copy">{text}</div>
          </div>;
        })}
        {!transcript.some(line => line.startsWith('You:') || line.startsWith('Jyotishi:')) && <div className="transcript-empty">Final user and Jyotishi turns will appear here.</div>}
      </div>

      {live || connecting ? (
        <div className="session-action-row">
          <button className="ghost-btn end-session-btn" disabled={connecting} onClick={onDisconnect}>{connecting ? 'Connecting…' : 'End Cosmic Journey'}</button>
        </div>
      ) : (
        <div className="ready-note">Use <strong>Start Cosmic Journey</strong> in Chapter 01 to begin the live session.</div>
      )}

      <div className="media-controls">
        <button title="Microphone" className={!micEnabled ? 'disabled-media' : ''} disabled={!live} onClick={onToggleMic}>{micEnabled ? '🎙' : '🔇'}</button>
        <button title="Camera" className={!cameraEnabled ? 'disabled-media' : ''} disabled={!live} onClick={onToggleCamera}>{cameraEnabled ? '📷' : '🚫'}</button>
        <button title="Conversation status" disabled={!live}>✦</button>
        <button title="End session" className="danger" disabled={!live} onClick={onDisconnect}>×</button>
      </div>
    </aside>
  );
}
