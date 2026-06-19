import { CheckCircle2, KeyRound, ServerCog, ShieldCheck, Unplug } from 'lucide-react';
import type { DesktopKubernetesProfile } from '../features/desktop/desktopConnectionProfile';

interface DesktopKubernetesProfilePanelProps {
  message: string;
  profiles: DesktopKubernetesProfile[];
  onSelectProfile: (profileId: string) => void;
}

export function DesktopKubernetesProfilePanel({ message, profiles, onSelectProfile }: DesktopKubernetesProfilePanelProps) {
  const selectedProfile = profiles.find((profile) => profile.selected);

  return (
    <div
      className="grid gap-3 border-t border-[rgba(60,60,67,0.1)] bg-[rgba(247,250,255,0.42)] px-3 py-3 lg:px-4"
      data-testid="desktop-kubernetes-profile-panel"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="ku-meta">Desktop Kubernetes profile</span>
        {selectedProfile ? (
          <span className="ku-chip max-w-full border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]" title={selectedProfile.apiServer}>
            <CheckCircle2 size={13} aria-hidden="true" />
            <span className="truncate">{selectedProfile.displayName}</span>
          </span>
        ) : (
          <span className="ku-chip max-w-full">
            <Unplug size={13} aria-hidden="true" />
            keychain profile 없음
          </span>
        )}
        <span className="ku-chip max-w-full">
          <ShieldCheck size={13} aria-hidden="true" />
          browser secret 저장 없음
        </span>
        {message ? (
          <span className="ku-chip max-w-full border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.08)] text-[#0066cc]">
            <ServerCog size={13} aria-hidden="true" />
            {message}
          </span>
        ) : null}
      </div>

      {profiles.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              className={`min-w-0 rounded-[8px] border px-3 py-2 text-left transition ${
                profile.selected
                  ? 'border-[rgba(52,199,89,0.28)] bg-[rgba(52,199,89,0.09)]'
                  : 'border-[rgba(60,60,67,0.13)] bg-white/72 hover:bg-white'
              }`}
              data-testid={`desktop-kubernetes-profile-${profile.id}`}
              type="button"
              onClick={() => onSelectProfile(profile.id)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <KeyRound className="shrink-0 text-[rgba(60,60,67,0.48)]" size={15} aria-hidden="true" />
                <span className="truncate text-sm font-semibold text-[#1d1d1f]">{profile.displayName}</span>
              </span>
              <span className="mt-1 block truncate font-mono text-xs font-semibold text-[rgba(60,60,67,0.58)]">{profile.apiServer}</span>
              <span className="mt-1 block truncate text-xs font-semibold text-[rgba(60,60,67,0.58)]">
                {profile.authType} · {profile.credentialStore} · {profile.status}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs font-semibold text-[rgba(60,60,67,0.58)]">
          keychain-backed bearer-token profile runtime은 native metadata command까지 준비됐고, OS credential 저장/불러오기는 다음 단계입니다.
        </p>
      )}
    </div>
  );
}
