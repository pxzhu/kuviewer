import type { DesktopCmSession, DesktopCmSessionInput } from './desktopConnectionProfile.ts';
import { desktopCmDefaultRemoteApiPort } from './desktopCmSessionDefaults.ts';

const maxDesktopCmSessionCloneNameLength = 60;

export function validateDesktopCmSessionForm(form: DesktopCmSessionInput) {
  if (!form.name.trim()) return 'name 필요';
  if (!form.host.trim()) return 'host 필요';
  if (!form.user.trim()) return 'user 필요';
  if (!validPort(form.port)) return 'port 1-65535';
  if (!validPort(form.remoteApiPort || desktopCmDefaultRemoteApiPort)) return 'API port 1-65535';
  return '';
}

export function formatCmSessionError(error: string) {
  if (error.includes('remote_api_host')) return 'API host 형식 오류';
  if (error.includes('remote_api_port')) return 'API port 1-65535';
  if (error.includes('runtime_health')) return 'API health 확인 실패';
  if (error.includes('runtime_tunnel') || error.includes('process_start')) return 'runtime 터널 실패';
  if (error.includes('import')) return 'import 파일 오류';
  if (error.includes('host')) return 'host 형식 오류';
  if (error.includes('port')) return 'port 1-65535';
  if (error.includes('private_key_path')) return 'key path 필요';
  if (error.includes('private_key_file') || error.includes('private_key_marker') || error.includes('repo_path')) return 'key 파일 오류';
  if (error.includes('credential')) return 'credential 오류';
  if (error.includes('timeout')) return '연결 시간 초과';
  if (error.includes('unreachable')) return '연결 불가';
  if (error.includes('ssh-binary')) return 'ssh 없음';
  if (error.includes('user')) return 'user 형식 오류';
  if (error.includes('name')) return 'name 필요';
  if (error.includes('too_long')) return '값이 너무 김';
  if (error.includes('not_found')) return '세션 없음';
  return '세션 오류';
}

export function formatCmSessionCheckStatus(status: string) {
  const labels: Record<string, string> = {
    reachable: '연결 가능',
    'auth-failed': '인증 실패',
    timeout: '시간 초과',
    unreachable: '연결 불가',
    'not-ssh': 'SSH 아님',
    'ssh-binary-missing': 'ssh 없음',
    'credential-ready': 'credential 준비됨',
    'credential-deleted': 'credential 삭제됨',
    'credential-missing': 'credential 없음',
    'not-checked': '확인 안 됨',
  };
  return labels[status] || status || '확인 안 됨';
}

export function formatRuntimeStatus(status: string) {
  const labels: Record<string, string> = {
    'runtime-active': 'runtime active',
    'runtime-unhealthy': 'runtime health 실패',
    'runtime-lost': 'runtime 끊김',
    stopped: 'runtime stopped',
  };
  return labels[status] || status || 'runtime stopped';
}

export function formatRuntimeHealthStatus(status: string) {
  const labels: Record<string, string> = { healthy: 'health 정상', unhealthy: 'health 실패', unknown: 'health 미확인' };
  return labels[status] || status || 'health 미확인';
}

export function formatCmDiagnosticStage(stage: string) {
  return stage === 'ssh-auth' ? 'ssh auth' : stage || 'metadata';
}

export function formatCmDiagnosticSeverity(severity: string) {
  return severity || 'info';
}

export function cmRuntimeStatusClass(status: string) {
  if (status === 'runtime-active') {
    return 'border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.08)] text-[#0066cc]';
  }
  if (status === 'runtime-unhealthy' || status === 'runtime-lost') {
    return 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]';
  }
  return 'border-[rgba(142,142,147,0.2)] bg-[rgba(142,142,147,0.1)] text-[#636366]';
}

export function formatTimestamp(timestamp?: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString();
}

export function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

export function buildDesktopCmSessionCloneName(sourceName: string, sessions: DesktopCmSession[]) {
  const existingNames = new Set(sessions.map((session) => session.name.trim().toLowerCase()).filter(Boolean));
  const sourceBase = sourceName.trim() || 'CM session';
  for (let copyIndex = 1; copyIndex <= 99; copyIndex += 1) {
    const suffix = copyIndex === 1 ? ' copy' : ` copy ${copyIndex}`;
    const maxBaseLength = Math.max(1, maxDesktopCmSessionCloneNameLength - suffix.length);
    const candidateBase = sourceBase.slice(0, maxBaseLength).trimEnd() || 'CM';
    const candidate = `${candidateBase}${suffix}`;
    if (!existingNames.has(candidate.toLowerCase())) return candidate;
  }
  return `${sourceBase.slice(0, 42).trimEnd() || 'CM'} copy ${Date.now().toString(36).slice(-6)}`;
}

function validPort(port: number) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}
