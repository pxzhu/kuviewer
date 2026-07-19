import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ServerCog, Unplug } from 'lucide-react';
import {
  clearDesktopConnectionProfile,
  type DesktopConnectionProfile,
  type DesktopSidecarStatus,
  storeDesktopConnectionProfile,
} from '../features/desktop/desktopConnectionProfile';

interface DesktopConnectionProfilePanelProps {
  profile: DesktopConnectionProfile | null;
  sidecarProfile: DesktopSidecarStatus | null;
  onProfileChange: (profile: DesktopConnectionProfile | null) => void;
  onUseSidecar: () => void;
}

export function DesktopConnectionProfilePanel({ profile, sidecarProfile, onProfileChange, onUseSidecar }: DesktopConnectionProfilePanelProps) {
  const [serverUrl, setServerUrl] = useState(profile?.serverUrl || '');
  const [error, setError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const sidecarActive = Boolean(profile && sidecarProfile && profile.serverUrl === sidecarProfile.serverUrl);

  useEffect(() => {
    setServerUrl(profile?.serverUrl || '');
  }, [profile?.serverUrl]);

  const handleSave = () => {
    setError('');
    setSavedMessage('');
    try {
      const nextProfile = storeDesktopConnectionProfile(serverUrl);
      onProfileChange(nextProfile);
      setSavedMessage('서버 profile 저장됨');
    } catch (requestError) {
      setError(formatDesktopProfileError(requestError instanceof Error ? requestError.message : 'desktop_server_url_invalid'));
    }
  };

  const handleClear = () => {
    clearDesktopConnectionProfile();
    onProfileChange(null);
    setServerUrl('');
    setError('');
    setSavedMessage('서버 profile 비움');
  };

  return (
    <div className="grid gap-3 border-t border-[rgba(60,60,67,0.1)] bg-[rgba(247,250,255,0.58)] px-3 py-3 md:grid-cols-[minmax(180px,1fr)_auto] md:items-end lg:px-4" data-testid="desktop-connection-profile">
      <label className="min-w-0">
        <span className="ku-meta">Desktop server profile</span>
        <span className="mt-1 flex min-w-0 items-center gap-2">
          <ServerCog className="shrink-0 text-[rgba(60,60,67,0.48)]" size={16} aria-hidden="true" />
          <input
            className="ku-field h-9 w-full font-mono"
            data-testid="desktop-server-url"
            placeholder="https://kuviewer.example.com"
            value={serverUrl}
            onChange={(event) => {
              setServerUrl(event.target.value);
              setError('');
              setSavedMessage('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                handleSave();
              }
            }}
          />
        </span>
      </label>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {profile ? (
          <span className="ku-chip max-w-full border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]" title={profile.serverUrl}>
            <CheckCircle2 size={13} aria-hidden="true" />
            <span className="truncate">profile {profile.serverUrl}</span>
          </span>
        ) : (
          <span className="ku-chip max-w-full">
            <Unplug size={13} aria-hidden="true" />
            profile 없음
          </span>
        )}
        {sidecarProfile ? (
          <span
            className={`ku-chip max-w-full ${
              sidecarActive
                ? 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]'
                : 'border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.08)] text-[#0066cc]'
            }`}
            title={`${sidecarProfile.serverUrl} · ${sidecarProfile.source}`}
          >
            <ServerCog size={13} aria-hidden="true" />
            <span className="truncate">local sidecar {sidecarProfile.source}</span>
          </span>
        ) : (
          <span className="ku-chip max-w-full">
            <Unplug size={13} aria-hidden="true" />
            local sidecar 없음
          </span>
        )}
        {error ? (
          <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]">
            <AlertTriangle size={13} aria-hidden="true" />
            {error}
          </span>
        ) : savedMessage ? (
          <span className="ku-chip border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.08)] text-[#0066cc]">
            <CheckCircle2 size={13} aria-hidden="true" />
            {savedMessage}
          </span>
        ) : null}
        <button className="ku-control-primary" data-testid="desktop-save-profile" type="button" onClick={handleSave}>
          저장
        </button>
        <button
          className="ku-control"
          data-testid="desktop-use-sidecar-profile"
          type="button"
          disabled={!sidecarProfile || sidecarActive}
          onClick={onUseSidecar}
          title={sidecarProfile ? sidecarProfile.serverUrl : 'local sidecar profile 없음'}
        >
          로컬 sidecar 사용
        </button>
        <button className="ku-control" data-testid="desktop-clear-profile" type="button" disabled={!profile && !serverUrl} onClick={handleClear}>
          비우기
        </button>
      </div>
    </div>
  );
}

function formatDesktopProfileError(error: string) {
  if (error.includes('required')) {
    return 'URL 필요';
  }
  if (error.includes('too_long')) {
    return 'URL 너무 김';
  }
  if (error.includes('protocol')) {
    return 'http/https만';
  }
  if (error.includes('insecure_http')) {
    return 'HTTP는 localhost만';
  }
  if (error.includes('credentials')) {
    return '계정정보 제외';
  }
  if (error.includes('query')) {
    return 'query 제외';
  }
  if (error.includes('invalid')) {
    return 'URL 형식 오류';
  }
  return 'profile 오류';
}
