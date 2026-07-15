import { useRef, useState } from 'react';
import { Camera, FileSearch, FileUp, GitCompareArrows, Trash2 } from 'lucide-react';
import { importSnapshotDiffFile, type ImportedSnapshotDiff } from '../../features/snapshot/importSnapshotDiff';
import type { SnapshotHistoryEntry } from '../../features/snapshot/snapshotHistory';
import { formatLastSync } from '../../utils/formatTime';
import { SnapshotDiffImportPreview } from './SnapshotDiffImportPreview';
import { SnapshotHistoryManager } from './SnapshotHistoryManager';

interface SnapshotHistoryControlsProps {
  baselineId: string;
  canCaptureCurrent: boolean;
  currentId: string;
  history: SnapshotHistoryEntry[];
  liveCurrentLabel: string;
  onCapture: () => void;
  onClearHistory: () => void;
  onDeleteHistory: (id: string) => void;
  onImportBaseline: (file: File) => Promise<void>;
  onRenameHistory: (id: string, label: string) => void;
  onSelectBaseline: (id: string) => void;
  onSelectCurrent: (id: string) => void;
}

export function SnapshotHistoryControls({
  baselineId,
  canCaptureCurrent,
  currentId,
  history,
  liveCurrentLabel,
  onCapture,
  onClearHistory,
  onDeleteHistory,
  onImportBaseline,
  onRenameHistory,
  onSelectBaseline,
  onSelectCurrent,
}: SnapshotHistoryControlsProps) {
  const baselineFileInputRef = useRef<HTMLInputElement>(null);
  const diffFileInputRef = useRef<HTMLInputElement>(null);
  const [baselineImportError, setBaselineImportError] = useState('');
  const [diffImportError, setDiffImportError] = useState('');
  const [importedDiff, setImportedDiff] = useState<{ fileName: string; report: ImportedSnapshotDiff } | null>(null);

  const handleBaselineImport = async (file?: File) => {
    if (!file) {
      return;
    }
    setBaselineImportError('');
    try {
      await onImportBaseline(file);
    } catch {
      setBaselineImportError('유효한 Kuviewer topology JSON을 선택해 주세요.');
    } finally {
      if (baselineFileInputRef.current) {
        baselineFileInputRef.current.value = '';
      }
    }
  };

  const handleDiffImport = async (file?: File) => {
    if (!file) {
      return;
    }
    setDiffImportError('');
    try {
      setImportedDiff({ fileName: file.name.slice(0, 160), report: await importSnapshotDiffFile(file) });
    } catch {
      setImportedDiff(null);
      setDiffImportError('지원하는 Kuviewer diff JSON만 불러올 수 있습니다.');
    } finally {
      if (diffFileInputRef.current) {
        diffFileInputRef.current.value = '';
      }
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-[rgba(60,60,67,0.12)] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <GitCompareArrows size={17} aria-hidden="true" />
            <h2 className="text-sm font-semibold text-[#1d1d1f]">스냅샷 비교</h2>
          </div>
          <p className="ku-meta mt-1">최대 8개 기록과 선택 상태는 현재 브라우저 메모리에만 보관됩니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="ku-control" type="button" disabled={!canCaptureCurrent} onClick={onCapture} data-testid="snapshot-compare-capture">
            <Camera size={15} aria-hidden="true" />
            현재 기록
          </button>
          <button className="ku-control" type="button" onClick={() => baselineFileInputRef.current?.click()}>
            <FileUp size={15} aria-hidden="true" />
            기준 JSON 불러오기
          </button>
          <input
            ref={baselineFileInputRef}
            className="hidden"
            type="file"
            accept="application/json,.json"
            data-testid="snapshot-baseline-import-input"
            onChange={(event) => void handleBaselineImport(event.target.files?.[0])}
          />
          <button className="ku-control" type="button" onClick={() => diffFileInputRef.current?.click()} data-testid="snapshot-diff-import-button">
            <FileSearch size={15} aria-hidden="true" />
            Diff JSON 검증
          </button>
          <input
            ref={diffFileInputRef}
            className="hidden"
            type="file"
            accept="application/json,.json"
            data-testid="snapshot-diff-import-input"
            onChange={(event) => void handleDiffImport(event.target.files?.[0])}
          />
          {history.length > 0 ? (
            <button className="ku-control" type="button" onClick={onClearHistory} data-testid="snapshot-history-clear">
              <Trash2 size={15} aria-hidden="true" />
              기록 모두 지우기
            </button>
          ) : null}
        </div>
      </div>

      {importedDiff ? (
        <SnapshotDiffImportPreview fileName={importedDiff.fileName} report={importedDiff.report} onClose={() => setImportedDiff(null)} />
      ) : null}
      {diffImportError ? <p className="border-b border-[rgba(60,60,67,0.12)] px-4 py-2 text-sm font-semibold text-[#b26a00]" data-testid="snapshot-diff-import-error">{diffImportError}</p> : null}

      {history.length > 0 ? (
        <div className="grid gap-3 border-b border-[rgba(60,60,67,0.12)] px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end" data-testid="snapshot-history-selector">
          <label className="min-w-0">
            <span className="ku-meta mb-1 block">기준 기록</span>
            <select
              className="ku-input w-full"
              value={baselineId}
              data-testid="snapshot-compare-baseline-select"
              onChange={(event) => {
                const nextId = event.target.value;
                onSelectBaseline(nextId);
                if (nextId === currentId) {
                  onSelectCurrent('');
                }
              }}
            >
              <option value="">기준 선택</option>
              {history.map((entry) => <SnapshotHistoryOption key={entry.id} entry={entry} />)}
            </select>
          </label>
          <label className="min-w-0">
            <span className="ku-meta mb-1 block">비교 대상</span>
            <select
              className="ku-input w-full"
              value={currentId}
              data-testid="snapshot-compare-current-select"
              onChange={(event) => onSelectCurrent(event.target.value)}
            >
              <option value="">현재 화면 · {liveCurrentLabel}</option>
              {history.map((entry) => <SnapshotHistoryOption key={entry.id} entry={entry} disabled={entry.id === baselineId} />)}
            </select>
          </label>
          <p className="ku-meta pb-2" data-testid="snapshot-history-count">기록 {history.length} / 8</p>
        </div>
      ) : null}
      {history.length > 0 ? (
        <SnapshotHistoryManager
          baselineId={baselineId}
          currentId={currentId}
          history={history}
          onDelete={onDeleteHistory}
          onRename={onRenameHistory}
        />
      ) : null}
      {baselineImportError ? <p className="px-4 py-2 text-sm font-semibold text-[#b26a00]" data-testid="snapshot-baseline-import-error">{baselineImportError}</p> : null}
    </>
  );
}

function SnapshotHistoryOption({ entry, disabled = false }: { entry: SnapshotHistoryEntry; disabled?: boolean }) {
  return (
    <option value={entry.id} disabled={disabled}>
      {entry.label} · {entry.snapshot.nodes.length} resources · {formatLastSync(entry.capturedAt)}
    </option>
  );
}
