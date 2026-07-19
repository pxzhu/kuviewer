import { Activity, CheckCircle2, KeyRound, Unplug } from 'lucide-react';
import type { DesktopCmSession, DesktopCmSessionRuntimeProfile } from '../../features/desktop/desktopConnectionProfile';
import {
  DesktopCmDiagnostics,
} from './DesktopCmSessionPrimitives';
import {
  cmRuntimeStatusClass,
  formatCmSessionCheckStatus,
  formatRuntimeHealthStatus,
  formatRuntimeStatus,
  formatTimestamp,
} from '../../features/desktop/desktopCmSessionPresentation';

interface DesktopCmSessionSummaryProps {
  runtimeActive: boolean;
  runtimeProfile: DesktopCmSessionRuntimeProfile | null;
  runtimeStatus: string;
  selectedSession?: DesktopCmSession;
}

export function DesktopCmSessionSummary({ runtimeActive, runtimeProfile, runtimeStatus, selectedSession }: DesktopCmSessionSummaryProps) {
  return (
    <div
      className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.1)] bg-white/70 px-3 py-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
      data-testid="desktop-cm-session-summary"
    >
      {selectedSession ? (
        <>
          <div className="grid min-w-0 gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="ku-meta">Selected CM session</span>
              <span className="ku-chip max-w-full border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]" data-testid="desktop-cm-session-summary-name">
                <CheckCircle2 size={13} aria-hidden="true" />
                <span className="truncate">{selectedSession.name}</span>
              </span>
              <span
                className={`ku-chip max-w-full ${selectedSession.credentialAvailable ? 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]' : 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#8a4d00]'}`}
                data-testid="desktop-cm-session-summary-credential"
              >
                <KeyRound size={13} aria-hidden="true" />
                {selectedSession.credentialAvailable ? 'credential ready' : 'credential 필요'}
              </span>
              <span className={`ku-chip max-w-full ${cmRuntimeStatusClass(runtimeStatus)}`} data-testid="desktop-cm-session-summary-runtime">
                <Activity size={13} aria-hidden="true" />
                {formatRuntimeStatus(runtimeStatus)}
              </span>
              {runtimeActive && runtimeProfile ? (
                <span className={`ku-chip max-w-full ${runtimeProfile.healthStatus === 'healthy' ? 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]' : 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]'}`} data-testid="desktop-cm-session-summary-health">
                  <Activity size={13} aria-hidden="true" />
                  {formatRuntimeHealthStatus(runtimeProfile.healthStatus)}
                </span>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-semibold text-[rgba(60,60,67,0.62)]">
              <span className="truncate font-mono" title={`${selectedSession.user}@${selectedSession.host}:${selectedSession.port}`}>
                {selectedSession.user}@{selectedSession.host}:{selectedSession.port}
              </span>
              <span className="truncate font-mono">API {selectedSession.remoteApiHost}:{selectedSession.remoteApiPort}</span>
              <span className="truncate">
                {selectedSession.lastCheckAt ? `last check ${formatTimestamp(selectedSession.lastCheckAt)}` : formatCmSessionCheckStatus(selectedSession.lastCheckStatus)}
              </span>
            </div>
            <DesktopCmDiagnostics diagnostic={runtimeActive && runtimeProfile ? runtimeProfile : selectedSession} testId="desktop-cm-session-summary-diagnostics" />
          </div>
          {runtimeActive && runtimeProfile ? (
            <div className="min-w-0 text-xs font-semibold text-[rgba(60,60,67,0.62)]" data-testid="desktop-cm-session-summary-runtime-url">
              <p className="truncate font-mono" title={runtimeProfile.serverUrl}>{runtimeProfile.serverUrl}</p>
              <p className="truncate">
                {runtimeProfile.lastHealthAt ? `health ${formatTimestamp(runtimeProfile.lastHealthAt)}` : 'health 미확인'}
                {runtimeProfile.lastHealthMessage ? ` · ${runtimeProfile.lastHealthMessage}` : ''}
              </p>
            </div>
          ) : (
            <div className="text-xs font-semibold text-[rgba(60,60,67,0.58)]">runtime은 credential이 준비된 세션에서만 시작됩니다.</div>
          )}
        </>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="ku-meta">Selected CM session</span>
          <span className="ku-chip">
            <Unplug size={13} aria-hidden="true" />
            선택된 세션 없음
          </span>
        </div>
      )}
    </div>
  );
}
