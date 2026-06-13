import { AlertTriangle, CheckCircle2, Clock3, Database, EyeOff, LockKeyhole, RotateCw, ServerCog, type LucideIcon } from 'lucide-react';
import type { ConnectorStatus } from '../types/status';

interface ConnectorDiagnosticsProps {
  status: ConnectorStatus | null;
  statusLoading: boolean;
  statusError: string;
  topologyLoading: boolean;
  topologyError: string;
  lastUpdatedAt: number | null;
  source: string;
  visibleNodes: number;
  visibleEdges: number;
  totalNodes: number;
  totalEdges: number;
}

export function ConnectorDiagnostics({
  status,
  statusLoading,
  statusError,
  topologyLoading,
  topologyError,
  lastUpdatedAt,
  source,
  visibleNodes,
  visibleEdges,
  totalNodes,
  totalEdges,
}: ConnectorDiagnosticsProps) {
  const modeLabel = status?.mode || sourceValueLabel(source);
  const sourceLabel = status?.source || sourceValueLabel(source);
  const readOnlyLabel = status ? (status.readOnly ? '읽기 전용' : '쓰기 가능') : '알 수 없음';
  const secretsLabel = status ? formatSecrets(status.secrets) : '알 수 없음';
  const uiLabel = status ? (status.static ? '정적 UI 포함' : '외부 UI') : '알 수 없음';
  const hasError = Boolean(statusError || topologyError);
  const isSyncing = statusLoading || topologyLoading;

  return (
    <section className="ku-panel overflow-hidden">
      <div className="border-b border-[rgba(60,60,67,0.12)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#1d1d1f]">커넥터</h2>
            <p className="ku-meta mt-1">백엔드 소스 및 동기화 상태</p>
          </div>
          <span
            className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 font-mono text-[11px] font-semibold ${
              hasError
                ? 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]'
                : isSyncing
                  ? 'border-[rgba(0,122,255,0.24)] bg-[rgba(0,122,255,0.10)] text-[#007aff]'
                  : 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.10)] text-[#248a3d]'
            }`}
          >
            {hasError ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
            {hasError ? '점검 필요' : isSyncing ? '동기화 중' : '정상'}
          </span>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <DiagnosticItem icon={Database} label="소스" value={sourceLabel} />
          <DiagnosticItem icon={ServerCog} label="모드" value={modeLabel} />
          <DiagnosticItem icon={LockKeyhole} label="접근" value={readOnlyLabel} />
          <DiagnosticItem icon={EyeOff} label="Secret" value={secretsLabel} />
          <DiagnosticItem icon={Clock3} label="서버 시간" value={formatServerTime(status?.serverTime)} />
          <DiagnosticItem icon={RotateCw} label="최근 동기화" value={formatLastSync(lastUpdatedAt)} />
        </dl>

        <div className="rounded-[11px] border border-[rgba(60,60,67,0.12)] bg-[rgba(242,242,247,0.66)] px-3 py-2">
          <p className="ku-meta">표시 그래프</p>
          <p className="mt-1 text-sm font-semibold text-[#1d1d1f]">
            리소스 {visibleNodes}/{totalNodes} / 엣지 {visibleEdges}/{totalEdges}
          </p>
          <p className="mt-1 text-xs font-medium text-[rgba(60,60,67,0.62)]">카운트는 현재 필터와 선택된 데이터 소스를 기준으로 계산됩니다.</p>
        </div>

        <div className="rounded-[11px] border border-[rgba(60,60,67,0.12)] bg-[rgba(242,242,247,0.66)] px-3 py-2">
          <p className="ku-meta">UI 런타임</p>
          <p className="mt-1 text-sm font-semibold text-[#1d1d1f]">{uiLabel}</p>
        </div>

        {statusError ? <ErrorRow label="상태 API" message={formatError(statusError)} /> : null}
        {topologyError ? <ErrorRow label="토폴로지 API" message={formatError(topologyError)} /> : null}
      </div>
    </section>
  );
}

interface DiagnosticItemProps {
  icon: LucideIcon;
  label: string;
  value: string;
}

function DiagnosticItem({ icon: Icon, label, value }: DiagnosticItemProps) {
  return (
    <div className="rounded-[11px] border border-[rgba(60,60,67,0.12)] bg-[rgba(242,242,247,0.66)] px-3 py-2">
      <dt className="flex items-center gap-1 font-mono text-[11px] font-semibold uppercase tracking-[0.04em] text-[rgba(60,60,67,0.58)]">
        <Icon size={13} aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-semibold text-[#1d1d1f]">{value}</dd>
    </div>
  );
}

function ErrorRow({ label, message }: { label: string; message: string }) {
  return (
    <div className="rounded-[11px] border border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] px-3 py-2">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.04em] text-[#b05f00]">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-[#6e4100]">{message}</p>
    </div>
  );
}

function formatSecrets(secrets: string) {
  if (secrets === 'hidden') {
    return '값 숨김';
  }

  return secrets || '알 수 없음';
}

function formatLastSync(lastUpdatedAt: number | null) {
  if (!lastUpdatedAt) {
    return '동기화 안 됨';
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(lastUpdatedAt));
}

function formatServerTime(serverTime?: string) {
  if (!serverTime) {
    return '확인 불가';
  }

  const parsedTime = new Date(serverTime);
  if (Number.isNaN(parsedTime.getTime())) {
    return serverTime;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(parsedTime);
}

function sourceValueLabel(source: string) {
  if (source === 'upload') {
    return '업로드';
  }
  if (source === 'mock') {
    return '목업';
  }
  if (source === 'live') {
    return '실시간';
  }
  return source;
}

function formatError(error: string) {
  if (error.includes(':401')) {
    return 'admin token 인증 실패(401)';
  }
  if (error.includes(':500')) {
    return '서버에서 토폴로지 스냅샷 생성 실패(500)';
  }
  if (error.includes('api_base_url')) {
    return 'API 주소가 설정되지 않았습니다.';
  }
  if (error.includes('topology_request_failed')) {
    return '토폴로지 API 요청에 실패했습니다.';
  }
  if (error.includes('status_request_failed')) {
    return '상태 API 요청에 실패했습니다.';
  }

  return error;
}
