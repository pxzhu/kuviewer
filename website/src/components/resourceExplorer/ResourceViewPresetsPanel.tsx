import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  Download,
  Folder,
  FolderOpen,
  GitBranch,
  GripVertical,
  Link2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Tags,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { ResourceViewFilters } from '../../features/resources/resourceViewState';
import {
  defaultResourceViewGroup,
  formatPresetUpdatedAt,
  formatResourceViewTeamSnapshotMetadata,
  maxResourceViewGroupLength,
  maxResourceViewPresets,
  resourceViewGroupDomId,
  resourceViewIncomingNewCount,
  resourceViewPresetDomId,
  resourceViewPresetMatchesFilters,
  resourceViewPresetSummary,
  resourceViewSourceLabel,
  resourceViewSourceShortLabel,
  resourceViewTeamCompareActionLabel,
  resourceViewTeamSyncActionLabel,
  resourceViewTransferActionLabel,
} from '../../features/resources/resourceViewPresets';
import type { ResourceViewPresetsController } from '../../features/resources/useResourceViewPresetsController';

interface ResourceViewPresetsPanelProps {
  controller: ResourceViewPresetsController;
  currentFilters: ResourceViewFilters;
  filtersAreDefault: boolean;
}

export function ResourceViewPresetsPanel({ controller, currentFilters, filtersAreDefault }: ResourceViewPresetsPanelProps) {
  const {
    allVisibleViewPresetsSelected,
    bulkViewPresetDeleteConfirm,
    bulkViewPresetGroup,
    canReorderViewPresets,
    collapsedViewGroups,
    collapsedVisibleViewPresetFolderCount,
    draggingViewPresetName,
    filteredGroupedViewPresets,
    groupedViewPresets,
    handleApplyTeamLoadPreview,
    handleApplyViewPreset,
    handleBulkDeleteViewPresets,
    handleBulkMoveViewPresets,
    handleCancelResourceViewRename,
    handleClearViewPresetSelection,
    handleCollapseVisibleViewPresetFolders,
    handleCommitResourceViewRename,
    handleConfirmTeamSavePreview,
    handleCopyResourceViewLink,
    handleDeleteViewPreset,
    handleDismissTeamComparePreview,
    handleDropViewPreset,
    handleExpandVisibleViewPresetFolders,
    handleExportSelectedViewPresets,
    handleExportViewPresets,
    handleImportViewPresets,
    handleLoadTeamViewPresets,
    handleMoveViewPreset,
    handleResetResourceFilters,
    handleResolveResourceViewConflicts,
    handleResourceViewRenameKeyDown,
    handleSaveTeamViewPresets,
    handleSaveViewPreset,
    handleSetGroupViewPresetSelection,
    handleSetVisibleViewPresetSelection,
    handleStartResourceViewRename,
    handleToggleViewPresetSelection,
    handleUpdateViewPresetGroup,
    matchingViewPreset,
    normalizedViewPresetSearch,
    presetGroup,
    presetName,
    presetNameExists,
    renamingViewPreset,
    resourceViewConflict,
    resourceViewMessage,
    resourceViewTeamComparePreview,
    resourceViewTeamLoading,
    resourceViewTeamSaveConfirm,
    resourceViewTeamSyncSummary,
    resourceViewTransferSummary,
    savePresetLabel,
    selectedViewPresetCount,
    selectedViewPresetNames,
    selectedVisibleViewPresetCount,
    setBulkViewPresetGroup,
    setBulkViewPresetDeleteConfirm,
    setDraggingViewPresetName,
    setPresetGroup,
    setPresetName,
    setRenamingViewPreset,
    setResourceViewConflict,
    setResourceViewTeamSyncSummary,
    setResourceViewTransferSummary,
    setViewPresetSearch,
    suggestedPresetName,
    teamResourceViewsEnabled,
    toggleViewPresetGroup,
    viewPresetGroupOptions,
    viewPresetImportInputRef,
    viewPresetSearch,
    viewPresets,
    visibleViewPresetFolderCount,
    visibleViewPresets,
  } = controller;

  return (
    <div className="grid gap-2 rounded-[12px] border border-[rgba(60,60,67,0.12)] bg-white/70 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="ku-meta">저장된 뷰 · 필터만 브라우저/팀 저장소에 보관</p>
          {matchingViewPreset ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(52,199,89,0.12)] px-2 py-1 text-[10px] font-semibold text-[#14863d]">
              <CheckCircle2 size={12} aria-hidden="true" />
              현재 적용됨 · {matchingViewPreset.name}
            </span>
          ) : (
            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${filtersAreDefault ? 'bg-[rgba(60,60,67,0.08)] text-[rgba(60,60,67,0.62)]' : 'bg-[rgba(255,149,0,0.12)] text-[#a45f00]'}`}>
              {filtersAreDefault ? '기본 필터' : '저장 안 됨'}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.06)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.1)]"
            type="button"
            onClick={() => void handleCopyResourceViewLink()}
            data-testid="resource-view-share-link"
            title="현재 Resource Explorer 필터 공유 링크 복사"
          >
            <Link2 size={13} aria-hidden="true" />
            공유 링크
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={handleExportViewPresets}
            disabled={viewPresets.length === 0}
            data-testid="resource-view-export"
            title="저장된 Resource Explorer view를 JSON으로 내보내기"
          >
            <Download size={13} aria-hidden="true" />
            내보내기
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
            type="button"
            onClick={() => viewPresetImportInputRef.current?.click()}
            data-testid="resource-view-import"
            title="저장된 Resource Explorer view JSON 가져오기"
          >
            <Upload size={13} aria-hidden="true" />
            가져오기
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.06)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.1)] disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={() => void handleLoadTeamViewPresets()}
            disabled={!teamResourceViewsEnabled || resourceViewTeamLoading}
            data-testid="resource-view-team-load"
            title={teamResourceViewsEnabled ? '서버에 저장된 팀 Resource Explorer view 불러오기' : 'Live Cluster 연결과 admin token이 필요합니다'}
          >
            <RefreshCw className={resourceViewTeamLoading ? 'animate-spin' : ''} size={13} aria-hidden="true" />
            팀 불러오기
          </button>
          <button
            className={`inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
              resourceViewTeamSaveConfirm
                ? 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00] hover:bg-[rgba(255,149,0,0.14)]'
                : 'border-[rgba(0,122,255,0.18)] bg-white text-[#0057b8] hover:bg-[rgba(0,122,255,0.08)]'
            }`}
            type="button"
            onClick={() => void handleSaveTeamViewPresets()}
            disabled={!teamResourceViewsEnabled || resourceViewTeamLoading || viewPresets.length === 0}
            data-testid="resource-view-team-save"
            aria-pressed={resourceViewTeamSaveConfirm}
            title={teamResourceViewsEnabled ? '현재 브라우저 saved view를 팀 저장소에 저장' : 'Live Cluster 연결과 admin token이 필요합니다'}
          >
            <Upload size={13} aria-hidden="true" />
            {resourceViewTeamSaveConfirm ? '팀 저장 확인' : '팀 저장'}
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={handleResetResourceFilters}
            disabled={filtersAreDefault}
            data-testid="resource-view-reset"
          >
            <RotateCcw size={13} aria-hidden="true" />
            필터 초기화
          </button>
          <span className="ku-chip">{viewPresets.length} / {maxResourceViewPresets}</span>
          <input
            ref={viewPresetImportInputRef}
            className="hidden"
            type="file"
            accept="application/json,.json"
            data-testid="resource-view-import-input"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              void handleImportViewPresets(file);
              event.currentTarget.value = '';
            }}
          />
        </div>
      </div>
      {resourceViewMessage ? (
        <p
          className={`rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold ${
            resourceViewMessage.tone === 'success'
              ? 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]'
              : 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]'
          }`}
          data-testid="resource-view-message"
        >
          {resourceViewMessage.text}
        </p>
      ) : null}
      {resourceViewTransferSummary ? (
        <div className="grid gap-2 rounded-[12px] border border-[rgba(0,122,255,0.14)] bg-[rgba(0,122,255,0.045)] p-2" data-testid="resource-view-transfer-summary">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/82 px-2 py-1 text-[10px] font-semibold text-[#0057b8]" data-testid="resource-view-transfer-action">
                {resourceViewTransferSummary.action === 'export' ? <Download size={12} aria-hidden="true" /> : <Upload size={12} aria-hidden="true" />}
                {resourceViewTransferActionLabel(resourceViewTransferSummary)}
              </span>
              <span className="ku-chip" data-testid="resource-view-transfer-count">
                {resourceViewTransferSummary.count} views
              </span>
              {resourceViewTransferSummary.skippedCount > 0 ? (
                <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]" data-testid="resource-view-transfer-skipped">
                  skipped {resourceViewTransferSummary.skippedCount}
                </span>
              ) : null}
            </div>
            <button
              className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2 py-1 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
              type="button"
              onClick={() => setResourceViewTransferSummary(null)}
              data-testid="resource-view-transfer-dismiss"
            >
              닫기
            </button>
          </div>
          <div className="grid gap-1">
            <p className="truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.62)]" data-testid="resource-view-transfer-file">
              {resourceViewTransferSummary.fileName}
            </p>
            <p className="ku-meta" data-testid="resource-view-transfer-folders">
              Folders {resourceViewTransferSummary.folders.length}: {resourceViewTransferSummary.folders.length > 0 ? resourceViewTransferSummary.folders.join(', ') : 'none'}
              {resourceViewTransferSummary.format ? ` · format ${resourceViewTransferSummary.format === 'items' ? '{ items }' : 'array'}` : ''}
            </p>
          </div>
        </div>
      ) : null}
      {resourceViewTeamComparePreview ? (
        <div className="grid gap-2 rounded-[12px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.055)] p-2.5" data-testid="resource-view-team-compare-preview">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/82 px-2 py-1 text-[10px] font-semibold text-[#0057b8]" data-testid="resource-view-team-compare-action">
                  <GitBranch size={12} aria-hidden="true" />
                  {resourceViewTeamCompareActionLabel(resourceViewTeamComparePreview)}
                </span>
                <span className="ku-chip" data-testid="resource-view-team-compare-local">Local {resourceViewTeamComparePreview.localCount}</span>
                <span className="ku-chip" data-testid="resource-view-team-compare-team">Team {resourceViewTeamComparePreview.teamCount}</span>
                {resourceViewTeamComparePreview.newNames.length > 0 ? (
                  <span className="ku-chip border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]" data-testid="resource-view-team-compare-new">
                    신규 {resourceViewTeamComparePreview.newNames.length}
                  </span>
                ) : null}
                {resourceViewTeamComparePreview.conflictNames.length > 0 ? (
                  <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]" data-testid="resource-view-team-compare-conflicts">
                    변경 충돌 {resourceViewTeamComparePreview.conflictNames.length}
                  </span>
                ) : null}
                {resourceViewTeamComparePreview.duplicateNames.length > 0 ? (
                  <span className="ku-chip" data-testid="resource-view-team-compare-duplicates">동일 {resourceViewTeamComparePreview.duplicateNames.length}</span>
                ) : null}
                {resourceViewTeamComparePreview.action === 'load' && resourceViewTeamComparePreview.localOnlyNames.length > 0 ? (
                  <span className="ku-chip" data-testid="resource-view-team-compare-local-only">로컬 유지 {resourceViewTeamComparePreview.localOnlyNames.length}</span>
                ) : null}
                {resourceViewTeamComparePreview.action === 'save' && resourceViewTeamComparePreview.teamOnlyNames.length > 0 ? (
                  <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]" data-testid="resource-view-team-compare-team-only">
                    서버 제외 {resourceViewTeamComparePreview.teamOnlyNames.length}
                  </span>
                ) : null}
                {resourceViewTeamComparePreview.invalidCount > 0 ? (
                  <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]" data-testid="resource-view-team-compare-skipped">
                    skipped {resourceViewTeamComparePreview.invalidCount}
                  </span>
                ) : null}
              </div>
              <p className="ku-meta mt-1" data-testid="resource-view-team-compare-folders">
                Folders {resourceViewTeamComparePreview.folders.length}: {resourceViewTeamComparePreview.folders.length > 0 ? resourceViewTeamComparePreview.folders.join(', ') : 'none'}
                {resourceViewTeamComparePreview.mergeResult.droppedCount > 0 ? ` · 최대 ${maxResourceViewPresets}개 제한으로 ${resourceViewTeamComparePreview.mergeResult.droppedCount}개 제외 예정` : ''}
              </p>
              {resourceViewTeamComparePreview.snapshotMetadata ? (
                <p className="ku-meta mt-1" data-testid="resource-view-team-compare-snapshot">
                  {formatResourceViewTeamSnapshotMetadata(resourceViewTeamComparePreview.snapshotMetadata)}
                </p>
              ) : null}
            </div>
            <button
              className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2 py-1 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
              type="button"
              onClick={handleDismissTeamComparePreview}
              data-testid="resource-view-team-compare-dismiss"
            >
              닫기
            </button>
          </div>
          <div className="grid gap-1.5 md:grid-cols-2">
            <ResourceViewCompareNames title={resourceViewTeamComparePreview.action === 'load' ? '팀에서 들어올 뷰' : '팀에 저장할 뷰'} names={resourceViewTeamComparePreview.newNames} testId="resource-view-team-compare-new-list" />
            <ResourceViewCompareNames title={resourceViewTeamComparePreview.action === 'load' ? '변경 충돌' : '서버와 다른 뷰'} names={resourceViewTeamComparePreview.conflictNames} testId="resource-view-team-compare-conflict-list" />
            {resourceViewTeamComparePreview.action === 'load' ? (
              <ResourceViewCompareNames title="로컬에만 있는 뷰" names={resourceViewTeamComparePreview.localOnlyNames} testId="resource-view-team-compare-local-list" />
            ) : (
              <ResourceViewCompareNames title="서버에서 빠질 뷰" names={resourceViewTeamComparePreview.teamOnlyNames} testId="resource-view-team-compare-team-list" />
            )}
            <ResourceViewCompareNames title="이미 동일한 뷰" names={resourceViewTeamComparePreview.duplicateNames} testId="resource-view-team-compare-duplicate-list" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {resourceViewTeamComparePreview.action === 'load' ? (
              <button
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.2)] bg-[rgba(0,122,255,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.12)]"
                type="button"
                onClick={handleApplyTeamLoadPreview}
                data-testid="resource-view-team-compare-apply"
              >
                <CheckCircle2 size={13} aria-hidden="true" />
                팀 뷰 반영
              </button>
            ) : (
              <button
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.2)] bg-[rgba(0,122,255,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.12)] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => void handleConfirmTeamSavePreview()}
                disabled={resourceViewTeamLoading}
                data-testid="resource-view-team-compare-save"
              >
                <Upload size={13} aria-hidden="true" />
                팀 저장 실행
              </button>
            )}
            <button
              className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
              type="button"
              onClick={handleDismissTeamComparePreview}
              data-testid="resource-view-team-compare-cancel"
            >
              취소
            </button>
          </div>
        </div>
      ) : null}
      {resourceViewTeamSyncSummary ? (
        <div className="grid gap-2 rounded-[12px] border border-[rgba(52,199,89,0.18)] bg-[rgba(52,199,89,0.06)] p-2" data-testid="resource-view-team-sync-summary">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/82 px-2 py-1 text-[10px] font-semibold text-[#14863d]" data-testid="resource-view-team-sync-action">
                <RefreshCw size={12} aria-hidden="true" />
                {resourceViewTeamSyncActionLabel(resourceViewTeamSyncSummary)}
              </span>
              <span className="ku-chip" data-testid="resource-view-team-sync-count">
                {resourceViewTeamSyncSummary.count} views
              </span>
              {resourceViewTeamSyncSummary.newCount > 0 ? (
                <span className="ku-chip border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]" data-testid="resource-view-team-sync-new">
                  신규 {resourceViewTeamSyncSummary.newCount}
                </span>
              ) : null}
              {resourceViewTeamSyncSummary.conflictCount > 0 ? (
                <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]" data-testid="resource-view-team-sync-conflicts">
                  충돌 {resourceViewTeamSyncSummary.conflictCount}
                </span>
              ) : null}
              {resourceViewTeamSyncSummary.duplicateCount > 0 ? (
                <span className="ku-chip" data-testid="resource-view-team-sync-duplicates">중복 {resourceViewTeamSyncSummary.duplicateCount}</span>
              ) : null}
              {resourceViewTeamSyncSummary.skippedCount > 0 ? (
                <span className="ku-chip border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]" data-testid="resource-view-team-sync-skipped">
                  skipped {resourceViewTeamSyncSummary.skippedCount}
                </span>
              ) : null}
            </div>
            <button
              className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2 py-1 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
              type="button"
              onClick={() => setResourceViewTeamSyncSummary(null)}
              data-testid="resource-view-team-sync-dismiss"
            >
              닫기
            </button>
          </div>
          <div className="grid gap-1">
            <p className="ku-meta" data-testid="resource-view-team-sync-folders">
              Folders {resourceViewTeamSyncSummary.folders.length}: {resourceViewTeamSyncSummary.folders.length > 0 ? resourceViewTeamSyncSummary.folders.join(', ') : 'none'}
            </p>
            <p className="ku-meta" data-testid="resource-view-team-sync-meta">
              Local before {resourceViewTeamSyncSummary.localCount} · {formatPresetUpdatedAt(resourceViewTeamSyncSummary.timestamp)}
            </p>
            {resourceViewTeamSyncSummary.snapshotMetadata ? (
              <p className="ku-meta" data-testid="resource-view-team-sync-snapshot">
                {formatResourceViewTeamSnapshotMetadata(resourceViewTeamSyncSummary.snapshotMetadata)}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {resourceViewConflict ? (
        <div
          className="grid gap-2 rounded-[12px] border border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.08)] p-2.5"
          data-testid="resource-view-conflict-panel"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#8a4d00]">
                {resourceViewSourceLabel(resourceViewConflict.source)} 충돌 {resourceViewConflict.conflicts.length}개
              </p>
              <p className="ku-meta mt-0.5">
                신규 {resourceViewIncomingNewCount(resourceViewConflict.basePresets, resourceViewConflict.incomingPresets)}개 · 중복 {resourceViewConflict.duplicateCount}개 · 건너뜀 {resourceViewConflict.invalidCount}개
              </p>
            </div>
            <button
              className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2 py-1 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
              type="button"
              onClick={() => setResourceViewConflict(null)}
              data-testid="resource-view-conflict-dismiss"
            >
              닫기
            </button>
          </div>
          <div className="grid gap-1.5">
            {resourceViewConflict.conflicts.slice(0, 4).map((conflict) => (
              <div key={conflict.name} className="grid gap-1 rounded-[9px] border border-[rgba(255,149,0,0.18)] bg-white/78 p-2">
                <p className="truncate text-xs font-semibold text-[#1d1d1f]">{conflict.name}</p>
                <p className="truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.56)]">현재: {resourceViewPresetSummary(conflict.existing)}</p>
                <p className="truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.56)]">{resourceViewSourceShortLabel(resourceViewConflict.source)}: {resourceViewPresetSummary(conflict.incoming)}</p>
              </div>
            ))}
            {resourceViewConflict.conflicts.length > 4 ? (
              <p className="ku-meta">+{resourceViewConflict.conflicts.length - 4}개 충돌 더 있음</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.2)] bg-[rgba(0,122,255,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.12)]"
              type="button"
              onClick={() => handleResolveResourceViewConflicts('incoming')}
              data-testid="resource-view-conflict-apply-incoming"
            >
              <CheckCircle2 size={13} aria-hidden="true" />
              {resourceViewSourceShortLabel(resourceViewConflict.source)} 우선
            </button>
            <button
              className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
              type="button"
              onClick={() => handleResolveResourceViewConflicts('current')}
              data-testid="resource-view-conflict-keep-current"
            >
              현재 유지
            </button>
            <button
              className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
              type="button"
              onClick={() => handleResolveResourceViewConflicts('rename')}
              data-testid="resource-view-conflict-rename"
            >
              이름 바꿔 둘 다 보관
            </button>
          </div>
        </div>
      ) : null}
      {viewPresets.length > 0 ? (
        <div className="grid gap-2 rounded-[12px] border border-[rgba(60,60,67,0.1)] bg-[rgba(242,242,247,0.42)] p-2" data-testid="resource-view-folder-summary">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/82 px-2 py-1 text-[10px] font-semibold text-[rgba(60,60,67,0.72)]" data-testid="resource-view-folder-summary-count">
                <FolderOpen size={12} aria-hidden="true" />
                Folders {normalizedViewPresetSearch ? `${visibleViewPresetFolderCount} / ${groupedViewPresets.length}` : visibleViewPresetFolderCount}
              </span>
              <span className="ku-chip" data-testid="resource-view-folder-collapsed-count">접힘 {collapsedVisibleViewPresetFolderCount}</span>
              {selectedViewPresetCount > 0 ? (
                <span className="ku-chip border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] text-[#0057b8]" data-testid="resource-view-folder-selected-count">
                  선택 {selectedVisibleViewPresetCount} / {selectedViewPresetCount}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={handleExpandVisibleViewPresetFolders}
                disabled={visibleViewPresetFolderCount === 0 || collapsedVisibleViewPresetFolderCount === 0}
                data-testid="resource-view-folder-expand-all"
              >
                모두 펼치기
              </button>
              <button
                className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={handleCollapseVisibleViewPresetFolders}
                disabled={visibleViewPresetFolderCount === 0 || collapsedVisibleViewPresetFolderCount === visibleViewPresetFolderCount}
                data-testid="resource-view-folder-collapse-all"
              >
                모두 접기
              </button>
            </div>
          </div>
          {visibleViewPresetFolderCount > 0 ? (
            <div className="flex gap-1.5 overflow-x-auto pb-0.5" data-testid="resource-view-folder-chips">
              {filteredGroupedViewPresets.map((group) => {
                const collapsed = collapsedViewGroups.has(group.name);
                const groupDomId = resourceViewGroupDomId(group.name);
                const selectedCount = group.presets.filter((preset) => selectedViewPresetNames.has(preset.name)).length;
                const active = matchingViewPreset?.group === group.name;
                const FolderIcon = collapsed ? Folder : FolderOpen;
                return (
                  <button
                    key={group.name}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition ${
                      active
                        ? 'border-[rgba(0,122,255,0.24)] bg-[rgba(0,122,255,0.1)] text-[#0057b8]'
                        : collapsed
                          ? 'border-[rgba(60,60,67,0.12)] bg-white/72 text-[rgba(60,60,67,0.62)] hover:bg-white'
                          : 'border-[rgba(52,199,89,0.16)] bg-white/86 text-[rgba(60,60,67,0.72)] hover:bg-white'
                    }`}
                    type="button"
                    onClick={() => toggleViewPresetGroup(group.name)}
                    aria-expanded={!collapsed}
                    data-testid={`resource-view-folder-chip-${groupDomId}`}
                    title={`${group.name} folder ${collapsed ? '펼치기' : '접기'}`}
                  >
                    <FolderIcon size={13} aria-hidden="true" />
                    <span>{group.name}</span>
                    <span className="rounded-full bg-[rgba(60,60,67,0.06)] px-1.5 py-0.5 text-[9px] font-semibold">
                      {normalizedViewPresetSearch ? `${group.presets.length}/${group.total}` : group.presets.length}
                    </span>
                    {selectedCount > 0 ? <span className="rounded-full bg-[rgba(0,122,255,0.1)] px-1.5 py-0.5 text-[9px] font-semibold text-[#0057b8]">{selectedCount} selected</span> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="ku-meta" data-testid="resource-view-folder-empty">일치하는 folder 없음</p>
          )}
        </div>
      ) : null}
      {viewPresets.length > 0 ? (
        <div className="grid gap-1.5" aria-label="저장된 뷰 빠른 적용" data-testid="resource-view-quick-groups">
          {filteredGroupedViewPresets.map((group) => (
            <div key={group.name} className="grid gap-1">
              <p className="ku-meta flex items-center gap-1.5" data-testid={`resource-view-quick-group-${resourceViewGroupDomId(group.name)}`}>
                <FolderOpen size={12} aria-hidden="true" />
                {group.name} · {normalizedViewPresetSearch ? `${group.presets.length} / ${group.total}` : group.presets.length}
              </p>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {group.presets.map((preset) => {
                  const active = resourceViewPresetMatchesFilters(preset, currentFilters);
                  return (
                    <button
                      key={preset.name}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition ${
                        active
                          ? 'border-[rgba(0,122,255,0.24)] bg-[rgba(0,122,255,0.1)] text-[#0057b8]'
                          : 'border-[rgba(60,60,67,0.12)] bg-white/82 text-[rgba(60,60,67,0.72)] hover:bg-white'
                      }`}
                      type="button"
                      onClick={() => handleApplyViewPreset(preset)}
                      aria-pressed={active}
                      title={`${preset.name} · ${preset.group} · ${resourceViewPresetSummary(preset)}`}
                    >
                      {active ? <CheckCircle2 size={13} aria-hidden="true" /> : <Bookmark size={13} aria-hidden="true" />}
                      <span>{preset.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {viewPresets.length > 0 ? (
        <div className="grid gap-1.5 rounded-[12px] border border-[rgba(60,60,67,0.1)] bg-white/72 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" size={15} />
              <input
                className="ku-input w-full pl-9 pr-9"
                placeholder="Saved view search"
                value={viewPresetSearch}
                onChange={(event) => setViewPresetSearch(event.target.value)}
                data-testid="resource-view-search"
              />
              {viewPresetSearch ? (
                <button
                  className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-full p-1 text-[rgba(60,60,67,0.56)] transition hover:bg-[rgba(60,60,67,0.08)]"
                  type="button"
                  onClick={() => setViewPresetSearch('')}
                  aria-label="Saved view search clear"
                  data-testid="resource-view-search-clear"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              ) : null}
            </label>
            {normalizedViewPresetSearch ? (
              <span className="ku-chip" data-testid="resource-view-search-count">
                {filteredGroupedViewPresets.reduce((total, group) => total + group.presets.length, 0)} / {viewPresets.length}
              </span>
            ) : null}
            <button
              className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={() => handleSetVisibleViewPresetSelection(true)}
              disabled={visibleViewPresets.length === 0 || allVisibleViewPresetsSelected}
              data-testid="resource-view-select-visible"
            >
              현재 결과 선택
            </button>
            <button
              className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={handleClearViewPresetSelection}
              disabled={selectedViewPresetCount === 0}
              data-testid="resource-view-clear-selection"
            >
              선택 해제
            </button>
          </div>
          {normalizedViewPresetSearch ? (
            <p className="ku-meta" data-testid="resource-view-reorder-disabled">검색 해제 후 순서 변경</p>
          ) : null}
        </div>
      ) : null}
      {selectedViewPresetCount > 0 ? (
        <div className="grid gap-2 rounded-[12px] border border-[rgba(0,122,255,0.16)] bg-[rgba(0,122,255,0.055)] p-2" data-testid="resource-view-bulk-toolbar">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="ku-chip border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] text-[#0057b8]" data-testid="resource-view-bulk-count">
                선택 {selectedViewPresetCount}개
              </span>
              <span className="ku-meta">saved view 선택은 메모리에만 보관</span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <button
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                type="button"
                onClick={handleExportSelectedViewPresets}
                data-testid="resource-view-bulk-export"
                title="선택한 saved view만 JSON으로 내보내기"
              >
                <Download size={13} aria-hidden="true" />
                선택 export
              </button>
              <label className="grid min-w-[132px] gap-1">
                <span className="ku-meta">Group 이동</span>
                <input
                  className="ku-input h-8 text-xs"
                  list="resource-view-group-options"
                  value={bulkViewPresetGroup}
                  onChange={(event) => {
                    setBulkViewPresetGroup(event.target.value.slice(0, maxResourceViewGroupLength));
                    setBulkViewPresetDeleteConfirm(false);
                  }}
                  data-testid="resource-view-bulk-group-input"
                />
              </label>
              <button
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.18)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.08)]"
                type="button"
                onClick={handleBulkMoveViewPresets}
                data-testid="resource-view-bulk-move"
              >
                <Tags size={13} aria-hidden="true" />
                Group 이동
              </button>
              <button
                className={`inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-xs font-semibold transition ${
                  bulkViewPresetDeleteConfirm
                    ? 'border-[rgba(255,59,48,0.28)] bg-[rgba(255,59,48,0.12)] text-[#c01f17] hover:bg-[rgba(255,59,48,0.16)]'
                    : 'border-[rgba(255,59,48,0.18)] bg-white text-[#c01f17] hover:bg-[rgba(255,59,48,0.08)]'
                }`}
                type="button"
                onClick={handleBulkDeleteViewPresets}
                data-testid="resource-view-bulk-delete"
              >
                <Trash2 size={13} aria-hidden="true" />
                {bulkViewPresetDeleteConfirm ? '삭제 확인' : '선택 삭제'}
              </button>
              <button
                className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                type="button"
                onClick={handleClearViewPresetSelection}
                data-testid="resource-view-bulk-clear"
              >
                선택 해제
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {presetNameExists ? <p className="ku-meta">같은 이름으로 저장하면 기존 뷰를 업데이트합니다.</p> : null}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(150px,0.45fr)_auto]">
        <label className="grid gap-1">
          <span className="ku-meta">View name</span>
          <input
            className="ku-input w-full"
            placeholder={suggestedPresetName}
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            data-testid="resource-view-name-input"
          />
        </label>
        <label className="grid gap-1">
          <span className="ku-meta">Group</span>
          <input
            className="ku-input w-full"
            list="resource-view-group-options"
            placeholder={defaultResourceViewGroup}
            value={presetGroup}
            onChange={(event) => setPresetGroup(event.target.value.slice(0, maxResourceViewGroupLength))}
            data-testid="resource-view-group-input"
          />
          <datalist id="resource-view-group-options">
            {viewPresetGroupOptions.map((groupName) => (
              <option key={groupName} value={groupName} />
            ))}
          </datalist>
        </label>
        <button
          className="inline-flex h-9 items-center justify-center gap-2 self-end rounded-[9px] border border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] px-3 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.13)]"
          type="button"
          onClick={handleSaveViewPreset}
          data-testid="resource-view-save"
        >
          <Bookmark size={14} aria-hidden="true" />
          {savePresetLabel}
        </button>
      </div>
      {viewPresets.length === 0 ? (
        <p className="ku-meta">저장된 뷰 없음</p>
      ) : filteredGroupedViewPresets.length === 0 ? (
        <p className="ku-meta" data-testid="resource-view-search-empty">일치하는 saved view 없음</p>
      ) : (
        <div className="grid gap-2" data-testid="resource-view-grouped-list">
          {filteredGroupedViewPresets.map((group) => {
            const collapsed = collapsedViewGroups.has(group.name);
            const groupDomId = resourceViewGroupDomId(group.name);
            const groupSelectedCount = group.presets.filter((preset) => selectedViewPresetNames.has(preset.name)).length;
            const groupAllSelected = group.presets.length > 0 && groupSelectedCount === group.presets.length;
            const groupPartiallySelected = groupSelectedCount > 0 && !groupAllSelected;
            const HeaderFolderIcon = collapsed ? Folder : FolderOpen;
            return (
              <div key={group.name} className="grid gap-1.5 rounded-[12px] border border-[rgba(60,60,67,0.1)] bg-[rgba(242,242,247,0.38)] p-2" data-testid={`resource-view-group-${groupDomId}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[9px] px-1.5 py-1 transition hover:bg-white/70">
                  <button
                    className="inline-flex min-w-0 items-center gap-1.5 text-left"
                    type="button"
                    onClick={() => toggleViewPresetGroup(group.name)}
                    aria-expanded={!collapsed}
                    data-testid={`resource-view-group-toggle-${groupDomId}`}
                  >
                    <ChevronDown className={`shrink-0 transition ${collapsed ? '-rotate-90' : ''}`} size={14} aria-hidden="true" />
                    <HeaderFolderIcon className="shrink-0 text-[rgba(60,60,67,0.56)]" size={13} aria-hidden="true" />
                    <span className="truncate text-xs font-semibold text-[#1d1d1f]">{group.name}</span>
                  </button>
                  <div className="flex items-center gap-1.5">
                    <label className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.1)] bg-white/72 px-2 py-1 text-xs font-semibold text-[rgba(60,60,67,0.72)]">
                      <input
                        className="h-3.5 w-3.5 rounded border-[rgba(60,60,67,0.24)] text-[#0057b8] focus:ring-[rgba(0,122,255,0.25)]"
                        type="checkbox"
                        checked={groupAllSelected}
                        ref={(node) => {
                          if (node) {
                            node.indeterminate = groupPartiallySelected;
                          }
                        }}
                        onChange={(event) => handleSetGroupViewPresetSelection(group.presets, event.currentTarget.checked)}
                        data-testid={`resource-view-group-select-${groupDomId}`}
                        aria-label={`${group.name} saved view 선택`}
                      />
                      선택
                    </label>
                    {groupSelectedCount > 0 ? <span className="ku-chip border-[rgba(0,122,255,0.2)] bg-[rgba(0,122,255,0.08)] text-[#0057b8]">{groupSelectedCount} selected</span> : null}
                    <span className="ku-chip">{normalizedViewPresetSearch ? `${group.presets.length} / ${group.total}` : `${group.presets.length} views`}</span>
                  </div>
                </div>
                {collapsed ? null : group.presets.map((preset, presetIndex) => {
                  const active = resourceViewPresetMatchesFilters(preset, currentFilters);
                  const isRenaming = renamingViewPreset?.originalName === preset.name;
                  const presetDomId = resourceViewPresetDomId(preset.name);
                  const presetBulkSelected = selectedViewPresetNames.has(preset.name);
                  const canMovePresetUp = canReorderViewPresets && presetIndex > 0;
                  const canMovePresetDown = canReorderViewPresets && presetIndex < group.presets.length - 1;
                  return (
                    <div
                      key={preset.name}
                      className={`grid gap-2 rounded-[10px] border p-2 transition sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${draggingViewPresetName === preset.name ? 'opacity-60' : ''} ${active ? 'border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.06)]' : 'border-[rgba(60,60,67,0.1)] bg-white/78'}`}
                      data-testid={`resource-view-preset-row-${presetDomId}`}
                      onDragOver={(event) => {
                        if (canReorderViewPresets) {
                          event.preventDefault();
                        }
                      }}
                      onDrop={(event) => handleDropViewPreset(preset, event)}
                    >
                      <div className="min-w-0">
                        {isRenaming ? (
                          <div className="grid gap-1.5">
                            <label className="grid gap-1">
                              <span className="ku-meta">saved view 이름</span>
                              <input
                                className="ku-input h-8 w-full text-xs"
                                value={renamingViewPreset.draftName}
                                onChange={(event) => setRenamingViewPreset((current) => current && current.originalName === preset.name ? { ...current, draftName: event.target.value.slice(0, 80), error: '' } : current)}
                                onKeyDown={handleResourceViewRenameKeyDown}
                                data-testid={`resource-view-rename-input-${presetDomId}`}
                                autoFocus
                              />
                            </label>
                            {renamingViewPreset.error ? (
                              <p className="rounded-[8px] border border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.08)] px-2 py-1 text-xs font-semibold text-[#8a4d00]" data-testid={`resource-view-rename-error-${presetDomId}`}>
                                {renamingViewPreset.error}
                              </p>
                            ) : null}
                            <p className="truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.54)]">{resourceViewPresetSummary(preset)}</p>
                          </div>
                        ) : (
                          <>
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <input
                                className="h-4 w-4 rounded border-[rgba(60,60,67,0.24)] text-[#0057b8] focus:ring-[rgba(0,122,255,0.25)]"
                                type="checkbox"
                                checked={presetBulkSelected}
                                onChange={(event) => handleToggleViewPresetSelection(preset.name, event.currentTarget.checked)}
                                aria-label={`${preset.name} saved view 선택`}
                                data-testid={`resource-view-select-${presetDomId}`}
                              />
                              <p className="truncate text-xs font-semibold text-[#1d1d1f]">{preset.name}</p>
                              {active ? <span className="rounded-full bg-[rgba(0,122,255,0.1)] px-1.5 py-0.5 text-[9px] font-semibold text-[#0057b8]">적용됨</span> : null}
                              <span className="rounded-full bg-[rgba(52,199,89,0.1)] px-1.5 py-0.5 text-[9px] font-semibold text-[#248a3d]">{preset.group}</span>
                              <span className="rounded-full bg-[rgba(60,60,67,0.06)] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[rgba(60,60,67,0.54)]">{formatPresetUpdatedAt(preset.updatedAt)}</span>
                            </div>
                            <p className="mt-0.5 truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.54)]">{resourceViewPresetSummary(preset)}</p>
                          </>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                        {isRenaming ? (
                          <>
                            <button
                              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.2)] bg-[rgba(0,122,255,0.08)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.12)]"
                              type="button"
                              onClick={handleCommitResourceViewRename}
                              data-testid={`resource-view-rename-save-${presetDomId}`}
                            >
                              <CheckCircle2 size={13} aria-hidden="true" />
                              저장
                            </button>
                            <button
                              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                              type="button"
                              onClick={handleCancelResourceViewRename}
                              data-testid={`resource-view-rename-cancel-${presetDomId}`}
                            >
                              <X size={13} aria-hidden="true" />
                              취소
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.64)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-45"
                              type="button"
                              draggable={canReorderViewPresets}
                              onDragStart={(event) => {
                                if (!canReorderViewPresets) {
                                  event.preventDefault();
                                  return;
                                }
                                setDraggingViewPresetName(preset.name);
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', preset.name);
                              }}
                              onDragEnd={() => setDraggingViewPresetName('')}
                              disabled={!canReorderViewPresets}
                              title={canReorderViewPresets ? 'Drag to reorder saved view' : '검색 해제 후 순서 변경'}
                              aria-label={`${preset.name} 순서 드래그`}
                              data-testid={`resource-view-drag-handle-${presetDomId}`}
                            >
                              <GripVertical size={13} aria-hidden="true" />
                            </button>
                            <button
                              className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white p-1.5 text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-45"
                              type="button"
                              onClick={() => handleMoveViewPreset(preset, -1)}
                              disabled={!canMovePresetUp}
                              aria-label={`${preset.name} 위로 이동`}
                              data-testid={`resource-view-reorder-up-${presetDomId}`}
                            >
                              <ArrowUp size={13} aria-hidden="true" />
                            </button>
                            <button
                              className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white p-1.5 text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-45"
                              type="button"
                              onClick={() => handleMoveViewPreset(preset, 1)}
                              disabled={!canMovePresetDown}
                              aria-label={`${preset.name} 아래로 이동`}
                              data-testid={`resource-view-reorder-down-${presetDomId}`}
                            >
                              <ArrowDown size={13} aria-hidden="true" />
                            </button>
                            <label className="grid min-w-[126px] gap-1">
                              <span className="ku-meta">Group</span>
                              <input
                                className="ku-input h-8 text-xs"
                                list="resource-view-group-options"
                                defaultValue={preset.group}
                                onBlur={(event) => handleUpdateViewPresetGroup(preset, event.currentTarget.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    handleUpdateViewPresetGroup(preset, event.currentTarget.value);
                                    event.currentTarget.blur();
                                  }
                                }}
                                data-testid={`resource-view-group-input-${presetDomId}`}
                              />
                            </label>
                            <button className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]" type="button" onClick={() => handleApplyViewPreset(preset)}>
                              적용
                            </button>
                            <button
                              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)]"
                              type="button"
                              onClick={() => handleStartResourceViewRename(preset)}
                              data-testid={`resource-view-rename-start-${presetDomId}`}
                              aria-label={`${preset.name} 이름 변경`}
                            >
                              <Pencil size={13} aria-hidden="true" />
                              이름 변경
                            </button>
                            <button className="rounded-[8px] border border-[rgba(255,59,48,0.18)] bg-[rgba(255,59,48,0.06)] p-1.5 text-[#c01f17] transition hover:bg-[rgba(255,59,48,0.1)]" type="button" onClick={() => handleDeleteViewPreset(preset.name)} aria-label={`${preset.name} 삭제`}>
                              <Trash2 size={14} aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ResourceViewCompareNames({ title, names, testId }: { title: string; names: string[]; testId: string }) {
  const visibleNames = names.slice(0, 3);
  return (
    <div className="grid gap-1 rounded-[9px] border border-[rgba(60,60,67,0.1)] bg-white/72 p-2" data-testid={testId}>
      <p className="ku-meta">{title} · {names.length}</p>
      {visibleNames.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {visibleNames.map((name) => (
            <span key={name} className="max-w-full truncate rounded-full bg-[rgba(60,60,67,0.06)] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[rgba(60,60,67,0.64)]">
              {name}
            </span>
          ))}
          {names.length > visibleNames.length ? (
            <span className="rounded-full bg-[rgba(60,60,67,0.06)] px-1.5 py-0.5 text-[9px] font-semibold text-[rgba(60,60,67,0.56)]">
              +{names.length - visibleNames.length} more
            </span>
          ) : null}
        </div>
      ) : (
        <p className="font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.48)]">none</p>
      )}
    </div>
  );
}
