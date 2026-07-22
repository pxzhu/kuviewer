import {
  AlertTriangle,
  Boxes,
  CircleDot,
  DatabaseZap,
  GitBranch,
  GitCompareArrows,
  Gauge,
  LockKeyhole,
  Palette,
  Pause,
  Play,
  RefreshCw,
  SearchCode,
  SlidersHorizontal,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { formatAppConnectorStatus, formatAppUiError } from '../features/status/appHeaderPresentation';
import type { TopologySourceMode } from '../features/topology/useTopology';
import type { UploadedTopologyState } from '../features/upload/parseKubernetesFiles';
import type { ConnectorStatus } from '../types/status';
import { formatLastSync } from '../utils/formatTime';
import { KuButton } from './ui/KuButton';
import { KuSegmentedControl, type KuSegmentedOption } from './ui/KuSegmentedControl';
import { KuChip } from './ui/KuSurface';

export type BrandTheme = 'yaml-flow' | 'radar';
export type ViewMode = 'topology' | 'traffic' | 'resources' | 'compare';

interface AppHeaderProps {
  autoRefresh: boolean;
  brandTheme: BrandTheme;
  connectorError: string;
  connectorLoading: boolean;
  connectorStatus: ConnectorStatus | null;
  lastUpdatedAt: number | null;
  liveActive: boolean;
  liveUnlocked: boolean;
  loading: boolean;
  providerLabel: string;
  refreshIntervalMs: number;
  sourceMode: TopologySourceMode;
  topologyError: string;
  uploadError: string;
  uploadedState: UploadedTopologyState | null;
  viewMode: ViewMode;
  onAutoRefreshChange: (enabled: boolean) => void;
  onBrandThemeChange: (theme: BrandTheme) => void;
  onLiveLock: () => void;
  onRefresh: () => void;
  onResetFilters: () => void;
  onViewModeChange: (viewMode: ViewMode) => void;
}

const brandThemeOptions: Array<KuSegmentedOption<BrandTheme>> = [
  { value: 'yaml-flow', label: 'D', icon: Palette },
  { value: 'radar', label: 'B', icon: Palette },
];

const viewModeOptions: Array<KuSegmentedOption<ViewMode>> = [
  { value: 'topology', label: '토폴로지', icon: GitBranch },
  { value: 'traffic', label: '트래픽 흐름', icon: Workflow },
  { value: 'resources', label: '리소스 탐색', icon: SearchCode },
  { value: 'compare', label: '스냅샷 비교', icon: GitCompareArrows },
];

export function AppHeader({
  autoRefresh,
  brandTheme,
  connectorError,
  connectorLoading,
  connectorStatus,
  lastUpdatedAt,
  liveActive,
  liveUnlocked,
  loading,
  providerLabel,
  refreshIntervalMs,
  sourceMode,
  topologyError,
  uploadError,
  uploadedState,
  viewMode,
  onAutoRefreshChange,
  onBrandThemeChange,
  onLiveLock,
  onRefresh,
  onResetFilters,
  onViewModeChange,
}: AppHeaderProps) {
  const AutoRefreshIcon = autoRefresh ? Pause : Play;
  const healthState = connectorError || topologyError || uploadError ? '주의' : loading || connectorLoading ? '확인 중' : '정상';
  const healthTone = connectorError || topologyError || uploadError ? 'warning' : loading || connectorLoading ? 'info' : 'success';
  const sourceLabel = sourceMode === 'live' ? (liveUnlocked ? '실시간 연결' : '실시간 잠김') : sourceMode === 'mock' ? '목업 데모' : 'YAML 업로드';
  const datasetLabel = uploadedState
    ? `${uploadedState.files.length} files · ${uploadedState.warnings.length} warnings`
    : sourceMode === 'mock'
      ? 'sample topology'
      : sourceMode === 'live'
        ? connectorStatus?.source || 'cluster API'
        : 'upload ready';
  const viewLabel = viewModeOptions.find((option) => option.value === viewMode)?.label || '토폴로지';
  const syncLabel = loading ? '동기화 중' : formatLastSync(lastUpdatedAt, '대기');
  const brandIconSrc =
    brandTheme === 'radar'
      ? `${import.meta.env.BASE_URL}images/brand/kuviewer-icon-radar.svg?v=0.1.40`
      : `${import.meta.env.BASE_URL}images/brand/kuviewer-icon-yaml-flow.svg?v=0.1.40`;

  return (
    <header className="ku-header sticky top-0 z-50">
      <div className="mx-auto grid max-w-[1760px] gap-3 px-3 py-3 sm:px-4 lg:px-6">
        <div className="ku-command-center">
          <div className="flex min-w-0 gap-3">
            <img
              className="ku-brand-mark mt-0.5 h-12 w-12 shrink-0"
              src={brandIconSrc}
              alt=""
              aria-hidden="true"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <KuChip className="border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.08)] text-[#0066cc]">
                  <Boxes size={13} aria-hidden="true" />
                  {providerLabel} 소스
                </KuChip>
                <KuChip>{syncLabel}</KuChip>
                <KuChip className="max-w-full truncate">
                  {formatAppConnectorStatus(connectorStatus, connectorLoading, connectorError, sourceMode, liveUnlocked, uploadedState)}
                </KuChip>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="ku-title text-[26px] font-semibold leading-none tracking-[0]">Kuviewer</h1>
                <p className="ku-copy font-mono text-xs font-semibold">
                  Kubernetes topology command center
                </p>
              </div>
              {topologyError ? <p className="mt-1 text-sm font-semibold text-[#b26a00]">API 오류: {formatAppUiError(topologyError)}</p> : null}
              {uploadError ? <p className="mt-1 text-sm font-semibold text-[#b26a00]">업로드 오류: {formatAppUiError(uploadError)}</p> : null}
            </div>
          </div>

          <div className="ku-header-actions">
            <KuSegmentedControl
              ariaLabel="브랜드 테마"
              className="grid-cols-2"
              options={brandThemeOptions}
              value={brandTheme}
              onChange={onBrandThemeChange}
            />
            <KuSegmentedControl
              ariaLabel="주요 보기"
              className="grid-cols-4"
              options={viewModeOptions}
              value={viewMode}
              onChange={onViewModeChange}
            />
            <KuButton
              type="button"
              disabled={!liveActive || loading}
              title="실시간 토폴로지 새로고침"
              onPress={onRefresh}
            >
              <RefreshCw className={loading ? 'animate-spin' : ''} size={16} aria-hidden="true" />
              새로고침
            </KuButton>
            <KuButton
              className={`h-9 ${
                autoRefresh
                  ? 'border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.1)] text-[#0066cc] hover:bg-[rgba(0,122,255,0.14)]'
                  : ''
              }`}
              type="button"
              disabled={!liveActive}
              aria-pressed={autoRefresh}
              title="실시간 자동 새로고침 전환"
              onPress={() => onAutoRefreshChange(!autoRefresh)}
            >
              <AutoRefreshIcon size={16} aria-hidden="true" />
              자동 {Math.round(refreshIntervalMs / 1000)}초
            </KuButton>
            <KuButton
              type="button"
              title="필터 초기화"
              onPress={onResetFilters}
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              초기화
            </KuButton>
            <KuButton
              type="button"
              disabled={!liveUnlocked}
              title="실시간 admin token 지우기"
              tone="primary"
              onPress={onLiveLock}
            >
              <LockKeyhole size={16} aria-hidden="true" />
              실시간 잠금
            </KuButton>
          </div>
        </div>

        <div className="ku-status-rail" aria-label="현재 작업 상태">
          <HeaderStatusCard icon={Gauge} label="View" value={viewLabel} detail="active workspace" />
          <HeaderStatusCard icon={CircleDot} label="Source" value={sourceLabel} detail={providerLabel} />
          <HeaderStatusCard icon={DatabaseZap} label="Dataset" value={datasetLabel} detail={syncLabel} />
          <HeaderStatusCard icon={healthTone === 'warning' ? AlertTriangle : Gauge} label="Health" value={healthState} detail={connectorLoading ? 'checking connector' : 'ready'} tone={healthTone} />
        </div>
      </div>
    </header>
  );
}

interface HeaderStatusCardProps {
  detail: string;
  icon: LucideIcon;
  label: string;
  tone?: 'info' | 'success' | 'warning';
  value: string;
}

function HeaderStatusCard({ detail, icon: Icon, label, tone = 'info', value }: HeaderStatusCardProps) {
  return (
    <div className={`ku-status-card ku-status-card-${tone}`}>
      <Icon className="shrink-0" size={16} aria-hidden="true" />
      <div className="min-w-0">
        <p className="ku-meta">{label}</p>
        <p className="truncate text-sm font-semibold">{value}</p>
        <p className="truncate font-mono text-[11px] font-semibold text-[var(--ku-text-subtle)]">{detail}</p>
      </div>
    </div>
  );
}
