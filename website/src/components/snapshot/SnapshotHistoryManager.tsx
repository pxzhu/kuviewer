import { useEffect, useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import type { SnapshotHistoryEntry } from '../../features/snapshot/snapshotHistory';
import { formatLastSync } from '../../utils/formatTime';

export function SnapshotHistoryManager({
  baselineId,
  currentId,
  history,
  onDelete,
  onRename,
}: {
  baselineId: string;
  currentId: string;
  history: SnapshotHistoryEntry[];
  onDelete: (id: string) => void;
  onRename: (id: string, label: string) => void;
}) {
  const [editingId, setEditingId] = useState('');
  const [draftLabel, setDraftLabel] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState('');
  const [renameError, setRenameError] = useState('');

  useEffect(() => {
    const ids = new Set(history.map((entry) => entry.id));
    if (editingId && !ids.has(editingId)) {
      setEditingId('');
      setDraftLabel('');
      setRenameError('');
    }
    if (confirmDeleteId && !ids.has(confirmDeleteId)) {
      setConfirmDeleteId('');
    }
  }, [confirmDeleteId, editingId, history]);

  const startRename = (entry: SnapshotHistoryEntry) => {
    setEditingId(entry.id);
    setDraftLabel(entry.label);
    setRenameError('');
    setConfirmDeleteId('');
  };

  const saveRename = () => {
    const label = draftLabel.trim().slice(0, 80);
    if (!label) {
      setRenameError('이름을 입력해 주세요.');
      return;
    }
    onRename(editingId, label);
    setEditingId('');
    setDraftLabel('');
    setRenameError('');
  };

  return (
    <details className="border-b border-[rgba(60,60,67,0.12)] px-4 py-2" data-testid="snapshot-history-manager">
      <summary className="cursor-pointer select-none text-xs font-semibold text-[#0057b8]">기록 관리 · {history.length}개</summary>
      <div className="mt-2 divide-y divide-[rgba(60,60,67,0.08)] border-y border-[rgba(60,60,67,0.10)]">
        {history.map((entry) => {
          const editing = editingId === entry.id;
          const confirmingDelete = confirmDeleteId === entry.id;
          return (
            <div key={entry.id} className="flex min-w-0 flex-col gap-2 px-1 py-2 sm:flex-row sm:items-center" data-testid="snapshot-history-row">
              <div className="min-w-0 flex-1">
                {editing ? (
                  <input
                    className="ku-input w-full"
                    value={draftLabel}
                    maxLength={80}
                    aria-label="Snapshot 기록 이름"
                    data-testid="snapshot-history-rename-input"
                    onChange={(event) => {
                      setDraftLabel(event.target.value);
                      setRenameError('');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        saveRename();
                      }
                      if (event.key === 'Escape') {
                        setEditingId('');
                        setRenameError('');
                      }
                    }}
                  />
                ) : (
                  <p className="truncate text-sm font-semibold text-[#1d1d1f]" title={entry.label}>{entry.label}</p>
                )}
                <p className="ku-meta mt-1">
                  {entry.snapshot.nodes.length} resources · {entry.origin === 'import' ? 'import' : 'capture'} · {formatLastSync(entry.capturedAt)}
                  {entry.id === baselineId ? ' · 기준' : ''}{entry.id === currentId ? ' · 비교 대상' : ''}
                </p>
                {editing && renameError ? <p className="mt-1 text-xs font-semibold text-[#c9342f]">{renameError}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {editing ? (
                  <>
                    <button className="ku-icon-button" type="button" title="이름 저장" aria-label="이름 저장" data-testid="snapshot-history-rename-save" onClick={saveRename}>
                      <Check size={14} aria-hidden="true" />
                    </button>
                    <button className="ku-icon-button" type="button" title="이름 변경 취소" aria-label="이름 변경 취소" onClick={() => { setEditingId(''); setRenameError(''); }}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <button className="ku-icon-button" type="button" title="기록 이름 변경" aria-label={`${entry.label} 이름 변경`} data-testid="snapshot-history-rename" onClick={() => startRename(entry)}>
                    <Pencil size={14} aria-hidden="true" />
                  </button>
                )}
                <button
                  className={`ku-control ${confirmingDelete ? 'border-[#c9342f] text-[#c9342f]' : ''}`}
                  type="button"
                  aria-label={confirmingDelete ? `${entry.label} 삭제 확인` : `${entry.label} 삭제`}
                  data-testid="snapshot-history-delete"
                  onClick={() => {
                    if (confirmingDelete) {
                      onDelete(entry.id);
                      setConfirmDeleteId('');
                      return;
                    }
                    setConfirmDeleteId(entry.id);
                    setEditingId('');
                    setRenameError('');
                  }}
                >
                  <Trash2 size={13} aria-hidden="true" />
                  {confirmingDelete ? '삭제 확인' : '삭제'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="ku-meta mt-2">이름과 관리 상태는 저장하거나 동기화하지 않습니다.</p>
    </details>
  );
}
