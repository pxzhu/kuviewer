import {
  CheckCircle2,
  Download,
  GitBranch,
  Link2,
  RefreshCw,
  RotateCcw,
  Upload,
} from 'lucide-react';
import type { ResourceViewFilters } from '../../features/resources/resourceViewState';
import {
  formatPresetUpdatedAt,
  formatResourceViewTeamSnapshotMetadata,
  maxResourceViewPresets,
  resourceViewIncomingNewCount,
  resourceViewPresetSummary,
  resourceViewSourceLabel,
  resourceViewSourceShortLabel,
  resourceViewTeamCompareActionLabel,
  resourceViewTeamSyncActionLabel,
  resourceViewTransferActionLabel,
} from '../../features/resources/resourceViewPresets';
import type { ResourceViewPresetsController } from '../../features/resources/useResourceViewPresetsController';
import { ResourceViewPresetCollection } from './ResourceViewPresetCollection';

interface ResourceViewPresetsPanelProps {
  controller: ResourceViewPresetsController;
  currentFilters: ResourceViewFilters;
  filtersAreDefault: boolean;
}

export function ResourceViewPresetsPanel({ controller, currentFilters, filtersAreDefault }: ResourceViewPresetsPanelProps) {
  const {
    handleApplyTeamLoadPreview,
    handleConfirmTeamSavePreview,
    handleCopyResourceViewLink,
    handleDismissTeamComparePreview,
    handleExportViewPresets,
    handleImportViewPresets,
    handleLoadTeamViewPresets,
    handleResetResourceFilters,
    handleResolveResourceViewConflicts,
    handleSaveTeamViewPresets,
    matchingViewPreset,
    resourceViewConflict,
    resourceViewMessage,
    resourceViewTeamComparePreview,
    resourceViewTeamLoading,
    resourceViewTeamSaveConfirm,
    resourceViewTeamSyncSummary,
    resourceViewTransferSummary,
    setResourceViewConflict,
    setResourceViewTeamSyncSummary,
    setResourceViewTransferSummary,
    teamResourceViewsEnabled,
    viewPresetImportInputRef,
    viewPresets,
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
      <ResourceViewPresetCollection controller={controller} currentFilters={currentFilters} />
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
