import {
  Boxes,
  GitBranch,
  GitCompareArrows,
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

const brandThemeOptions: Array<{ value: BrandTheme; label: string }> = [
  { value: 'yaml-flow', label: 'D' },
  { value: 'radar', label: 'B' },
];

const viewModeOptions: Array<{ value: ViewMode; label: string; icon: LucideIcon }> = [
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
  const brandIconSrc =
    brandTheme === 'radar'
      ? `${import.meta.env.BASE_URL}images/brand/kuviewer-icon-radar.svg?v=0.1.40`
      : `${import.meta.env.BASE_URL}images/brand/kuviewer-icon-yaml-flow.svg?v=0.1.40`;

  return (
    <header className="ku-header sticky top-0 z-50">
      <div className="mx-auto flex max-w-[1760px] flex-col gap-3 px-3 py-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div className="flex min-w-0 gap-3">
          <img
            className="ku-brand-mark mt-0.5 h-11 w-11 shrink-0"
            src={brandIconSrc}
            alt=""
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="ku-chip border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.08)] text-[#0066cc]">
                <Boxes size={13} aria-hidden="true" />
                {providerLabel} 소스
              </span>
              <span className="ku-chip">
                {loading ? '동기화 중' : `동기화 ${formatLastSync(lastUpdatedAt, '안 됨')}`}
              </span>
              <span className="ku-chip max-w-full truncate">
                {formatAppConnectorStatus(connectorStatus, connectorLoading, connectorError, sourceMode, liveUnlocked, uploadedState)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="ku-title text-[22px] font-semibold tracking-[0]">Kuviewer</h1>
              <p className="ku-copy font-mono text-xs font-semibold">
                Kubernetes 리소스 맵 · 관계 · YAML 기반 트래픽 흐름
              </p>
            </div>
            {topologyError ? <p className="mt-1 text-sm font-semibold text-[#b26a00]">API 오류: {formatAppUiError(topologyError)}</p> : null}
            {uploadError ? <p className="mt-1 text-sm font-semibold text-[#b26a00]">업로드 오류: {formatAppUiError(uploadError)}</p> : null}
          </div>
        </div>

        <div className="ku-header-actions">
          <div className="ku-segmented grid-cols-2" aria-label="브랜드 테마">
            {brandThemeOptions.map((option) => (
              <HeaderSegmentButton
                key={option.value}
                active={brandTheme === option.value}
                icon={Palette}
                label={option.label}
                onClick={() => onBrandThemeChange(option.value)}
              />
            ))}
          </div>
          <div className="ku-segmented grid-cols-4" aria-label="주요 보기">
            {viewModeOptions.map((option) => (
              <HeaderSegmentButton
                key={option.value}
                active={viewMode === option.value}
                icon={option.icon}
                label={option.label}
                onClick={() => onViewModeChange(option.value)}
              />
            ))}
          </div>
          <button
            className="ku-control"
            type="button"
            onClick={onRefresh}
            disabled={!liveActive || loading}
            title="실시간 토폴로지 새로고침"
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} size={16} aria-hidden="true" />
            새로고침
          </button>
          <button
            className={`inline-flex h-9 items-center gap-2 rounded-[10px] border px-3 text-sm font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition ${
              autoRefresh
                ? 'border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.1)] text-[#0066cc] hover:bg-[rgba(0,122,255,0.14)]'
                : 'border-[rgba(60,60,67,0.16)] bg-white/80 text-[#1d1d1f] hover:bg-white'
            } ${liveActive ? '' : 'cursor-not-allowed opacity-60'}`}
            type="button"
            onClick={() => onAutoRefreshChange(!autoRefresh)}
            disabled={!liveActive}
            aria-pressed={autoRefresh}
            title="실시간 자동 새로고침 전환"
          >
            <AutoRefreshIcon size={16} aria-hidden="true" />
            자동 {Math.round(refreshIntervalMs / 1000)}초
          </button>
          <button
            className="ku-control"
            type="button"
            onClick={onResetFilters}
            title="필터 초기화"
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            초기화
          </button>
          <button
            className="ku-control-primary"
            type="button"
            disabled={!liveUnlocked}
            onClick={onLiveLock}
            title="실시간 admin token 지우기"
          >
            <LockKeyhole size={16} aria-hidden="true" />
            실시간 잠금
          </button>
        </div>
      </div>
    </header>
  );
}

function HeaderSegmentButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      className={`ku-segmented-button ${active ? 'ku-segmented-button-active' : ''}`}
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon size={15} aria-hidden="true" />
      {label}
    </button>
  );
}
