import type { DesktopCmSession, DesktopCmSessionRuntimeProfile } from '../../features/desktop/desktopConnectionProfile';
import {
  formatCmDiagnosticSeverity,
  formatCmDiagnosticStage,
  formatTimestamp,
} from '../../features/desktop/desktopCmSessionPresentation';

type DesktopCmDiagnostic =
  | Pick<DesktopCmSession, 'diagnosticStage' | 'diagnosticSeverity' | 'diagnosticMessage' | 'diagnosticHint' | 'lastCheckAt'>
  | Pick<DesktopCmSessionRuntimeProfile, 'diagnosticStage' | 'diagnosticSeverity' | 'diagnosticMessage' | 'diagnosticHint' | 'lastHealthAt'>;

export function DesktopCmDiagnostics({ diagnostic, testId }: { diagnostic: DesktopCmDiagnostic; testId: string }) {
  const stage = diagnostic.diagnosticStage || 'metadata';
  const severity = diagnostic.diagnosticSeverity || 'info';
  const message = diagnostic.diagnosticMessage || 'not-checked';
  const hint = diagnostic.diagnosticHint || '연결 확인을 실행해 진단을 갱신하세요.';
  const timestamp = 'lastHealthAt' in diagnostic ? diagnostic.lastHealthAt : 'lastCheckAt' in diagnostic ? diagnostic.lastCheckAt : undefined;
  return (
    <div className="mt-2 grid gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.1)] bg-white/68 px-2.5 py-2" data-testid={testId}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="ku-meta">Diagnostics</span>
        <span className={`ku-chip ${cmDiagnosticSeverityClass(severity)}`} data-testid={`${testId}-severity`}>
          {formatCmDiagnosticSeverity(severity)}
        </span>
        <span className="ku-chip" data-testid={`${testId}-stage`}>
          {formatCmDiagnosticStage(stage)}
        </span>
        {timestamp ? <span className="ku-chip">{formatTimestamp(timestamp)}</span> : null}
      </div>
      <p className="break-words font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.64)]" data-testid={`${testId}-message`}>
        {message}
      </p>
      <p className="break-words text-xs font-semibold text-[rgba(60,60,67,0.68)]" data-testid={`${testId}-hint`}>
        {hint}
      </p>
    </div>
  );
}

function cmDiagnosticSeverityClass(severity: string) {
  if (severity === 'error') {
    return 'border-[rgba(255,59,48,0.24)] bg-[rgba(255,59,48,0.1)] text-[#b42318]';
  }
  if (severity === 'warning') {
    return 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#8a4d00]';
  }
  return 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]';
}
