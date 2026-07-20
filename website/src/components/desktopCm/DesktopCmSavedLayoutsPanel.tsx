import type { Ref } from 'react';
import { Bookmark, Download, Folder, Search, Trash2, Upload, XCircle } from 'lucide-react';
import {
  defaultDesktopCmSessionLayoutFolder,
  maxDesktopCmSessionLayoutFolderNameLength,
  maxDesktopCmSessionLayoutPresetNameLength,
  maxDesktopCmSessionLayoutPresets,
  type DesktopCmSessionLayoutFolderFilterOption,
} from '../../features/desktop/desktopCmSessionLayouts';
import {
  DesktopCmLayoutConflictPanel,
  type DesktopCmSessionLayoutConflictResolution,
  type DesktopCmSessionLayoutImportConflictPreview,
} from './DesktopCmLayoutConflictPanel';
import {
  DesktopCmLayoutList,
  desktopCmSessionLayoutReorderDisabledReasonId,
  type DesktopCmLayoutListActions,
  type DesktopCmLayoutListProps,
} from './DesktopCmLayoutList';

interface DesktopCmSavedLayoutsPanelActions {
  onPresetNameChange: (value: string) => void;
  onPresetFolderChange: (value: string) => void;
  onPresetFolderBlur: (value: string) => void;
  onSearchQueryChange: (value: string) => void;
  onFolderFilterChange: (value: string) => void;
  onSave: () => void;
  onSelectVisible: () => void;
  onClearSelection: () => void;
  onExport: () => void;
  onImport: (file: File | null) => void;
  onBulkFolderChange: (value: string) => void;
  onMoveSelectedToFolder: () => void;
  onExportSelected: () => void;
  onDeleteSelected: () => void;
  onResolveConflicts: (mode: DesktopCmSessionLayoutConflictResolution, conflictName?: string) => void;
}

interface DesktopCmSavedLayoutsPanelProps {
  importInputRef: Ref<HTMLInputElement>;
  listRef: Ref<HTMLDivElement>;
  presetName: string;
  presetFolder: string;
  searchQuery: string;
  folderFilter: string;
  folderFilterOptions: DesktopCmSessionLayoutFolderFilterOption[];
  presetCount: number;
  visiblePresetCount: number;
  searchActive: boolean;
  folderFilterActive: boolean;
  reorderUnavailableReason: string;
  reorderStateLabel: string;
  selectedCount: number;
  selectedVisibleCount: number;
  bulkFolderName: string;
  bulkDeleteConfirm: boolean;
  busyAction: string;
  importConflicts: DesktopCmSessionLayoutImportConflictPreview | null;
  listProps: Omit<DesktopCmLayoutListProps, 'actions'>;
  listActions: DesktopCmLayoutListActions;
  actions: DesktopCmSavedLayoutsPanelActions;
}

export function DesktopCmSavedLayoutsPanel(props: DesktopCmSavedLayoutsPanelProps) {
  const { actions } = props;
  const importing = props.busyAction === 'import-session-layouts';

  return (
    <div
      className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.1)] bg-white/68 px-3 py-2"
      data-testid="desktop-cm-session-saved-layouts"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="ku-meta">Saved session layouts</span>
        <label className="min-w-[180px] flex-1">
          <input
            className="ku-field h-9 w-full"
            data-testid="desktop-cm-session-layout-name"
            maxLength={maxDesktopCmSessionLayoutPresetNameLength}
            placeholder={`Layout ${props.presetCount + 1}`}
            value={props.presetName}
            onChange={(event) => actions.onPresetNameChange(event.target.value)}
          />
        </label>
        <label className="min-w-[150px] flex-1">
          <input
            className="ku-field h-9 w-full"
            data-testid="desktop-cm-session-layout-folder"
            maxLength={maxDesktopCmSessionLayoutFolderNameLength}
            placeholder="Folder"
            value={props.presetFolder}
            onChange={(event) => actions.onPresetFolderChange(event.target.value)}
            onBlur={(event) => actions.onPresetFolderBlur(event.currentTarget.value)}
          />
        </label>
        <label className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.48)]" size={15} aria-hidden="true" />
          <input
            className="ku-field h-9 w-full pl-9 pr-3"
            data-testid="desktop-cm-session-layout-search"
            placeholder="layout 검색"
            value={props.searchQuery}
            onChange={(event) => actions.onSearchQueryChange(event.target.value)}
          />
        </label>
        <label className="min-w-[160px] flex-1">
          <select className="ku-field h-9 w-full" data-testid="desktop-cm-session-layout-folder-filter" value={props.folderFilter} onChange={(event) => actions.onFolderFilterChange(event.target.value)}>
            <option value="all">전체 folder</option>
            {props.folderFilterOptions.map((option) => <option key={option.folder} value={option.folder}>{option.folder} ({option.count})</option>)}
          </select>
        </label>
        <button className="ku-control h-9" data-testid="desktop-cm-session-layout-save" type="button" onClick={actions.onSave}>
          <Bookmark size={14} aria-hidden="true" />현재 layout 저장
        </button>
        <span className="ku-chip" data-testid="desktop-cm-session-layout-count">{props.presetCount} / {maxDesktopCmSessionLayoutPresets}</span>
        <span className="ku-chip" data-testid="desktop-cm-session-layout-search-count">결과 {props.visiblePresetCount} / 전체 {props.presetCount}</span>
        <span className="ku-chip" data-testid="desktop-cm-session-layout-folder-filter-count">Folder {props.folderFilterActive ? props.folderFilter : '전체'}</span>
        <span
          aria-live="polite"
          className={`ku-chip ${props.reorderUnavailableReason ? 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]' : ''}`}
          data-testid="desktop-cm-session-layout-reorder-state"
          id={desktopCmSessionLayoutReorderDisabledReasonId}
          role="status"
          title={props.reorderStateLabel}
        >
          {props.reorderUnavailableReason ? '순서 변경 비활성' : 'folder/preset 순서 변경 가능'}
        </span>
        <button className="ku-control h-9" data-testid="desktop-cm-session-layout-search-clear" type="button" disabled={!props.searchActive} onClick={() => actions.onSearchQueryChange('')}>
          <XCircle size={14} aria-hidden="true" />검색 초기화
        </button>
        <button className="ku-control h-9" data-testid="desktop-cm-session-layout-folder-filter-clear" type="button" disabled={!props.folderFilterActive} onClick={() => actions.onFolderFilterChange('all')}>
          <XCircle size={14} aria-hidden="true" />Folder 필터 초기화
        </button>
        <button className="ku-control h-9" data-testid="desktop-cm-session-layout-bulk-select-visible" type="button" disabled={props.visiblePresetCount === 0} onClick={actions.onSelectVisible}>현재 layout 선택</button>
        <button className="ku-control h-9" data-testid="desktop-cm-session-layout-bulk-clear" type="button" disabled={props.selectedCount === 0} onClick={actions.onClearSelection}>선택 해제</button>
        <button className="ku-control h-9" data-testid="desktop-cm-session-layout-export" type="button" disabled={props.presetCount === 0 || importing} onClick={actions.onExport}>
          <Download size={14} aria-hidden="true" />layout export
        </button>
        <label className={`ku-control h-9 ${importing ? 'opacity-60' : ''}`} data-testid="desktop-cm-session-layout-import-label">
          <Upload size={14} aria-hidden="true" />layout import
          <input
            ref={props.importInputRef}
            className="hidden"
            data-testid="desktop-cm-session-layout-import"
            type="file"
            accept="application/json,.json"
            disabled={importing}
            onChange={(event) => actions.onImport(event.currentTarget.files?.[0] || null)}
          />
        </label>
      </div>
      {props.selectedCount > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-[10px] border border-[rgba(0,122,255,0.14)] bg-[rgba(0,122,255,0.06)] px-3 py-2" data-testid="desktop-cm-session-layout-bulk-toolbar">
          <span className="ku-chip border-[rgba(0,122,255,0.18)] bg-white/65 text-[#0066cc]" data-testid="desktop-cm-session-layout-bulk-count">선택 {props.selectedCount}개 · 현재 결과 {props.selectedVisibleCount}개</span>
          <label className="min-w-[150px] flex-1">
            <span className="ku-meta">Bulk folder</span>
            <input
              className="ku-field mt-1 h-8 w-full text-xs"
              data-testid="desktop-cm-session-layout-bulk-folder-input"
              maxLength={maxDesktopCmSessionLayoutFolderNameLength}
              placeholder={defaultDesktopCmSessionLayoutFolder}
              value={props.bulkFolderName}
              onChange={(event) => actions.onBulkFolderChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') actions.onMoveSelectedToFolder();
              }}
            />
          </label>
          <button className="ku-control h-8 self-end text-xs" data-testid="desktop-cm-session-layout-bulk-folder-apply" type="button" onClick={actions.onMoveSelectedToFolder}>
            <Folder size={13} aria-hidden="true" />Folder 이동
          </button>
          <button className="ku-control h-8 text-xs" data-testid="desktop-cm-session-layout-bulk-export" type="button" disabled={importing} onClick={actions.onExportSelected}>
            <Download size={13} aria-hidden="true" />선택 export
          </button>
          <button className={`ku-control h-8 text-xs ${props.bulkDeleteConfirm ? 'border-[rgba(255,59,48,0.28)] bg-[rgba(255,59,48,0.1)] text-[#b42318]' : ''}`} data-testid="desktop-cm-session-layout-bulk-delete" type="button" onClick={actions.onDeleteSelected}>
            <Trash2 size={13} aria-hidden="true" />{props.bulkDeleteConfirm ? '선택 삭제 확인' : '선택 삭제'}
          </button>
          <button className="ku-control h-8 text-xs" data-testid="desktop-cm-session-layout-bulk-clear-toolbar" type="button" onClick={actions.onClearSelection}>선택 해제</button>
        </div>
      ) : null}
      {props.importConflicts ? <DesktopCmLayoutConflictPanel preview={props.importConflicts} onResolve={actions.onResolveConflicts} /> : null}
      <DesktopCmLayoutList ref={props.listRef} {...props.listProps} actions={props.listActions} />
    </div>
  );
}
