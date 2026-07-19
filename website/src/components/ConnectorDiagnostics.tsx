import { AlertTriangle, CheckCircle2, ChevronDown, CircleSlash2, Clock3, Database, EyeOff, LockKeyhole, RotateCw, ServerCog, ShieldCheck, type LucideIcon } from 'lucide-react';
import { formatClockTime, formatLastSync } from '../utils/formatTime';
import type { ConnectorStatus } from '../types/status';
import { describeConnectorError, type ConnectorDiagnostic } from '../features/status/connectorDiagnostics';
import { snapshotDiagnosticAffectedCount, snapshotDiagnosticReasonLabel } from '../features/status/snapshotDiagnostics';
import type { CapabilityReport, ResourceCapability, ResourceCapabilityStatus } from '../types/capabilities';
import type { SnapshotDiagnostic } from '../types/topology';

interface ConnectorDiagnosticsProps {
  capabilityEnabled: boolean;
  capabilityReport: CapabilityReport | null;
  capabilityLoading: boolean;
  capabilityError: string;
  status: ConnectorStatus | null;
  statusLoading: boolean;
  statusError: string;
  topologyLoading: boolean;
  topologyError: string;
  collectionDiagnostics: SnapshotDiagnostic[];
  lastUpdatedAt: number | null;
  source: string;
  visibleNodes: number;
  visibleEdges: number;
  totalNodes: number;
  totalEdges: number;
  onRefreshCapabilities: () => void;
}

export function ConnectorDiagnostics({
  capabilityEnabled,
  capabilityReport,
  capabilityLoading,
  capabilityError,
  status,
  statusLoading,
  statusError,
  topologyLoading,
  topologyError,
  collectionDiagnostics,
  lastUpdatedAt,
  source,
  visibleNodes,
  visibleEdges,
  totalNodes,
  totalEdges,
  onRefreshCapabilities,
}: ConnectorDiagnosticsProps) {
  const modeLabel = status?.mode || sourceValueLabel(source);
  const sourceLabel = status?.source || sourceValueLabel(source);
  const readOnlyLabel = status ? (status.readOnly ? '읽기 전용' : '쓰기 가능') : '알 수 없음';
  const secretsLabel = status ? formatSecrets(status.secrets) : '알 수 없음';
  const uiLabel = status ? (status.static ? '정적 UI 포함' : '외부 UI') : '알 수 없음';
  const hasError = Boolean(statusError || topologyError);
  const hasCollectionWarning = collectionDiagnostics.length > 0;
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
              hasError || hasCollectionWarning
                ? 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]'
                : isSyncing
                  ? 'border-[rgba(0,122,255,0.24)] bg-[rgba(0,122,255,0.10)] text-[#007aff]'
                  : 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.10)] text-[#248a3d]'
            }`}
          >
            {hasError || hasCollectionWarning ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
            {hasError ? '점검 필요' : hasCollectionWarning ? '부분 수집' : isSyncing ? '동기화 중' : '정상'}
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

        {capabilityEnabled ? (
          <CapabilityMatrix
            error={capabilityError}
            loading={capabilityLoading}
            report={capabilityReport}
            onRefresh={onRefreshCapabilities}
          />
        ) : null}

        {collectionDiagnostics.length > 0 ? <CollectionDiagnostics items={collectionDiagnostics} /> : null}

        {statusError ? <ErrorRow label="상태 API" diagnostic={describeConnectorError(statusError)} /> : null}
        {topologyError ? <ErrorRow label="토폴로지 API" diagnostic={describeConnectorError(topologyError)} /> : null}
      </div>
    </section>
  );
}

function CollectionDiagnostics({ items }: { items: SnapshotDiagnostic[] }) {
  const affected = snapshotDiagnosticAffectedCount(items);
  return (
    <details className="group rounded-[11px] border border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.08)] px-3 py-2" data-testid="connector-collection-diagnostics">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-[#8a5200]">
        <span className="flex items-center gap-1.5"><AlertTriangle size={13} aria-hidden="true" />리소스 수집 {affected}건 불완전</span>
        <ChevronDown className="transition group-open:rotate-180" size={14} aria-hidden="true" />
      </summary>
      <div className="mt-2 divide-y divide-[rgba(255,149,0,0.16)] border-t border-[rgba(255,149,0,0.18)]">
        {items.map((item) => (
          <div className="flex items-center justify-between gap-2 py-1.5 text-xs" key={`${item.id}:${item.resource}:${item.reason}`}>
            <span className="min-w-0 truncate font-semibold text-[#6e4100]">{item.resource}</span>
            <span className="shrink-0 font-mono text-[10px] text-[#8a5200]">{snapshotDiagnosticReasonLabel(item.reason)}{item.count > 1 ? ` · ${item.count}` : ''}</span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] font-medium text-[#8a5200]">표시된 리소스는 완전한 응답만 반영했습니다. 접근 범위에서 다시 확인할 수 있습니다.</p>
    </details>
  );
}

function CapabilityMatrix({
  report,
  loading,
  error,
  onRefresh,
}: {
  report: CapabilityReport | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const items = report?.items || [];
  const available = items.filter((item) => item.status === 'available').length;
  const protectedCount = items.filter((item) => item.status === 'protected').length;
  const denied = items.filter((item) => item.status === 'forbidden' || item.status === 'unauthorized').length;
  const missing = items.filter((item) => item.status === 'missing').length;
  const unavailable = items.filter((item) => item.status === 'unavailable').length;
  const requiredDenied = items.filter((item) => item.required && item.status !== 'available').length;
  const groupedItems = groupCapabilities(items);

  return (
    <div className="border-y border-[rgba(60,60,67,0.12)] py-3" data-testid="connector-capability-matrix">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <ShieldCheck size={14} aria-hidden="true" />
            <p className="text-sm font-semibold text-[#1d1d1f]">리소스 접근 범위</p>
          </div>
          <p className="ku-meta mt-1" data-testid="connector-capability-summary">
            읽기 {available} · 인증/권한 {denied} · 미설치 {missing} · 확인 실패 {unavailable} · 보호 {protectedCount}
          </p>
        </div>
        <button className="ku-control h-8 px-2.5" type="button" disabled={loading} onClick={onRefresh} data-testid="connector-capability-refresh">
          <RotateCw className={loading ? 'animate-spin' : ''} size={14} aria-hidden="true" />
          재확인
        </button>
      </div>

      {requiredDenied > 0 ? (
        <p className="mt-2 rounded-[8px] bg-[rgba(255,59,48,0.08)] px-2.5 py-2 text-xs font-semibold text-[#b42318]" data-testid="connector-capability-required-warning">
          필수 Core 권한 {requiredDenied}개를 확인해야 전체 토폴로지를 읽을 수 있습니다.
        </p>
      ) : null}
      {report?.warning ? <p className="mt-2 text-xs font-semibold text-[#b05f00]">{capabilityWarningLabel(report.warning)}</p> : null}
      {error ? <ErrorRow label="접근 범위 API" diagnostic={describeConnectorError(error)} /> : null}
      {!report && loading ? <p className="ku-meta mt-2">Kubernetes API 접근 범위를 확인하는 중입니다.</p> : null}

      {groupedItems.length > 0 ? (
        <details className="group mt-2" data-testid="connector-capability-details">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1 text-xs font-semibold text-[rgba(60,60,67,0.72)]">
            그룹별 진단 {groupedItems.length}개
            <ChevronDown className="transition group-open:rotate-180" size={14} aria-hidden="true" />
          </summary>
          <div className="mt-2 divide-y divide-[rgba(60,60,67,0.08)] border-t border-[rgba(60,60,67,0.10)]">
            {groupedItems.map((group) => (
              <div className="py-2" key={group.name} data-testid={`connector-capability-group-${capabilityTestId(group.name)}`}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="font-mono text-[10px] font-semibold uppercase text-[rgba(60,60,67,0.54)]">{group.name}</p>
                  <p className="font-mono text-[10px] text-[rgba(60,60,67,0.54)]">{group.available}/{group.items.length}</p>
                </div>
                <div className="grid gap-1">
                  {group.items.map((item) => <CapabilityRow item={item} key={item.id} />)}
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {report?.checkedAt ? <p className="ku-meta mt-2">최근 확인 {formatClockTime(report.checkedAt) || '방금'}</p> : null}
    </div>
  );
}

function CapabilityRow({ item }: { item: ResourceCapability }) {
  const Icon = item.status === 'available' || item.status === 'protected' ? CheckCircle2 : item.status === 'missing' ? CircleSlash2 : AlertTriangle;
  return (
    <div className="flex items-center justify-between gap-2 py-0.5 text-xs" data-testid={`connector-capability-${capabilityTestId(item.id)}`}>
      <span className="flex min-w-0 items-center gap-1.5 font-semibold text-[#1d1d1f]">
        <Icon className={capabilityTone(item.status)} size={13} aria-hidden="true" />
        <span className="truncate">{item.resource}</span>
        {item.required ? <span className="font-mono text-[9px] uppercase text-[#b05f00]">required</span> : null}
      </span>
      <span className={`shrink-0 font-mono text-[10px] font-semibold ${capabilityTone(item.status)}`}>{capabilityStatusLabel(item.status)}</span>
    </div>
  );
}

function groupCapabilities(items: ResourceCapability[]) {
  const groups = new Map<string, ResourceCapability[]>();
  items.forEach((item) => {
    const group = groups.get(item.group);
    if (group) {
      group.push(item);
    } else {
      groups.set(item.group, [item]);
    }
  });
  return [...groups.entries()].map(([name, groupItems]) => ({
    name,
    items: groupItems,
    available: groupItems.filter((item) => item.status === 'available').length,
  }));
}

function capabilityStatusLabel(status: ResourceCapabilityStatus) {
  switch (status) {
    case 'available': return '읽기 가능';
    case 'forbidden': return 'RBAC 거부';
    case 'unauthorized': return '인증 실패';
    case 'missing': return '미설치';
    case 'protected': return '값 숨김';
    default: return '확인 실패';
  }
}

function capabilityTone(status: ResourceCapabilityStatus) {
  if (status === 'available') return 'text-[#248a3d]';
  if (status === 'protected') return 'text-[#007aff]';
  if (status === 'missing') return 'text-[rgba(60,60,67,0.48)]';
  return 'text-[#b05f00]';
}

function capabilityWarningLabel(warning: string) {
  return warning === 'capability_probe_unsupported' ? '현재 provider는 접근 범위 probe를 지원하지 않습니다.' : '접근 범위를 확인하지 못했습니다.';
}

function capabilityTestId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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

function ErrorRow({ label, diagnostic }: { label: string; diagnostic: ConnectorDiagnostic }) {
  return (
    <div className="rounded-[11px] border border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.04em] text-[#b05f00]">{label}</p>
        <span className="font-mono text-[10px] font-semibold uppercase text-[#8a5200]">{diagnostic.stage} · {diagnostic.code}</span>
      </div>
      <p className="mt-1 break-words text-sm font-semibold text-[#6e4100]">{diagnostic.message}</p>
      <p className="mt-1 text-xs font-medium text-[#8a5200]">{diagnostic.hint}</p>
    </div>
  );
}

function formatSecrets(secrets: string) {
  if (secrets === 'hidden') {
    return '값 숨김';
  }

  return secrets || '알 수 없음';
}

function formatServerTime(serverTime?: string) {
  if (!serverTime) {
    return '확인 불가';
  }

  return formatClockTime(serverTime) || serverTime;
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
