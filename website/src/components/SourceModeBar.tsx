import { lazy, Suspense, useEffect, useRef, useState } from 'react';
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
import type { DesktopCmSession, DesktopCmSessionInput, DesktopCmSessionRuntimeProfile } from '../features/desktop/desktopConnectionProfile';
import type { TopologySourceMode } from '../features/topology/useTopology';
import type { UploadedTopologyState } from '../features/upload/parseKubernetesFiles';
import { fetchConnectorStatusWithToken } from '../services/statusApi';
import { KuButton } from './ui/KuButton';
import { KuInput } from './ui/KuInput';
import { KuSegmentedControl, type KuSegmentedOption } from './ui/KuSegmentedControl';
import { KuChip, KuSurface } from './ui/KuSurface';

const DesktopCmSessionPanel = lazy(async () => {
  const module = await import('./DesktopCmSessionPanel');
  return { default: module.DesktopCmSessionPanel };
});

interface SourceModeBarProps {
  desktopConnectionAvailable: boolean;
  desktopCmRuntimeProfile: DesktopCmSessionRuntimeProfile | null;
  desktopCmSessionMessage: string;
  desktopCmSessions: DesktopCmSession[];
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
  onDesktopCmSessionDelete: (sessionId: string) => Promise<void>;
  onDesktopCmSessionCredentialDelete: (sessionId: string) => Promise<void>;
  onDesktopCmSessionCheck: (sessionId: string) => Promise<void>;
  onDesktopCmSessionPrivateKeyImport: (sessionId: string, keyFilePath: string) => Promise<void>;
  onDesktopCmSessionRuntimeCheck: () => Promise<void>;
  onDesktopCmSessionRuntimeStart: (sessionId: string) => Promise<void>;
  onDesktopCmSessionRuntimeStop: () => Promise<void>;
  onDesktopCmSessionSave: (session: DesktopCmSessionInput) => Promise<void>;
  onDesktopCmSessionSelect: (sessionId: string) => Promise<void>;
  onLiveUnlock: () => void;
  onLiveLock: () => void;
}

const modeOptions: Array<KuSegmentedOption<TopologySourceMode>> = [
  { value: 'upload', label: 'YAML 업로드', icon: UploadCloud, testId: 'source-mode-upload' },
  { value: 'live', label: '실시간 클러스터', icon: Server, testId: 'source-mode-live' },
  { value: 'mock', label: '목업 데모', icon: Boxes, testId: 'source-mode-mock' },
];

export function SourceModeBar({
  desktopConnectionAvailable,
  desktopCmRuntimeProfile,
  desktopCmSessionMessage,
  desktopCmSessions,
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
  onDesktopCmSessionDelete,
  onDesktopCmSessionCredentialDelete,
  onDesktopCmSessionCheck,
  onDesktopCmSessionPrivateKeyImport,
  onDesktopCmSessionRuntimeCheck,
  onDesktopCmSessionRuntimeStart,
  onDesktopCmSessionRuntimeStop,
  onDesktopCmSessionSave,
  onDesktopCmSessionSelect,
  onLiveUnlock,
  onLiveLock,
}: SourceModeBarProps) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState(() => getStoredAdminToken());
  const [checkingToken, setCheckingToken] = useState(false);
  const [tokenError, setTokenError] = useState('');
  const [warningsOpen, setWarningsOpen] = useState(false);
  const sourceState = sourceModeState(mode, liveUnlocked, uploadedState, canExport);

  useEffect(() => {
    setToken(getStoredAdminToken());
    setTokenError('');
  }, [desktopConnectionAvailable]);

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
    <KuSurface className="overflow-hidden" role="region" aria-label="데이터 소스">
      <div className="grid gap-3 p-3 lg:p-4 2xl:grid-cols-[minmax(0,1fr)_auto] 2xl:items-center">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
          <KuSegmentedControl
            ariaLabel="토폴로지 소스"
            className="w-full grid-cols-3 sm:w-auto"
            options={modeOptions}
            value={mode}
            onChange={onModeChange}
          />

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <KuButton type="button" onPress={() => uploadInputRef.current?.click()}>
              <FileArchive size={16} aria-hidden="true" />
              YAML/ZIP
            </KuButton>
            <KuButton type="button" onPress={() => importInputRef.current?.click()}>
              <FileJson size={16} aria-hidden="true" />
              가져오기
            </KuButton>
            <KuButton type="button" disabled={!canExport} onPress={onExportJson}>
              <Download size={16} aria-hidden="true" />
              내보내기
            </KuButton>
            <UploadSummary uploadedState={uploadedState} uploadError={uploadError} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {liveUnlocked ? (
            <KuChip className="border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]">
              <CheckCircle2 size={13} aria-hidden="true" />
              {mode === 'live' ? '실시간 연결됨' : '실시간 인증 준비됨'}
            </KuChip>
          ) : (
            <label className="relative min-w-0 sm:w-[260px]">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.46)]" size={15} aria-hidden="true" />
              <KuInput
                className="h-9 w-full pl-9 pr-3"
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
            <KuButton type="button" onPress={handleLiveLock}>
              <LockKeyhole size={16} aria-hidden="true" />
              실시간 잠금
            </KuButton>
          ) : (
            <KuButton data-testid="unlock-live" type="button" disabled={checkingToken} tone="primary" onPress={() => void handleLiveUnlock()}>
              <Server size={16} aria-hidden="true" />
              {checkingToken ? '확인 중' : '실시간 연결'}
            </KuButton>
          )}
          {tokenError ? (
            <KuChip className="border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]" title={tokenError}>
              <AlertTriangle size={13} aria-hidden="true" />
              {shortError(tokenError)}
            </KuChip>
          ) : liveSessionMessage ? (
            <KuChip className="border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]" title={liveSessionMessage}>
              <AlertTriangle size={13} aria-hidden="true" />
              {liveSessionMessage}
            </KuChip>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2 border-t border-[rgba(60,60,67,0.08)] bg-white/35 px-3 py-2 sm:grid-cols-3 lg:px-4">
        {sourceState.map((item) => (
          <div key={item.label} className="ku-source-state-item">
            <span className={`h-2.5 w-2.5 rounded-full ${item.tone}`} aria-hidden="true" />
            <div className="min-w-0">
              <p className="ku-meta">{item.label}</p>
              <p className="truncate text-sm font-semibold text-[var(--ku-text)]">{item.value}</p>
            </div>
          </div>
        ))}
      </div>

      {mode === 'upload' ? (
        <div className="grid gap-3 border-t border-[rgba(60,60,67,0.1)] bg-white/45 px-3 py-3 md:grid-cols-[minmax(160px,240px)_minmax(160px,240px)_minmax(0,1fr)] lg:px-4">
          <label className="min-w-0">
            <span className="ku-meta">Cluster name</span>
            <KuInput
              className="mt-1 h-9 w-full"
              data-testid="upload-cluster-name"
              placeholder="uploaded-bundle"
              value={uploadClusterName}
              onChange={(event) => onUploadClusterNameChange(event.target.value)}
            />
          </label>
          <label className="min-w-0">
            <span className="ku-meta">Cluster id</span>
            <KuInput
              className="mt-1 h-9 w-full font-mono"
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
        <Suspense fallback={<div className="border-t border-[rgba(60,60,67,0.12)] px-4 py-3 text-sm font-semibold">Desktop CM session UI 불러오는 중</div>}>
          <DesktopCmSessionPanel
            message={desktopCmSessionMessage}
            runtimeProfile={desktopCmRuntimeProfile}
            sessions={desktopCmSessions}
            onDeleteSession={onDesktopCmSessionDelete}
            onDeleteSessionCredential={onDesktopCmSessionCredentialDelete}
            onCheckSession={onDesktopCmSessionCheck}
            onImportPrivateKey={onDesktopCmSessionPrivateKeyImport}
            onCheckSessionRuntime={onDesktopCmSessionRuntimeCheck}
            onStartSessionRuntime={onDesktopCmSessionRuntimeStart}
            onStopSessionRuntime={onDesktopCmSessionRuntimeStop}
            onSaveSession={onDesktopCmSessionSave}
            onSelectSession={onDesktopCmSessionSelect}
          />
        </Suspense>
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
    </KuSurface>
  );
}

function UploadSummary({ uploadedState, uploadError }: { uploadedState: UploadedTopologyState | null; uploadError: string }) {
  if (uploadError) {
    return (
      <KuChip className="border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]" title={uploadError}>
        <AlertTriangle size={13} aria-hidden="true" />
        업로드 오류
      </KuChip>
    );
  }

  if (!uploadedState) {
    return <KuChip>업로드 없음</KuChip>;
  }

  const warningCount = uploadedState.warnings.length;
  return (
    <KuChip className={warningCount ? 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]' : ''} title={uploadedState.warnings.slice(0, 3).join('\n')}>
      {warningCount ? <AlertTriangle size={13} aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />}
      리소스 {uploadedState.snapshot.nodes.length}개 · 파일 {uploadedState.files.length}개 · 경고 {warningCount}개
    </KuChip>
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
      <KuButton
        className={`h-9 max-w-full ${
          warnings.length ? 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]' : 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]'
        }`}
        data-testid="upload-warning-toggle"
        type="button"
        aria-expanded={open}
        onPress={onToggle}
      >
        {warnings.length ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
        <span className="truncate">{warnings.length ? `업로드 진단 ${warnings.length}개` : '업로드 진단 정상'}</span>
        <ChevronDown className={`shrink-0 transition ${open ? 'rotate-180' : ''}`} size={14} aria-hidden="true" />
      </KuButton>

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

function sourceModeState(mode: TopologySourceMode, liveUnlocked: boolean, uploadedState: UploadedTopologyState | null, canExport: boolean) {
  const sourceValue = mode === 'live' ? (liveUnlocked ? '실시간 연결' : '실시간 잠김') : mode === 'mock' ? '목업 데모' : 'YAML 업로드';
  const dataValue = uploadedState
    ? `${uploadedState.files.length} files · ${uploadedState.warnings.length} warnings`
    : mode === 'mock'
      ? '샘플 그래프'
      : mode === 'live'
        ? '클러스터 API'
        : '대기';

  return [
    { label: 'Source', value: sourceValue, tone: mode === 'live' && !liveUnlocked ? 'bg-[#ff9500]' : 'bg-[#267aff]' },
    { label: 'Dataset', value: dataValue, tone: uploadedState?.warnings.length ? 'bg-[#ff9500]' : 'bg-[#28b853]' },
    { label: 'Export', value: canExport ? '가능' : '데이터 없음', tone: canExport ? 'bg-[#36cfe2]' : 'bg-[rgba(60,60,67,0.28)]' },
  ];
}
