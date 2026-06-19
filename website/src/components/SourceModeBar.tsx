import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Download,
  FileArchive,
  FileJson,
  KeyRound,
  LockKeyhole,
  Server,
  UploadCloud,
} from 'lucide-react';
import { clearAdminToken, getStoredAdminToken, storeAdminToken } from '../features/auth/adminToken';
import type { DesktopConnectionProfile, DesktopSidecarStatus } from '../features/desktop/desktopConnectionProfile';
import type { TopologySourceMode } from '../features/topology/useTopology';
import type { UploadedTopologyState } from '../features/upload/parseKubernetesFiles';
import { fetchConnectorStatusWithToken } from '../services/statusApi';
import { DesktopConnectionProfilePanel } from './DesktopConnectionProfilePanel';

interface SourceModeBarProps {
  desktopConnectionAvailable: boolean;
  desktopConnectionProfile: DesktopConnectionProfile | null;
  desktopSidecarProfile: DesktopSidecarStatus | null;
  mode: TopologySourceMode;
  liveUnlocked: boolean;
  uploadClusterId: string;
  uploadClusterName: string;
  uploadedState: UploadedTopologyState | null;
  uploadError: string;
  liveSessionMessage: string;
  canExport: boolean;
  onModeChange: (mode: TopologySourceMode) => void;
  onUploadClusterIdChange: (value: string) => void;
  onUploadClusterNameChange: (value: string) => void;
  onUploadFiles: (files: File[]) => void;
  onImportJson: (file: File) => void;
  onExportJson: () => void;
  onDesktopConnectionProfileChange: (profile: DesktopConnectionProfile | null) => void;
  onUseDesktopSidecar: () => void;
  onLiveUnlock: () => void;
  onLiveLock: () => void;
}

const modeOptions: Array<{ mode: TopologySourceMode; label: string; icon: typeof UploadCloud }> = [
  { mode: 'upload', label: 'YAML 업로드', icon: UploadCloud },
  { mode: 'live', label: '실시간 클러스터', icon: Server },
  { mode: 'mock', label: '목업 데모', icon: Boxes },
];

export function SourceModeBar({
  desktopConnectionAvailable,
  desktopConnectionProfile,
  desktopSidecarProfile,
  mode,
  liveUnlocked,
  uploadClusterId,
  uploadClusterName,
  uploadedState,
  uploadError,
  liveSessionMessage,
  canExport,
  onModeChange,
  onUploadClusterIdChange,
  onUploadClusterNameChange,
  onUploadFiles,
  onImportJson,
  onExportJson,
  onDesktopConnectionProfileChange,
  onUseDesktopSidecar,
  onLiveUnlock,
  onLiveLock,
}: SourceModeBarProps) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState(() => getStoredAdminToken());
  const [checkingToken, setCheckingToken] = useState(false);
  const [tokenError, setTokenError] = useState('');
  const [warningsOpen, setWarningsOpen] = useState(false);

  useEffect(() => {
    setToken(getStoredAdminToken());
    setTokenError('');
  }, [desktopConnectionProfile?.serverUrl]);

  const handleLiveUnlock = async () => {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setTokenError('admin_token_required');
      return;
    }

    setCheckingToken(true);
    setTokenError('');
    try {
      await fetchConnectorStatusWithToken(trimmedToken);
      storeAdminToken(trimmedToken);
      onLiveUnlock();
      onModeChange('live');
    } catch (error) {
      setTokenError(error instanceof Error ? error.message : 'status_request_failed');
    } finally {
      setCheckingToken(false);
    }
  };

  const handleLiveLock = () => {
    clearAdminToken();
    setToken('');
    setTokenError('');
    onLiveLock();
  };

  return (
    <section className="ku-panel overflow-hidden">
      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:p-4">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="grid w-full grid-cols-3 rounded-[12px] border border-[rgba(60,60,67,0.14)] bg-[rgba(242,242,247,0.78)] p-1 sm:w-auto">
            {modeOptions.map((option) => {
              const Icon = option.icon;
              const active = mode === option.mode;
              return (
                <button
                  key={option.mode}
                  className={`inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-[9px] px-3 text-sm font-semibold transition ${
                    active ? 'bg-[#1d1d1f] text-white shadow-sm' : 'text-[rgba(60,60,67,0.72)] hover:bg-white/80'
                  }`}
                  data-testid={`source-mode-${option.mode}`}
                  type="button"
                  onClick={() => onModeChange(option.mode)}
                >
                  <Icon className="shrink-0" size={15} aria-hidden="true" />
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button className="ku-control" type="button" onClick={() => uploadInputRef.current?.click()}>
              <FileArchive size={16} aria-hidden="true" />
              YAML/ZIP
            </button>
            <button className="ku-control" type="button" onClick={() => importInputRef.current?.click()}>
              <FileJson size={16} aria-hidden="true" />
              가져오기
            </button>
            <button className="ku-control" type="button" disabled={!canExport} onClick={onExportJson}>
              <Download size={16} aria-hidden="true" />
              내보내기
            </button>
            <UploadSummary uploadedState={uploadedState} uploadError={uploadError} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {liveUnlocked ? (
            <span className="ku-chip border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]">
              <CheckCircle2 size={13} aria-hidden="true" />
              실시간 연결됨
            </span>
          ) : (
            <label className="relative min-w-0 sm:w-[260px]">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.46)]" size={15} aria-hidden="true" />
              <input
                className="ku-field h-9 w-full pl-9 pr-3"
                data-testid="live-token-input"
                placeholder="admin token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleLiveUnlock();
                  }
                }}
              />
            </label>
          )}
          {liveUnlocked ? (
            <button className="ku-control" type="button" onClick={handleLiveLock}>
              <LockKeyhole size={16} aria-hidden="true" />
              실시간 잠금
            </button>
          ) : (
            <button className="ku-control-primary" data-testid="unlock-live" type="button" disabled={checkingToken} onClick={() => void handleLiveUnlock()}>
              <Server size={16} aria-hidden="true" />
              {checkingToken ? '확인 중' : '실시간 연결'}
            </button>
          )}
          {tokenError ? (
            <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]" title={tokenError}>
              <AlertTriangle size={13} aria-hidden="true" />
              {shortError(tokenError)}
            </span>
          ) : liveSessionMessage ? (
            <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]" title={liveSessionMessage}>
              <AlertTriangle size={13} aria-hidden="true" />
              {liveSessionMessage}
            </span>
          ) : null}
        </div>
      </div>

      {mode === 'upload' ? (
        <div className="grid gap-3 border-t border-[rgba(60,60,67,0.1)] bg-white/45 px-3 py-3 md:grid-cols-[minmax(160px,240px)_minmax(160px,240px)_minmax(0,1fr)] lg:px-4">
          <label className="min-w-0">
            <span className="ku-meta">Cluster name</span>
            <input
              className="ku-field mt-1 h-9 w-full"
              data-testid="upload-cluster-name"
              placeholder="uploaded-bundle"
              value={uploadClusterName}
              onChange={(event) => onUploadClusterNameChange(event.target.value)}
            />
          </label>
          <label className="min-w-0">
            <span className="ku-meta">Cluster id</span>
            <input
              className="ku-field mt-1 h-9 w-full font-mono"
              data-testid="upload-cluster-id"
              placeholder="uploaded-bundle"
              value={uploadClusterId}
              onChange={(event) => onUploadClusterIdChange(event.target.value)}
            />
          </label>
          <UploadWarnings
            open={warningsOpen}
            uploadedState={uploadedState}
            uploadError={uploadError}
            onToggle={() => setWarningsOpen((current) => !current)}
          />
        </div>
      ) : null}

      {desktopConnectionAvailable ? (
        <DesktopConnectionProfilePanel
          profile={desktopConnectionProfile}
          sidecarProfile={desktopSidecarProfile}
          onProfileChange={onDesktopConnectionProfileChange}
          onUseSidecar={onUseDesktopSidecar}
        />
      ) : null}

      <input
        ref={uploadInputRef}
        className="hidden"
        data-testid="upload-files"
        multiple
        type="file"
        accept=".yaml,.yml,.json,.zip,application/x-yaml,application/json,application/zip"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files || []);
          event.currentTarget.value = '';
          if (files.length > 0) {
            onUploadFiles(files);
          }
        }}
      />
      <input
        ref={importInputRef}
        className="hidden"
        data-testid="import-topology-json"
        type="file"
        accept=".json,application/json"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) {
            onImportJson(file);
          }
        }}
      />
    </section>
  );
}

function UploadSummary({ uploadedState, uploadError }: { uploadedState: UploadedTopologyState | null; uploadError: string }) {
  if (uploadError) {
    return (
      <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]" title={uploadError}>
        <AlertTriangle size={13} aria-hidden="true" />
        업로드 오류
      </span>
    );
  }

  if (!uploadedState) {
    return <span className="ku-chip">업로드 없음</span>;
  }

  const warningCount = uploadedState.warnings.length;
  return (
    <span className={`ku-chip ${warningCount ? 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]' : ''}`} title={uploadedState.warnings.slice(0, 3).join('\n')}>
      {warningCount ? <AlertTriangle size={13} aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />}
      리소스 {uploadedState.snapshot.nodes.length}개 · 파일 {uploadedState.files.length}개 · 경고 {warningCount}개
    </span>
  );
}

function UploadWarnings({
  open,
  uploadedState,
  uploadError,
  onToggle,
}: {
  open: boolean;
  uploadedState: UploadedTopologyState | null;
  uploadError: string;
  onToggle: () => void;
}) {
  const warnings = uploadWarnings(uploadedState, uploadError);
  const visibleWarnings = warnings.slice(0, 5);
  const hiddenCount = Math.max(0, warnings.length - visibleWarnings.length);

  return (
    <div className="min-w-0 self-end">
      <button
        className={`inline-flex h-9 max-w-full items-center gap-2 rounded-[10px] border px-3 text-sm font-semibold transition ${
          warnings.length ? 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]' : 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]'
        }`}
        data-testid="upload-warning-toggle"
        type="button"
        aria-expanded={open}
        onClick={onToggle}
      >
        {warnings.length ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
        <span className="truncate">{warnings.length ? `업로드 진단 ${warnings.length}개` : '업로드 진단 정상'}</span>
        <ChevronDown className={`shrink-0 transition ${open ? 'rotate-180' : ''}`} size={14} aria-hidden="true" />
      </button>

      {open ? (
        <div className="mt-2 rounded-[11px] border border-[rgba(60,60,67,0.12)] bg-white/88 p-3 shadow-[0_4px_16px_rgba(0,0,0,0.04)]" data-testid="upload-warning-panel">
          {warnings.length ? (
            <ul className="space-y-2">
              {visibleWarnings.map((warning, index) => (
                <li key={`${warning}-${index}`} className="break-words font-mono text-[11px] font-semibold leading-relaxed text-[rgba(60,60,67,0.72)]">
                  {warning}
                </li>
              ))}
              {hiddenCount ? <li className="font-mono text-[11px] font-semibold text-[#b05f00]">+{hiddenCount} more</li> : null}
            </ul>
          ) : (
            <p className="text-sm font-semibold text-[rgba(60,60,67,0.66)]">표시할 업로드 경고가 없습니다.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function uploadWarnings(uploadedState: UploadedTopologyState | null, uploadError: string) {
  return [uploadError, ...(uploadedState?.warnings || [])].filter(Boolean);
}

function shortError(error: string) {
  if (error.includes(':401')) {
    return '401 토큰';
  }

  if (error.includes('api_base_url')) {
    return 'API 없음';
  }

  return '확인 실패';
}
