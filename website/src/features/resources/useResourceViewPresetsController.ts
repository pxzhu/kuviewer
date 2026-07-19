import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, SetStateAction } from 'react';
import { fetchResourceViewPresets, saveResourceViewPresets } from '../../services/resourceApi';
import type { TopologySourceMode } from '../topology/useTopology';
import type { ResourceViewFilters } from './resourceViewState';
import {
  buildResourceViewTeamComparePreview,
  defaultResourceViewGroup,
  filterGroupedResourceViewPresets,
  groupResourceViewPresets,
  mergeResourceViewPresets,
  moveResourceViewPresetsToGroup,
  normalizePresetFilterValue,
  normalizeResourceViewPresetGroup,
  normalizeResourceViewPresetName,
  normalizeResourceViewPresetOrders,
  orderResourceViewPresets,
  readCollapsedResourceViewGroups,
  readResourceViewPresets,
  resourceViewConflictPendingMessage,
  resourceViewExportFileName,
  resourceViewImportItems,
  resourceViewMergeMessage,
  resourceViewPresetExportRecord,
  resourceViewPresetFolderNames,
  resourceViewPresetMatchesFilters,
  resourceViewPresetTargetName,
  resourceViewPresetTopOrderForGroup,
  resourceViewShareUrl,
  resourceViewTeamCompareMessage,
  resourceViewTeamSnapshotMetadata,
  resourceViewTeamSyncSummaryFromCompare,
  suggestedResourceViewPresetName,
  upsertResourceViewPreset,
  validResourceViewPreset,
  writeCollapsedResourceViewGroups,
  writeResourceViewPresets,
} from './resourceViewPresets.ts';
import type {
  ResourceViewConflictResolution,
  ResourceViewConflictSource,
  ResourceViewConflictState,
  ResourceViewMergeResult,
  ResourceViewMessage,
  ResourceViewPreset,
  ResourceViewRenameState,
  ResourceViewTeamComparePreview,
  ResourceViewTeamSyncSummary,
  ResourceViewTransferSummary,
} from './resourceViewPresets.ts';

interface ResourceViewControllerOptions {
  cluster: string;
  clusters: string[];
  downloadTextFile: (content: string, mimeType: string, fileName: string) => void;
  kind: string;
  kinds: string[];
  liveEnabled: boolean;
  namespace: string;
  namespaces: string[];
  onSelectNode: (nodeId: string) => void;
  query: string;
  setCluster: Dispatch<SetStateAction<string>>;
  setKind: Dispatch<SetStateAction<string>>;
  setNamespace: Dispatch<SetStateAction<string>>;
  setQuery: Dispatch<SetStateAction<string>>;
  setStatus: Dispatch<SetStateAction<string>>;
  sourceMode: TopologySourceMode;
  status: string;
  statuses: string[];
}

const allValue = 'all';

export function useResourceViewPresetsController({
  cluster,
  clusters,
  downloadTextFile,
  kind,
  kinds,
  liveEnabled,
  namespace,
  namespaces,
  onSelectNode,
  query,
  setCluster,
  setKind,
  setNamespace,
  setQuery,
  setStatus,
  sourceMode,
  status,
  statuses,
}: ResourceViewControllerOptions) {
  const currentPresetFilters = useMemo(() => ({ query, cluster, namespace, kind, status }), [cluster, kind, namespace, query, status]);
  const [viewPresets, setViewPresets] = useState<ResourceViewPreset[]>(() => readResourceViewPresets());
  const [presetName, setPresetName] = useState('');
  const [presetGroup, setPresetGroup] = useState(defaultResourceViewGroup);
  const [viewPresetSearch, setViewPresetSearch] = useState('');
  const [draggingViewPresetName, setDraggingViewPresetName] = useState('');
  const [selectedViewPresetNames, setSelectedViewPresetNames] = useState<Set<string>>(() => new Set());
  const [bulkViewPresetGroup, setBulkViewPresetGroup] = useState(defaultResourceViewGroup);
  const [bulkViewPresetDeleteConfirm, setBulkViewPresetDeleteConfirm] = useState(false);
  const [collapsedViewGroups, setCollapsedViewGroups] = useState<Set<string>>(() => readCollapsedResourceViewGroups());
  const [resourceViewMessage, setResourceViewMessage] = useState<ResourceViewMessage | null>(null);
  const [resourceViewTransferSummary, setResourceViewTransferSummary] = useState<ResourceViewTransferSummary | null>(null);
  const [resourceViewTeamSyncSummary, setResourceViewTeamSyncSummary] = useState<ResourceViewTeamSyncSummary | null>(null);
  const [resourceViewTeamComparePreview, setResourceViewTeamComparePreview] = useState<ResourceViewTeamComparePreview | null>(null);
  const [resourceViewConflict, setResourceViewConflict] = useState<ResourceViewConflictState | null>(null);
  const [renamingViewPreset, setRenamingViewPreset] = useState<ResourceViewRenameState | null>(null);
  const [resourceViewTeamLoading, setResourceViewTeamLoading] = useState(false);
  const [resourceViewTeamSaveConfirm, setResourceViewTeamSaveConfirm] = useState(false);
  const viewPresetImportInputRef = useRef<HTMLInputElement>(null);

  const suggestedPresetName = useMemo(() => suggestedResourceViewPresetName({ query, cluster, namespace, kind, status }), [cluster, kind, namespace, query, status]);
  const matchingViewPreset = useMemo(() => viewPresets.find((preset) => resourceViewPresetMatchesFilters(preset, currentPresetFilters)), [currentPresetFilters, viewPresets]);
  const nextPresetName = resourceViewPresetTargetName(presetName, matchingViewPreset?.name || suggestedPresetName);
  const nextPresetGroup = normalizeResourceViewPresetGroup(presetGroup || matchingViewPreset?.group || defaultResourceViewGroup);
  const presetNameExists = viewPresets.some((preset) => preset.name === nextPresetName);
  const groupedViewPresets = useMemo(() => groupResourceViewPresets(viewPresets), [viewPresets]);
  const normalizedViewPresetSearch = viewPresetSearch.trim().toLowerCase();
  const canReorderViewPresets = normalizedViewPresetSearch.length === 0;
  const filteredGroupedViewPresets = useMemo(() => filterGroupedResourceViewPresets(groupedViewPresets, normalizedViewPresetSearch), [groupedViewPresets, normalizedViewPresetSearch]);
  const visibleViewPresets = useMemo(() => filteredGroupedViewPresets.flatMap((group) => group.presets), [filteredGroupedViewPresets]);
  const selectedViewPresets = useMemo(() => orderResourceViewPresets(viewPresets.filter((preset) => selectedViewPresetNames.has(preset.name))), [selectedViewPresetNames, viewPresets]);
  const selectedViewPresetCount = selectedViewPresets.length;
  const allVisibleViewPresetsSelected = visibleViewPresets.length > 0 && visibleViewPresets.every((preset) => selectedViewPresetNames.has(preset.name));
  const visibleViewPresetFolderCount = filteredGroupedViewPresets.length;
  const collapsedVisibleViewPresetFolderCount = filteredGroupedViewPresets.filter((group) => collapsedViewGroups.has(group.name)).length;
  const selectedVisibleViewPresetCount = visibleViewPresets.filter((preset) => selectedViewPresetNames.has(preset.name)).length;
  const viewPresetGroupOptions = useMemo(() => unique([defaultResourceViewGroup, ...viewPresets.map((preset) => preset.group)]), [viewPresets]);
  const savePresetLabel = matchingViewPreset || presetNameExists ? '뷰 업데이트' : '뷰 저장';
  const teamResourceViewsEnabled = sourceMode === 'live' && liveEnabled;

  useEffect(() => {
    writeCollapsedResourceViewGroups(collapsedViewGroups);
  }, [collapsedViewGroups]);

  useEffect(() => {
    const existingPresetNames = new Set(viewPresets.map((preset) => preset.name));
    setSelectedViewPresetNames((current) => {
      const next = new Set([...current].filter((presetName) => existingPresetNames.has(presetName)));
      return next.size === current.size ? current : next;
    });
    setBulkViewPresetDeleteConfirm(false);
  }, [viewPresets]);
  useEffect(() => {
    setResourceViewTeamSaveConfirm(false);
    setResourceViewTeamComparePreview(null);
  }, [sourceMode, viewPresets]);

  const handleSaveViewPreset = () => {
    setResourceViewConflict(null);
    setRenamingViewPreset(null);
    const existingPreset = viewPresets.find((preset) => preset.name === nextPresetName);
    const nextPreset: ResourceViewPreset = {
      name: nextPresetName,
      group: nextPresetGroup,
      query: query.slice(0, 160),
      cluster,
      namespace,
      kind,
      status,
      order: existingPreset?.order ?? resourceViewPresetTopOrderForGroup(viewPresets, nextPresetGroup),
      updatedAt: Date.now(),
    };
    const nextPresets = upsertResourceViewPreset(viewPresets, nextPreset);
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    setPresetName(nextPreset.name);
    setPresetGroup(nextPreset.group);
  };

  const handleApplyViewPreset = (preset: ResourceViewPreset) => {
    setRenamingViewPreset(null);
    setQuery(preset.query);
    setCluster(normalizePresetFilterValue(preset.cluster, clusters));
    setNamespace(normalizePresetFilterValue(preset.namespace, namespaces));
    setKind(normalizePresetFilterValue(preset.kind, kinds));
    setStatus(normalizePresetFilterValue(preset.status, statuses));
    setPresetName(preset.name);
    setPresetGroup(preset.group);
    onSelectNode('');
  };

  const handleDeleteViewPreset = (presetNameToDelete: string) => {
    setResourceViewConflict(null);
    setRenamingViewPreset(null);
    const nextPresets = normalizeResourceViewPresetOrders(viewPresets.filter((preset) => preset.name !== presetNameToDelete));
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    setSelectedViewPresetNames((current) => {
      if (!current.has(presetNameToDelete)) {
        return current;
      }
      const next = new Set(current);
      next.delete(presetNameToDelete);
      return next;
    });
    setBulkViewPresetDeleteConfirm(false);
    if (presetName.trim() === presetNameToDelete) {
      setPresetName('');
    }
  };

  const handleCopyResourceViewLink = async () => {
    const url = resourceViewShareUrl(currentPresetFilters, sourceMode);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('clipboard_unavailable');
      }
      await navigator.clipboard.writeText(url);
      setResourceViewMessage({ tone: 'success', text: '공유 링크를 클립보드에 복사했습니다.' });
    } catch {
      setResourceViewMessage({ tone: 'warning', text: '클립보드 복사가 지원되지 않아 공유 링크를 복사하지 못했습니다.' });
    }
  };

  const handleExportViewPresets = () => {
    const exportPresets = normalizeResourceViewPresetOrders(viewPresets);
    const fileName = resourceViewExportFileName('all');
    const payload = `${JSON.stringify(exportPresets.map(resourceViewPresetExportRecord), null, 2)}\n`;
    downloadTextFile(payload, 'application/json;charset=utf-8', fileName);
    setResourceViewTransferSummary({
      action: 'export',
      scope: 'all',
      fileName,
      count: exportPresets.length,
      skippedCount: 0,
      folders: resourceViewPresetFolderNames(exportPresets),
    });
    setResourceViewMessage({ tone: 'success', text: `저장된 뷰 ${exportPresets.length}개를 ${fileName} 파일로 내보냈습니다.` });
  };
  const handleExportSelectedViewPresets = () => {
    if (selectedViewPresetCount === 0) {
      return;
    }
    const exportPresets = normalizeResourceViewPresetOrders(selectedViewPresets);
    const fileName = resourceViewExportFileName('selected');
    const payload = `${JSON.stringify(exportPresets.map(resourceViewPresetExportRecord), null, 2)}\n`;
    downloadTextFile(payload, 'application/json;charset=utf-8', fileName);
    setResourceViewTransferSummary({
      action: 'export',
      scope: 'selected',
      fileName,
      count: exportPresets.length,
      skippedCount: 0,
      folders: resourceViewPresetFolderNames(exportPresets),
    });
    setBulkViewPresetDeleteConfirm(false);
    setResourceViewMessage({ tone: 'success', text: `선택한 saved view ${exportPresets.length}개를 ${fileName} 파일로 내보냈습니다.` });
  };

  const handleImportViewPresets = async (file?: File) => {
    if (!file) {
      return;
    }
    try {
      const parsedValue = JSON.parse(await file.text());
      const parsedImport = resourceViewImportItems(parsedValue);
      if (!parsedImport) {
        setResourceViewConflict(null);
        setRenamingViewPreset(null);
        setResourceViewTransferSummary(null);
        setResourceViewMessage({ tone: 'warning', text: '가져오기 실패: saved view JSON 배열 또는 { items } 형식이 아닙니다.' });
        return;
      }
      const importedPresets = normalizeResourceViewPresetOrders(parsedImport.items.flatMap((value, index) => validResourceViewPreset(value, index + 1)));
      const skippedCount = Math.max(0, parsedImport.items.length - importedPresets.length);
      if (importedPresets.length === 0) {
        setResourceViewConflict(null);
        setRenamingViewPreset(null);
        setResourceViewTransferSummary({
          action: 'import',
          scope: 'incoming',
          fileName: file.name || 'resource-views.json',
          count: 0,
          skippedCount,
          folders: [],
          format: parsedImport.format,
        });
        setResourceViewMessage({ tone: 'warning', text: `가져오기 실패: 유효한 saved view가 없습니다. ${parsedImport.items.length}개 항목을 건너뛰었습니다.` });
        return;
      }
      setResourceViewTransferSummary({
        action: 'import',
        scope: 'incoming',
        fileName: file.name || 'resource-views.json',
        count: importedPresets.length,
        skippedCount,
        folders: resourceViewPresetFolderNames(importedPresets),
        format: parsedImport.format,
      });
      handleIncomingResourceViewPresets('import', importedPresets, skippedCount);
    } catch {
      setResourceViewConflict(null);
      setRenamingViewPreset(null);
      setResourceViewTransferSummary(null);
      setResourceViewMessage({ tone: 'warning', text: '가져오기 실패: JSON 파일을 읽을 수 없습니다.' });
    }
  };

  const handleLoadTeamViewPresets = async () => {
    if (!teamResourceViewsEnabled) {
      setResourceViewMessage({ tone: 'warning', text: '팀 뷰는 Live Cluster 연결과 admin token이 활성화된 상태에서 사용할 수 있습니다.' });
      return;
    }
    setResourceViewTeamSaveConfirm(false);
    setResourceViewTeamLoading(true);
    try {
      const response = await fetchResourceViewPresets();
      const teamPresets = normalizeResourceViewPresetOrders(response.items.flatMap((value, index) => validResourceViewPreset(value, index + 1)));
      const skippedCount = Math.max(0, response.items.length - teamPresets.length);
      const snapshotMetadata = resourceViewTeamSnapshotMetadata(response.metadata, teamPresets.length);
      const comparePreview = buildResourceViewTeamComparePreview('load', viewPresets, teamPresets, skippedCount, snapshotMetadata);
      setResourceViewTransferSummary(null);
      setResourceViewTeamSyncSummary(null);
      setResourceViewConflict(null);
      setRenamingViewPreset(null);
      setResourceViewTeamComparePreview(comparePreview);
      setResourceViewMessage({
        tone: comparePreview.conflictNames.length > 0 || comparePreview.invalidCount > 0 || comparePreview.mergeResult.droppedCount > 0 ? 'warning' : 'success',
        text: resourceViewTeamCompareMessage(comparePreview),
      });
    } catch {
      setResourceViewConflict(null);
      setRenamingViewPreset(null);
      setResourceViewTeamSyncSummary(null);
      setResourceViewTeamComparePreview(null);
      setResourceViewMessage({ tone: 'warning', text: '팀 뷰를 불러오지 못했습니다. admin token 또는 서버 상태를 확인하세요.' });
    } finally {
      setResourceViewTeamLoading(false);
    }
  };

  const handleSaveTeamViewPresets = async () => {
    if (!teamResourceViewsEnabled) {
      setResourceViewMessage({ tone: 'warning', text: '팀 뷰는 Live Cluster 연결과 admin token이 활성화된 상태에서 사용할 수 있습니다.' });
      return;
    }
    if (resourceViewTeamComparePreview?.action === 'save' && resourceViewTeamSaveConfirm) {
      await handleConfirmTeamSavePreview();
      return;
    }
    if (!resourceViewTeamSaveConfirm) {
      await handlePrepareTeamSavePreview();
      return;
    }
    await handleConfirmTeamSavePreview();
  };

  const handlePrepareTeamSavePreview = async () => {
    if (!teamResourceViewsEnabled) {
      setResourceViewMessage({ tone: 'warning', text: '팀 뷰는 Live Cluster 연결과 admin token이 활성화된 상태에서 사용할 수 있습니다.' });
      return;
    }
    setResourceViewTeamLoading(true);
    try {
      const response = await fetchResourceViewPresets();
      const teamPresets = normalizeResourceViewPresetOrders(response.items.flatMap((value, index) => validResourceViewPreset(value, index + 1)));
      const skippedCount = Math.max(0, response.items.length - teamPresets.length);
      const snapshotMetadata = resourceViewTeamSnapshotMetadata(response.metadata, teamPresets.length);
      const comparePreview = buildResourceViewTeamComparePreview('save', viewPresets, teamPresets, skippedCount, snapshotMetadata);
      setResourceViewConflict(null);
      setRenamingViewPreset(null);
      setResourceViewTransferSummary(null);
      setResourceViewTeamSyncSummary(null);
      setResourceViewTeamComparePreview(comparePreview);
      setResourceViewTeamSaveConfirm(true);
      setResourceViewMessage({
        tone: comparePreview.conflictNames.length > 0 || comparePreview.teamOnlyNames.length > 0 || comparePreview.invalidCount > 0 ? 'warning' : 'success',
        text: `${resourceViewTeamCompareMessage(comparePreview)} 저장 실행 전 한 번 더 확인하세요.`,
      });
    } catch {
      setResourceViewTeamSaveConfirm(false);
      setResourceViewTeamComparePreview(null);
      setResourceViewMessage({ tone: 'warning', text: '팀 뷰 비교 미리보기를 불러오지 못했습니다. admin token 또는 서버 상태를 확인하세요.' });
    } finally {
      setResourceViewTeamLoading(false);
    }
  };

  const handleConfirmTeamSavePreview = async () => {
    if (!teamResourceViewsEnabled) {
      setResourceViewMessage({ tone: 'warning', text: '팀 뷰는 Live Cluster 연결과 admin token이 활성화된 상태에서 사용할 수 있습니다.' });
      return;
    }
    setResourceViewTeamLoading(true);
    try {
      setResourceViewConflict(null);
      setRenamingViewPreset(null);
      setResourceViewTeamSaveConfirm(false);
      const response = await saveResourceViewPresets(normalizeResourceViewPresetOrders(viewPresets).map(resourceViewPresetExportRecord));
      const savedPresets = normalizeResourceViewPresetOrders(response.items.flatMap((value, index) => validResourceViewPreset(value, index + 1)));
      const skippedCount = Math.max(0, viewPresets.length - savedPresets.length);
      const snapshotMetadata = resourceViewTeamSnapshotMetadata(response.metadata, savedPresets.length);
      setViewPresets(savedPresets);
      writeResourceViewPresets(savedPresets);
      setResourceViewTransferSummary(null);
      setResourceViewTeamSyncSummary({
        action: 'save',
        count: savedPresets.length,
        skippedCount,
        conflictCount: 0,
        duplicateCount: 0,
        newCount: 0,
        localCount: viewPresets.length,
        folders: resourceViewPresetFolderNames(savedPresets),
        timestamp: Date.now(),
        snapshotMetadata,
      });
      setResourceViewTeamComparePreview(null);
      setResourceViewMessage({ tone: 'success', text: `현재 브라우저 뷰 ${savedPresets.length}개를 팀 뷰로 저장했습니다.` });
    } catch {
      setResourceViewTeamSyncSummary(null);
      setResourceViewTeamComparePreview(null);
      setResourceViewMessage({ tone: 'warning', text: '팀 뷰를 저장하지 못했습니다. admin token 또는 서버 상태를 확인하세요.' });
    } finally {
      setResourceViewTeamLoading(false);
    }
  };

  const handleApplyTeamLoadPreview = () => {
    if (!resourceViewTeamComparePreview || resourceViewTeamComparePreview.action !== 'load') {
      return;
    }
    setResourceViewTeamSyncSummary(resourceViewTeamSyncSummaryFromCompare(resourceViewTeamComparePreview));
    setResourceViewTeamComparePreview(null);
    handleIncomingResourceViewPresets('team', resourceViewTeamComparePreview.incomingPresets, resourceViewTeamComparePreview.invalidCount);
  };

  const handleDismissTeamComparePreview = () => {
    setResourceViewTeamComparePreview(null);
    setResourceViewTeamSaveConfirm(false);
  };

  const handleResetResourceFilters = () => {
    setRenamingViewPreset(null);
    setQuery('');
    setCluster(allValue);
    setNamespace(allValue);
    setKind(allValue);
    setStatus(allValue);
    setPresetName('');
    setPresetGroup(defaultResourceViewGroup);
    setResourceViewMessage(null);
    onSelectNode('');
  };
  const handleClearActiveResourceFilter = (filterId: keyof ResourceViewFilters) => {
    setRenamingViewPreset(null);
    setResourceViewMessage(null);
    if (filterId === 'query') {
      setQuery('');
    } else if (filterId === 'cluster') {
      setCluster(allValue);
    } else if (filterId === 'namespace') {
      setNamespace(allValue);
    } else if (filterId === 'kind') {
      setKind(allValue);
    } else if (filterId === 'status') {
      setStatus(allValue);
    }
  };
  const handleIncomingResourceViewPresets = (source: ResourceViewConflictSource, incomingPresets: ResourceViewPreset[], invalidCount: number) => {
    setRenamingViewPreset(null);
    const mergeResult = mergeResourceViewPresets(viewPresets, incomingPresets, 'incoming');
    if (mergeResult.conflicts.length > 0) {
      setResourceViewConflict({
        source,
        basePresets: viewPresets,
        incomingPresets,
        conflicts: mergeResult.conflicts,
        duplicateCount: mergeResult.duplicateCount,
        invalidCount,
        incomingCount: incomingPresets.length,
      });
      setResourceViewMessage({
        tone: 'warning',
        text: resourceViewConflictPendingMessage(source, mergeResult.conflicts.length, mergeResult.duplicateCount, invalidCount),
      });
      return;
    }
    applyResourceViewMergeResult(source, mergeResult, invalidCount, false);
  };
  const handleResolveResourceViewConflicts = (resolution: ResourceViewConflictResolution) => {
    if (!resourceViewConflict) {
      return;
    }
    const mergeResult = mergeResourceViewPresets(resourceViewConflict.basePresets, resourceViewConflict.incomingPresets, resolution);
    applyResourceViewMergeResult(resourceViewConflict.source, mergeResult, resourceViewConflict.invalidCount, true);
  };
  const applyResourceViewMergeResult = (source: ResourceViewConflictSource, mergeResult: ResourceViewMergeResult, invalidCount: number, resolved: boolean) => {
    setViewPresets(mergeResult.presets);
    writeResourceViewPresets(mergeResult.presets);
    setResourceViewConflict(null);
    setRenamingViewPreset(null);
    setResourceViewMessage({
      tone: mergeResult.conflicts.length > 0 || invalidCount > 0 || mergeResult.droppedCount > 0 ? 'warning' : 'success',
      text: resourceViewMergeMessage(source, mergeResult, invalidCount, resolved),
    });
  };
  const handleToggleViewPresetSelection = (presetNameToToggle: string, selected: boolean) => {
    setSelectedViewPresetNames((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(presetNameToToggle);
      } else {
        next.delete(presetNameToToggle);
      }
      return next;
    });
    setBulkViewPresetDeleteConfirm(false);
  };
  const handleSetVisibleViewPresetSelection = (selected: boolean) => {
    setSelectedViewPresetNames((current) => {
      const next = new Set(current);
      visibleViewPresets.forEach((preset) => {
        if (selected) {
          next.add(preset.name);
        } else {
          next.delete(preset.name);
        }
      });
      return next;
    });
    setBulkViewPresetDeleteConfirm(false);
    setResourceViewMessage(selected ? { tone: 'success', text: `현재 결과 saved view ${visibleViewPresets.length}개를 선택했습니다.` } : null);
  };
  const handleSetGroupViewPresetSelection = (presets: ResourceViewPreset[], selected: boolean) => {
    setSelectedViewPresetNames((current) => {
      const next = new Set(current);
      presets.forEach((preset) => {
        if (selected) {
          next.add(preset.name);
        } else {
          next.delete(preset.name);
        }
      });
      return next;
    });
    setBulkViewPresetDeleteConfirm(false);
  };
  const handleClearViewPresetSelection = () => {
    setSelectedViewPresetNames(new Set());
    setBulkViewPresetDeleteConfirm(false);
  };
  const handleBulkMoveViewPresets = () => {
    if (selectedViewPresetCount === 0) {
      return;
    }
    const targetGroup = normalizeResourceViewPresetGroup(bulkViewPresetGroup);
    const nextPresets = moveResourceViewPresetsToGroup(viewPresets, selectedViewPresetNames, targetGroup);
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    setBulkViewPresetGroup(targetGroup);
    setBulkViewPresetDeleteConfirm(false);
    setResourceViewConflict(null);
    setRenamingViewPreset(null);
    if (matchingViewPreset && selectedViewPresetNames.has(matchingViewPreset.name)) {
      setPresetGroup(targetGroup);
    }
    setResourceViewMessage({ tone: 'success', text: `선택한 saved view ${selectedViewPresetCount}개를 ${targetGroup} 그룹으로 이동했습니다.` });
  };
  const handleBulkDeleteViewPresets = () => {
    if (selectedViewPresetCount === 0) {
      return;
    }
    if (!bulkViewPresetDeleteConfirm) {
      setBulkViewPresetDeleteConfirm(true);
      setResourceViewMessage({ tone: 'warning', text: `선택한 saved view ${selectedViewPresetCount}개를 삭제하려면 한 번 더 누르세요.` });
      return;
    }
    const selectedNames = new Set(selectedViewPresets.map((preset) => preset.name));
    const nextPresets = normalizeResourceViewPresetOrders(viewPresets.filter((preset) => !selectedNames.has(preset.name)));
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    setSelectedViewPresetNames(new Set());
    setBulkViewPresetDeleteConfirm(false);
    setResourceViewConflict(null);
    setRenamingViewPreset(null);
    if (selectedNames.has(presetName.trim()) || (matchingViewPreset && selectedNames.has(matchingViewPreset.name))) {
      setPresetName('');
      setPresetGroup(defaultResourceViewGroup);
    }
    setResourceViewMessage({ tone: 'success', text: `선택한 saved view ${selectedNames.size}개를 삭제했습니다.` });
  };
  const handleStartResourceViewRename = (preset: ResourceViewPreset) => {
    setResourceViewConflict(null);
    setResourceViewMessage(null);
    setRenamingViewPreset({ originalName: preset.name, draftName: preset.name, error: '' });
  };
  const handleCancelResourceViewRename = () => {
    setRenamingViewPreset(null);
  };
  const handleCommitResourceViewRename = () => {
    if (!renamingViewPreset) {
      return;
    }
    const targetName = normalizeResourceViewPresetName(renamingViewPreset.draftName);
    if (!targetName) {
      setRenamingViewPreset((current) => current && current.originalName === renamingViewPreset.originalName ? { ...current, error: '이름을 입력하세요.' } : current);
      return;
    }
    if (targetName === renamingViewPreset.originalName) {
      setRenamingViewPreset(null);
      setResourceViewMessage({ tone: 'success', text: 'saved view 이름이 변경되지 않았습니다.' });
      return;
    }
    if (viewPresets.some((preset) => preset.name === targetName && preset.name !== renamingViewPreset.originalName)) {
      setRenamingViewPreset((current) => current && current.originalName === renamingViewPreset.originalName ? { ...current, error: '이미 같은 이름의 saved view가 있습니다.' } : current);
      return;
    }
    let renamed = false;
    const nextPresets = viewPresets.map((preset) => {
      if (preset.name !== renamingViewPreset.originalName) {
        return preset;
      }
      renamed = true;
      return { ...preset, name: targetName, updatedAt: Date.now() };
    });
    if (!renamed) {
      setRenamingViewPreset(null);
      setResourceViewMessage({ tone: 'warning', text: '이름을 변경할 saved view를 찾을 수 없습니다.' });
      return;
    }
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    setRenamingViewPreset(null);
    if (presetName.trim() === renamingViewPreset.originalName || matchingViewPreset?.name === renamingViewPreset.originalName) {
      setPresetName(targetName);
    }
    setResourceViewMessage({ tone: 'success', text: `saved view 이름을 "${targetName}"으로 변경했습니다.` });
  };
  const handleUpdateViewPresetGroup = (preset: ResourceViewPreset, groupValue: string) => {
    const targetGroup = normalizeResourceViewPresetGroup(groupValue);
    if (targetGroup === preset.group) {
      return;
    }
    const nextPresets = normalizeResourceViewPresetOrders(viewPresets.map((candidate) => candidate.name === preset.name ? { ...candidate, group: targetGroup, order: resourceViewPresetTopOrderForGroup(viewPresets, targetGroup), updatedAt: Date.now() } : candidate));
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    if (presetName.trim() === preset.name || matchingViewPreset?.name === preset.name) {
      setPresetGroup(targetGroup);
    }
    setResourceViewMessage({ tone: 'success', text: `"${preset.name}" 뷰를 ${targetGroup} 그룹으로 이동했습니다.` });
  };
  const handleMoveViewPreset = (preset: ResourceViewPreset, direction: -1 | 1) => {
    if (!canReorderViewPresets) {
      return;
    }
    const groupName = normalizeResourceViewPresetGroup(preset.group);
    const groupPresets = orderResourceViewPresets(viewPresets.filter((candidate) => normalizeResourceViewPresetGroup(candidate.group) === groupName));
    const currentIndex = groupPresets.findIndex((candidate) => candidate.name === preset.name);
    const targetPreset = groupPresets[currentIndex + direction];
    if (currentIndex < 0 || !targetPreset) {
      return;
    }
    const nextPresets = normalizeResourceViewPresetOrders(viewPresets.map((candidate) => {
      if (candidate.name === preset.name) {
        return { ...candidate, order: targetPreset.order };
      }
      if (candidate.name === targetPreset.name) {
        return { ...candidate, order: preset.order };
      }
      return candidate;
    }));
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    setResourceViewMessage({ tone: 'success', text: `"${preset.name}" 뷰 순서를 변경했습니다.` });
  };
  const handleDropViewPreset = (targetPreset: ResourceViewPreset, event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!canReorderViewPresets) {
      setDraggingViewPresetName('');
      return;
    }
    const sourceName = event.dataTransfer.getData('text/plain') || draggingViewPresetName;
    const sourcePreset = viewPresets.find((preset) => preset.name === sourceName);
    if (!sourcePreset || sourcePreset.name === targetPreset.name || normalizeResourceViewPresetGroup(sourcePreset.group) !== normalizeResourceViewPresetGroup(targetPreset.group)) {
      setDraggingViewPresetName('');
      return;
    }
    const groupName = normalizeResourceViewPresetGroup(targetPreset.group);
    const groupPresets = orderResourceViewPresets(viewPresets.filter((candidate) => normalizeResourceViewPresetGroup(candidate.group) === groupName && candidate.name !== sourcePreset.name));
    const targetIndex = Math.max(0, groupPresets.findIndex((candidate) => candidate.name === targetPreset.name));
    const reorderedGroup = [...groupPresets.slice(0, targetIndex), sourcePreset, ...groupPresets.slice(targetIndex)];
    const orderByName = new Map(reorderedGroup.map((candidate, index) => [candidate.name, index + 1]));
    const nextPresets = normalizeResourceViewPresetOrders(viewPresets.map((candidate) => orderByName.has(candidate.name) ? { ...candidate, order: orderByName.get(candidate.name) ?? candidate.order } : candidate));
    setViewPresets(nextPresets);
    writeResourceViewPresets(nextPresets);
    setDraggingViewPresetName('');
    setResourceViewMessage({ tone: 'success', text: `"${sourcePreset.name}" 뷰 순서를 변경했습니다.` });
  };
  const toggleViewPresetGroup = (groupName: string) => {
    setCollapsedViewGroups((current) => {
      const next = new Set(current);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };
  const handleExpandVisibleViewPresetFolders = () => {
    const visibleGroupNames = new Set(filteredGroupedViewPresets.map((group) => group.name));
    setCollapsedViewGroups((current) => {
      const next = new Set([...current].filter((groupName) => !visibleGroupNames.has(groupName)));
      return next;
    });
    setResourceViewMessage({ tone: 'success', text: `saved view folder ${visibleGroupNames.size}개를 펼쳤습니다.` });
  };
  const handleCollapseVisibleViewPresetFolders = () => {
    setCollapsedViewGroups((current) => {
      const next = new Set(current);
      filteredGroupedViewPresets.forEach((group) => next.add(group.name));
      return next;
    });
    setResourceViewMessage({ tone: 'success', text: `saved view folder ${filteredGroupedViewPresets.length}개를 접었습니다.` });
  };
  const handleResourceViewRenameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleCommitResourceViewRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelResourceViewRename();
    }
  };

  return {
    viewPresets,
    presetName,
    setPresetName,
    presetGroup,
    setPresetGroup,
    viewPresetSearch,
    setViewPresetSearch,
    draggingViewPresetName,
    setDraggingViewPresetName,
    selectedViewPresetNames,
    bulkViewPresetGroup,
    setBulkViewPresetGroup,
    bulkViewPresetDeleteConfirm,
    setBulkViewPresetDeleteConfirm,
    collapsedViewGroups,
    resourceViewMessage,
    resourceViewTransferSummary,
    setResourceViewTransferSummary,
    resourceViewTeamSyncSummary,
    setResourceViewTeamSyncSummary,
    resourceViewTeamComparePreview,
    resourceViewConflict,
    setResourceViewConflict,
    renamingViewPreset,
    setRenamingViewPreset,
    resourceViewTeamLoading,
    resourceViewTeamSaveConfirm,
    viewPresetImportInputRef,
    suggestedPresetName,
    matchingViewPreset,
    presetNameExists,
    groupedViewPresets,
    normalizedViewPresetSearch,
    canReorderViewPresets,
    filteredGroupedViewPresets,
    visibleViewPresets,
    selectedViewPresetCount,
    allVisibleViewPresetsSelected,
    visibleViewPresetFolderCount,
    collapsedVisibleViewPresetFolderCount,
    selectedVisibleViewPresetCount,
    viewPresetGroupOptions,
    savePresetLabel,
    teamResourceViewsEnabled,
    handleSaveViewPreset,
    handleApplyViewPreset,
    handleDeleteViewPreset,
    handleCopyResourceViewLink,
    handleExportViewPresets,
    handleExportSelectedViewPresets,
    handleImportViewPresets,
    handleLoadTeamViewPresets,
    handleSaveTeamViewPresets,
    handleConfirmTeamSavePreview,
    handleApplyTeamLoadPreview,
    handleDismissTeamComparePreview,
    handleResetResourceFilters,
    handleClearActiveResourceFilter,
    handleResolveResourceViewConflicts,
    handleToggleViewPresetSelection,
    handleSetVisibleViewPresetSelection,
    handleSetGroupViewPresetSelection,
    handleClearViewPresetSelection,
    handleBulkMoveViewPresets,
    handleBulkDeleteViewPresets,
    handleStartResourceViewRename,
    handleCancelResourceViewRename,
    handleCommitResourceViewRename,
    handleUpdateViewPresetGroup,
    handleMoveViewPreset,
    handleDropViewPreset,
    toggleViewPresetGroup,
    handleExpandVisibleViewPresetFolders,
    handleCollapseVisibleViewPresetFolders,
    handleResourceViewRenameKeyDown,
  };
}

function unique(values: string[]) {
  return Array.from(new Set(values)).sort();
}
