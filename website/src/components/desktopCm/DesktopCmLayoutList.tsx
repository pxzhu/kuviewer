import {
  forwardRef,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Filter,
  Folder,
  GripVertical,
  Pencil,
  Search,
  XCircle,
} from 'lucide-react';
import {
  formatDesktopCmSessionLayoutSummary,
  maxDesktopCmSessionLayoutFolderNameLength,
  maxDesktopCmSessionLayoutPresetNameLength,
  type DesktopCmSessionLayoutFolder,
  type DesktopCmSessionLayoutPreset,
} from '../../features/desktop/desktopCmSessionLayouts';
import { slugifyDesktopCmTestId } from '../../features/desktop/desktopCmReorder';

export const desktopCmSessionLayoutReorderDisabledReasonId = 'desktop-cm-session-layout-reorder-disabled-reason';

const folderListTitleId = 'desktop-cm-session-layout-folder-list-title';
const folderKeyboardDescriptionId = 'desktop-cm-session-layout-folder-keyboard-description';
const folderKeyboardLiveStatusId = 'desktop-cm-session-layout-folder-keyboard-live-status';
const reorderKeyboardDescriptionId = 'desktop-cm-session-layout-reorder-keyboard-description';
const reorderKeyboardStatusId = 'desktop-cm-session-layout-reorder-keyboard-status';
const reorderDisabledDescriptionId = 'desktop-cm-session-layout-reorder-disabled-description';
const reorderFocusDescriptionId = 'desktop-cm-session-layout-reorder-focus-description';
const reorderFocusStatusId = 'desktop-cm-session-layout-reorder-focus-status';

type ReorderDirection = -1 | 1 | 'first' | 'last';

export interface DesktopCmLayoutListActions {
  onListKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onSetActiveFolder: (folder: string) => void;
  onSetDraggingFolder: (folder: string) => void;
  onDropFolder: (folder: string, event: DragEvent<HTMLDivElement>) => void;
  onFolderReorderKeyDown: (folder: string, event: KeyboardEvent<HTMLButtonElement>) => void;
  onMoveFolder: (folder: string, direction: ReorderDirection) => void;
  onToggleFolder: (folder: string) => void;
  onFolderRenameDraftChange: (value: string) => void;
  onSaveFolderRename: () => void;
  onCancelFolderRename: () => void;
  onSelectFolderPresets: (folder: string) => void;
  onStartFolderRename: (folder: string) => void;
  onSetDraggingPreset: (preset: string) => void;
  onDropPreset: (preset: string, event: DragEvent<HTMLSpanElement>) => void;
  onPresetReorderKeyDown: (preset: string, event: KeyboardEvent<HTMLButtonElement>) => void;
  onMovePreset: (preset: string, direction: ReorderDirection) => void;
  onPresetRenameDraftChange: (value: string) => void;
  onClearPresetRenameError: () => void;
  onPresetRenameKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSavePresetRename: () => void;
  onCancelPresetRename: () => void;
  onTogglePresetSelection: (preset: string, checked: boolean) => void;
  onApplyPreset: (preset: DesktopCmSessionLayoutPreset) => void;
  onUpdatePresetFolder: (preset: string, folder: string) => void;
  onStartPresetRename: (preset: DesktopCmSessionLayoutPreset) => void;
  onDuplicatePreset: (preset: DesktopCmSessionLayoutPreset) => void;
  onDeletePreset: (preset: string) => void;
}

interface DesktopCmLayoutListProps {
  presetCount: number;
  folders: DesktopCmSessionLayoutFolder[];
  activeFolderName: string;
  activePresetName: string;
  selectedPresetNames: Set<string>;
  draggingFolderName: string;
  draggingPresetName: string;
  folderRenameTarget: string;
  folderRenameDraft: string;
  presetRenameTarget: string;
  presetRenameDraft: string;
  presetRenameError: string;
  canReorderFolders: boolean;
  canReorderPresets: boolean;
  filteredEmpty: boolean;
  filteredEmptyLabel: string;
  searchActive: boolean;
  searchQuery: string;
  folderFilterActive: boolean;
  folderFilter: string;
  folderKeyboardLiveText: string;
  reorderKeyboardLiveText: string;
  reorderFocusLiveText: string;
  folderDisabledReason: (folder: string, direction?: 'up' | 'down') => string;
  presetDisabledReason: (preset: string, folder: string, direction?: 'up' | 'down') => string;
  actions: DesktopCmLayoutListActions;
}

export const DesktopCmLayoutList = forwardRef<HTMLDivElement, DesktopCmLayoutListProps>(function DesktopCmLayoutList(
  props,
  ref,
) {
  if (props.presetCount === 0) {
    return (
      <>
        <div
          className="flex min-w-0 flex-wrap items-center gap-2 rounded-[8px] border border-dashed border-[rgba(60,60,67,0.14)] bg-white/52 px-3 py-2 text-xs font-semibold text-[rgba(60,60,67,0.62)]"
          data-testid="desktop-cm-session-layout-empty"
          role="status"
        >
          <Folder size={13} aria-hidden="true" />
          <span>저장된 session layout 없음</span>
          <span className="font-mono text-[11px]">현재 layout 저장 후 folder별로 표시됨</span>
        </div>
        <LayoutStoragePolicy />
      </>
    );
  }

  const activeFolder = props.folders.find((folder) => folder.folder === props.activeFolderName);
  const describedBy = `${folderKeyboardDescriptionId} ${reorderKeyboardDescriptionId} ${reorderDisabledDescriptionId} ${desktopCmSessionLayoutReorderDisabledReasonId} ${reorderFocusDescriptionId} ${folderKeyboardLiveStatusId} ${reorderKeyboardStatusId} ${reorderFocusStatusId}`;

  return (
    <>
      <p className="sr-only" data-testid="desktop-cm-session-layout-folder-list-title" id={folderListTitleId}>Saved session layout folders</p>
      <p className="sr-only" data-testid="desktop-cm-session-layout-folder-keyboard-description" id={folderKeyboardDescriptionId}>
        Saved layout folder keyboard state is browser memory only. Use arrow keys, Home, End, Enter, S, R, and Escape when this folder list has focus. Shift plus arrow keys, Home, or End reorders the active folder when search and folder filters are clear.
      </p>
      <p className="sr-only" data-testid="desktop-cm-session-layout-reorder-keyboard-description" id={reorderKeyboardDescriptionId}>
        Reorder keyboard state is browser memory only. Focus a folder or layout drag handle and use ArrowUp, ArrowDown, Home, or End to reorder without adding saved fields.
      </p>
      <p className="sr-only" data-testid="desktop-cm-session-layout-reorder-disabled-description" id={reorderDisabledDescriptionId}>
        Disabled reorder controls explain whether search, folder filter, item edge position, or not enough folders and presets prevents reordering.
      </p>
      <p className="sr-only" data-testid="desktop-cm-session-layout-reorder-focus-description" id={reorderFocusDescriptionId}>
        After a layout folder or preset reorder, focus returns to the moved drag handle or the saved layout folder list without scrolling the panel.
      </p>
      <p aria-atomic="true" aria-live="polite" className="sr-only" data-testid="desktop-cm-session-layout-folder-keyboard-live-status" id={folderKeyboardLiveStatusId} role="status">{props.folderKeyboardLiveText}</p>
      <p aria-atomic="true" aria-live="polite" className="sr-only" data-testid="desktop-cm-session-layout-reorder-keyboard-status" id={reorderKeyboardStatusId} role="status">{props.reorderKeyboardLiveText}</p>
      <p aria-atomic="true" aria-live="polite" className="sr-only" data-testid="desktop-cm-session-layout-reorder-focus-status" id={reorderFocusStatusId} role="status">{props.reorderFocusLiveText}</p>
      <div
        ref={ref}
        aria-activedescendant={activeFolder ? `desktop-cm-session-layout-folder-row-${activeFolder.slug}` : undefined}
        aria-describedby={describedBy}
        aria-keyshortcuts="ArrowUp ArrowDown Home End Enter S R Escape Shift+ArrowUp Shift+ArrowDown Shift+Home Shift+End"
        aria-labelledby={folderListTitleId}
        className="grid min-w-0 gap-2 outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,122,255,0.22)]"
        data-testid="desktop-cm-session-layout-list"
        onKeyDown={props.actions.onListKeyDown}
        role="list"
        tabIndex={0}
      >
        {props.folders.map((folder, folderIndex) => (
          <DesktopCmLayoutFolderRow
            key={folder.folder}
            {...props}
            folder={folder}
            folderIndex={folderIndex}
            folderCount={props.folders.length}
          />
        ))}
        {props.filteredEmpty ? (
          <div
            className="flex min-w-0 flex-wrap items-center gap-2 rounded-[8px] border border-dashed border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.05)] px-3 py-2 text-xs font-semibold text-[rgba(60,60,67,0.68)]"
            data-testid={props.folderFilterActive ? 'desktop-cm-session-layout-filter-empty' : 'desktop-cm-session-layout-search-empty'}
            role="status"
          >
            <Filter size={13} aria-hidden="true" />
            <span>{props.filteredEmptyLabel}</span>
            <span className="font-mono text-[11px]">
              search={props.searchActive ? props.searchQuery.trim() : 'all'} · folder={props.folderFilterActive ? props.folderFilter : 'all'}
            </span>
          </div>
        ) : null}
      </div>
      <LayoutStoragePolicy />
    </>
  );
});

interface FolderRowProps extends DesktopCmLayoutListProps {
  folder: DesktopCmSessionLayoutFolder;
  folderIndex: number;
  folderCount: number;
}

function DesktopCmLayoutFolderRow(props: FolderRowProps) {
  const { folder, actions } = props;
  const active = props.activeFolderName === folder.folder;
  const titleId = `desktop-cm-session-layout-folder-title-${folder.slug}`;
  const countId = `desktop-cm-session-layout-folder-a11y-count-${folder.slug}`;
  const actionsId = `desktop-cm-session-layout-folder-actions-${folder.slug}`;
  const itemsId = `desktop-cm-session-layout-folder-items-${folder.slug}`;
  const canMoveUp = props.canReorderFolders && props.folderIndex > 0;
  const canMoveDown = props.canReorderFolders && props.folderIndex < props.folderCount - 1;
  const renaming = props.folderRenameTarget === folder.folder;

  return (
    <div
      aria-current={active ? 'true' : undefined}
      aria-describedby={`${countId} ${actionsId}`}
      aria-labelledby={titleId}
      className={`grid gap-2 rounded-[8px] border px-2 py-2 transition ${props.draggingFolderName === folder.folder ? 'opacity-60' : ''} ${active ? 'border-[rgba(0,122,255,0.34)] bg-white/82 shadow-[0_0_0_2px_rgba(0,122,255,0.1)]' : 'border-[rgba(60,60,67,0.08)] bg-white/56'}`}
      data-testid={`desktop-cm-session-layout-folder-${folder.slug}`}
      id={`desktop-cm-session-layout-folder-row-${folder.slug}`}
      onClick={() => actions.onSetActiveFolder(folder.folder)}
      onDragOver={(event) => {
        if (props.canReorderFolders) event.preventDefault();
      }}
      onDrop={(event) => actions.onDropFolder(folder.folder, event)}
      role="listitem"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          aria-label={`${folder.folder} layout folder 순서 드래그`}
          aria-describedby={`${reorderKeyboardDescriptionId} ${reorderDisabledDescriptionId} ${desktopCmSessionLayoutReorderDisabledReasonId} ${reorderFocusDescriptionId} ${reorderFocusStatusId} ${actionsId}`}
          aria-keyshortcuts="ArrowUp ArrowDown Home End"
          className="ku-control h-8 text-xs"
          data-testid={`desktop-cm-session-layout-folder-drag-handle-${folder.slug}`}
          disabled={!props.canReorderFolders}
          draggable={props.canReorderFolders}
          title={props.canReorderFolders ? 'Drag to reorder layout folder' : props.folderDisabledReason(folder.folder)}
          type="button"
          onDragStart={(event) => {
            if (!props.canReorderFolders) {
              event.preventDefault();
              return;
            }
            actions.onSetDraggingFolder(folder.folder);
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/x-kuviewer-layout-folder', folder.folder);
            event.dataTransfer.setData('text/plain', folder.folder);
          }}
          onDragEnd={() => actions.onSetDraggingFolder('')}
          onKeyDown={(event) => actions.onFolderReorderKeyDown(folder.folder, event)}
        >
          <GripVertical size={13} aria-hidden="true" />
        </button>
        <ReorderButton
          direction="up"
          label={`${folder.folder} layout folder 위로 이동`}
          testId={`desktop-cm-session-layout-folder-reorder-up-${folder.slug}`}
          disabled={!canMoveUp}
          title={canMoveUp ? `${folder.folder} layout folder move up` : props.folderDisabledReason(folder.folder, 'up')}
          onClick={() => actions.onMoveFolder(folder.folder, -1)}
        />
        <ReorderButton
          direction="down"
          label={`${folder.folder} layout folder 아래로 이동`}
          testId={`desktop-cm-session-layout-folder-reorder-down-${folder.slug}`}
          disabled={!canMoveDown}
          title={canMoveDown ? `${folder.folder} layout folder move down` : props.folderDisabledReason(folder.folder, 'down')}
          onClick={() => actions.onMoveFolder(folder.folder, 1)}
        />
        <button
          aria-controls={itemsId}
          aria-expanded={!folder.collapsed}
          aria-label={`${folder.folder} layout folder ${folder.collapsed ? 'expand' : 'collapse'}`}
          className="ku-control h-8 text-xs"
          data-testid={`desktop-cm-session-layout-folder-toggle-${folder.slug}`}
          type="button"
          onClick={() => actions.onToggleFolder(folder.folder)}
        >
          {folder.collapsed ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
          <Folder size={13} aria-hidden="true" />
          <span className="truncate" id={titleId}>{folder.folder}</span>
        </button>
        <span className="ku-chip" data-testid={`desktop-cm-session-layout-folder-count-${folder.slug}`} id={countId}>{folder.presets.length} / {folder.totalCount}</span>
        <span className="sr-only" data-testid={`desktop-cm-session-layout-folder-actions-${folder.slug}`} id={actionsId}>
          {folder.folder} has {folder.presets.length} visible presets and {folder.totalCount} total presets. Keyboard actions can toggle, select visible presets, rename this folder, or reorder with Shift plus arrow keys. Reorder controls are UI-only and use saved layout preset array order.
        </span>
        {renaming ? (
          <FolderRenameEditor {...props} />
        ) : (
          <>
            <button aria-label={`Select visible layouts in ${folder.folder}`} className="ku-control h-8 text-xs" data-testid={`desktop-cm-session-layout-folder-select-${folder.slug}`} type="button" disabled={folder.presets.length === 0} onClick={() => actions.onSelectFolderPresets(folder.folder)}>
              <CheckCircle2 size={13} aria-hidden="true" />Folder 선택
            </button>
            <button aria-label={`Rename ${folder.folder} layout folder`} className="ku-control h-8 text-xs" data-testid={`desktop-cm-session-layout-folder-rename-${folder.slug}`} type="button" onClick={() => actions.onStartFolderRename(folder.folder)}>
              <Pencil size={13} aria-hidden="true" />Folder 이름
            </button>
          </>
        )}
      </div>
      <div aria-hidden={folder.collapsed} className={`${folder.collapsed ? 'hidden' : 'flex'} min-w-0 flex-wrap items-center gap-2`} data-testid={`desktop-cm-session-layout-folder-items-${folder.slug}`} id={itemsId}>
        {folder.presets.length === 0 ? (
          <span className="flex min-w-0 items-center gap-2 rounded-[8px] border border-dashed border-[rgba(60,60,67,0.14)] bg-white/52 px-3 py-2 text-xs font-semibold text-[rgba(60,60,67,0.58)]" data-testid={`desktop-cm-session-layout-folder-empty-${folder.slug}`} role="status">
            <Search size={13} aria-hidden="true" />이 folder에 일치하는 saved layout 없음
          </span>
        ) : null}
        {folder.presets.map((preset, presetIndex) => (
          <DesktopCmLayoutPresetChip
            key={preset.name}
            {...props}
            preset={preset}
            presetIndex={presetIndex}
          />
        ))}
      </div>
    </div>
  );
}

function FolderRenameEditor({ folder, folderRenameDraft, actions }: FolderRowProps) {
  return (
    <span aria-label={`Rename ${folder.folder} layout folder`} className="flex min-w-[220px] flex-1 flex-wrap items-center gap-1" data-testid={`desktop-cm-session-layout-folder-rename-editor-${folder.slug}`} role="group">
      <input
        aria-label={`New name for ${folder.folder} layout folder`}
        className="ku-field h-8 min-w-[150px] flex-1 px-2 py-1 text-xs"
        data-testid={`desktop-cm-session-layout-folder-rename-input-${folder.slug}`}
        maxLength={maxDesktopCmSessionLayoutFolderNameLength}
        value={folderRenameDraft}
        onChange={(event) => actions.onFolderRenameDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            actions.onSaveFolderRename();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            actions.onCancelFolderRename();
          }
        }}
      />
      <button aria-label={`Save ${folder.folder} layout folder name`} className="ku-control h-8 text-xs" data-testid={`desktop-cm-session-layout-folder-rename-save-${folder.slug}`} type="button" onClick={actions.onSaveFolderRename}>
        <CheckCircle2 size={13} aria-hidden="true" />저장
      </button>
      <button aria-label={`Cancel ${folder.folder} layout folder rename`} className="ku-control h-8 text-xs" data-testid={`desktop-cm-session-layout-folder-rename-cancel-${folder.slug}`} type="button" onClick={actions.onCancelFolderRename}>
        <XCircle size={13} aria-hidden="true" />취소
      </button>
    </span>
  );
}

interface PresetChipProps extends FolderRowProps {
  preset: DesktopCmSessionLayoutPreset;
  presetIndex: number;
}

function DesktopCmLayoutPresetChip(props: PresetChipProps) {
  const { preset, folder, actions } = props;
  const slug = slugifyDesktopCmTestId(preset.name);
  const active = preset.name === props.activePresetName;
  const renaming = props.presetRenameTarget.toLowerCase() === preset.name.toLowerCase();
  const canReorder = props.canReorderPresets && folder.presets.length > 1;
  const canMoveUp = canReorder && props.presetIndex > 0;
  const canMoveDown = canReorder && props.presetIndex < folder.presets.length - 1;

  return (
    <span
      className={`ku-chip max-w-full gap-1 ${props.draggingPresetName === preset.name ? 'opacity-60' : ''} ${renaming ? 'items-stretch' : ''} ${active ? 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]' : ''}`}
      data-testid={`desktop-cm-session-layout-${slug}`}
      onDragOver={(event) => {
        if (canReorder) event.preventDefault();
      }}
      onDrop={(event) => actions.onDropPreset(preset.name, event)}
    >
      {renaming ? (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <input
            className="ku-field h-7 min-w-[150px] flex-1 px-2 py-1 text-xs"
            data-testid={`desktop-cm-session-layout-rename-input-${slug}`}
            maxLength={maxDesktopCmSessionLayoutPresetNameLength}
            value={props.presetRenameDraft}
            onChange={(event) => {
              actions.onPresetRenameDraftChange(event.target.value);
              actions.onClearPresetRenameError();
            }}
            onKeyDown={actions.onPresetRenameKeyDown}
          />
          <IconButton testId={`desktop-cm-session-layout-rename-save-${slug}`} title={`${preset.name} 이름 저장`} onClick={actions.onSavePresetRename}><CheckCircle2 size={12} aria-hidden="true" /></IconButton>
          <IconButton testId={`desktop-cm-session-layout-rename-cancel-${slug}`} title={`${preset.name} 이름 변경 취소`} onClick={actions.onCancelPresetRename}><XCircle size={12} aria-hidden="true" /></IconButton>
          {props.presetRenameError ? <span className="text-[10px] font-bold text-[#b42318]" data-testid="desktop-cm-session-layout-rename-error">{props.presetRenameError}</span> : null}
        </span>
      ) : (
        <>
          <button
            aria-label={`${preset.name} layout 순서 드래그`}
            aria-describedby={`${reorderKeyboardDescriptionId} ${reorderDisabledDescriptionId} ${desktopCmSessionLayoutReorderDisabledReasonId} ${reorderFocusDescriptionId} ${reorderFocusStatusId}`}
            aria-keyshortcuts="ArrowUp ArrowDown Home End"
            className="rounded-full p-0.5 hover:bg-[rgba(60,60,67,0.08)] disabled:cursor-not-allowed disabled:opacity-45"
            data-testid={`desktop-cm-session-layout-drag-handle-${slug}`}
            disabled={!canReorder}
            draggable={canReorder}
            title={canReorder ? 'Drag to reorder layout preset' : props.presetDisabledReason(preset.name, folder.folder)}
            type="button"
            onDragStart={(event) => {
              if (!canReorder) {
                event.preventDefault();
                return;
              }
              actions.onSetDraggingPreset(preset.name);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('application/x-kuviewer-layout-preset', preset.name);
              event.dataTransfer.setData('text/plain', preset.name);
            }}
            onDragEnd={() => actions.onSetDraggingPreset('')}
            onKeyDown={(event) => actions.onPresetReorderKeyDown(preset.name, event)}
          >
            <GripVertical size={12} aria-hidden="true" />
          </button>
          <PresetReorderButton direction="up" preset={preset} disabled={!canMoveUp} title={canMoveUp ? `${preset.name} layout move up` : props.presetDisabledReason(preset.name, folder.folder, 'up')} onClick={() => actions.onMovePreset(preset.name, -1)} />
          <PresetReorderButton direction="down" preset={preset} disabled={!canMoveDown} title={canMoveDown ? `${preset.name} layout move down` : props.presetDisabledReason(preset.name, folder.folder, 'down')} onClick={() => actions.onMovePreset(preset.name, 1)} />
          <label className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold" data-testid={`desktop-cm-session-layout-bulk-select-${slug}`}>
            <input className="h-3.5 w-3.5 accent-[#007aff]" data-testid={`desktop-cm-session-layout-bulk-select-input-${slug}`} type="checkbox" checked={props.selectedPresetNames.has(preset.name)} onChange={(event) => actions.onTogglePresetSelection(preset.name, event.currentTarget.checked)} />선택
          </label>
          <button className="flex min-w-0 items-center gap-1 truncate" type="button" onClick={() => actions.onApplyPreset(preset)}>
            <Folder size={12} aria-hidden="true" /><span className="truncate">{preset.name}</span><span className="truncate font-mono text-[10px]">{formatDesktopCmSessionLayoutSummary(preset.viewPreferences)}</span>
          </button>
          <input
            key={`${preset.name}:${preset.folder}`}
            aria-label={`${preset.name} layout folder`}
            className="ku-field h-7 w-[104px] px-2 py-1 text-[11px]"
            data-testid={`desktop-cm-session-layout-folder-input-${slug}`}
            defaultValue={preset.folder}
            maxLength={maxDesktopCmSessionLayoutFolderNameLength}
            onBlur={(event) => actions.onUpdatePresetFolder(preset.name, event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                actions.onUpdatePresetFolder(preset.name, event.currentTarget.value);
                event.currentTarget.blur();
              }
            }}
          />
          <IconButton testId={`desktop-cm-session-layout-rename-${slug}`} title={`${preset.name} 이름 변경`} onClick={() => actions.onStartPresetRename(preset)}><Pencil size={12} aria-hidden="true" /></IconButton>
          <IconButton testId={`desktop-cm-session-layout-duplicate-${slug}`} title={`${preset.name} 복제`} onClick={() => actions.onDuplicatePreset(preset)}><Copy size={12} aria-hidden="true" /></IconButton>
          <IconButton testId={`desktop-cm-session-layout-delete-${slug}`} title={`${preset.name} 삭제`} onClick={() => actions.onDeletePreset(preset.name)}><XCircle size={12} aria-hidden="true" /></IconButton>
        </>
      )}
    </span>
  );
}

function ReorderButton({ direction, label, testId, disabled, title, onClick }: { direction: 'up' | 'down'; label: string; testId: string; disabled: boolean; title: string; onClick: () => void }) {
  const Icon = direction === 'up' ? ArrowUp : ArrowDown;
  return <button aria-label={label} aria-describedby={`${reorderDisabledDescriptionId} ${desktopCmSessionLayoutReorderDisabledReasonId}`} className="ku-control h-8 text-xs" data-testid={testId} disabled={disabled} title={title} type="button" onClick={onClick}><Icon size={13} aria-hidden="true" /></button>;
}

function PresetReorderButton({ direction, preset, disabled, title, onClick }: { direction: 'up' | 'down'; preset: DesktopCmSessionLayoutPreset; disabled: boolean; title: string; onClick: () => void }) {
  const Icon = direction === 'up' ? ArrowUp : ArrowDown;
  return <button aria-label={`${preset.name} layout ${direction === 'up' ? '위로' : '아래로'} 이동`} aria-describedby={`${reorderDisabledDescriptionId} ${desktopCmSessionLayoutReorderDisabledReasonId}`} className="rounded-full p-0.5 hover:bg-[rgba(60,60,67,0.08)] disabled:cursor-not-allowed disabled:opacity-45" data-testid={`desktop-cm-session-layout-reorder-${direction}-${slugifyDesktopCmTestId(preset.name)}`} disabled={disabled} title={title} type="button" onClick={onClick}><Icon size={12} aria-hidden="true" /></button>;
}

function IconButton({ testId, title, onClick, children }: { testId: string; title: string; onClick: () => void; children: ReactNode }) {
  return <button className="rounded-full p-0.5 hover:bg-[rgba(60,60,67,0.08)]" data-testid={testId} type="button" title={title} onClick={onClick}>{children}</button>;
}

function LayoutStoragePolicy() {
  return <p className="text-xs font-semibold text-[rgba(60,60,67,0.58)]">folder, session id, group, favorite, collapsed group만 저장 · search/diagnostic/runtime/credential/export session metadata 제외</p>;
}
