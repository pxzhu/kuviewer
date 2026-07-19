import type { CSSProperties, KeyboardEventHandler, MutableRefObject } from 'react';
import { Copy, Download, RefreshCw } from 'lucide-react';
import type { ResourceExplorerItem } from '../../types/resourceExplorer';

type ResourceListDensity = 'comfortable' | 'compact';
type ResourceListOptionalColumn = 'namespace' | 'cluster' | 'age' | 'summary';
type ResourceListColumnPreference = Record<ResourceListOptionalColumn, boolean>;

interface ResourceBulkMessage {
  tone: 'success' | 'warning';
  text: string;
}

export interface ResourceExplorerListPanelProps {
  allVisibleSelected: boolean;
  bulkMessage: ResourceBulkMessage | null;
  columns: ResourceListColumnPreference;
  density: ResourceListDensity;
  loadingMore: boolean;
  nextCursor: string;
  onClearSelection: () => void;
  onCopySelectedNames: () => void;
  onExportSelected: (format: 'json' | 'csv') => void;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onLoadMore: () => void;
  onSelectAll: () => void;
  onSelectResource: (resourceId: string) => void;
  onToggleSelection: (resourceId: string, selected: boolean) => void;
  resources: ResourceExplorerItem[];
  rowRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  selectedResourceId: string;
  selectedResourceIndex: number;
  selectedResourceIds: ReadonlySet<string>;
  totalFilteredCount: number;
}

export function ResourceExplorerListPanel({
  allVisibleSelected,
  bulkMessage,
  columns,
  density,
  loadingMore,
  nextCursor,
  onClearSelection,
  onCopySelectedNames,
  onExportSelected,
  onKeyDown,
  onLoadMore,
  onSelectAll,
  onSelectResource,
  onToggleSelection,
  resources,
  rowRefs,
  selectedResourceId,
  selectedResourceIndex,
  selectedResourceIds,
  totalFilteredCount,
}: ResourceExplorerListPanelProps) {
  const selectedCount = selectedResourceIds.size;
  const summaryLimit = density === 'compact' ? 2 : 3;
  const gridClassName = density === 'compact'
    ? 'grid gap-1.5 md:[grid-template-columns:var(--resource-list-columns)] md:items-center'
    : 'grid gap-2 md:[grid-template-columns:var(--resource-list-columns)] md:items-center';
  const headerGridClassName = `${gridClassName} rounded-[10px] border border-[rgba(60,60,67,0.08)] bg-[rgba(242,242,247,0.66)] px-3 py-2`;
  const gridStyle = { '--resource-list-columns': resourceListGridTemplate(columns) } as CSSProperties;
  const columnLabelClassName = 'ku-meta md:hidden';
  const columnValueClassName = density === 'compact'
    ? 'min-w-0 truncate font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.72)]'
    : 'min-w-0 truncate font-mono text-[11px] font-semibold text-[rgba(60,60,67,0.72)]';

  return (
    <>
      <div className="grid gap-2 border-b border-[rgba(60,60,67,0.1)] p-3" data-testid="resource-bulk-toolbar">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`ku-chip ${selectedCount > 0 ? 'border-[rgba(0,122,255,0.22)] bg-[rgba(0,122,255,0.08)] text-[#0057b8]' : ''}`} data-testid="resource-bulk-count">
              선택 {selectedCount}개
            </span>
            <span className="ku-meta">현재 필터 결과 {resources.length}개 · 메모리에만 보관</span>
            <span className="ku-meta" data-testid="resource-bulk-keyboard-hint">Space 선택 · Shift+Arrow 범위 · Ctrl/⌘+A 전체</span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={onSelectAll} disabled={resources.length === 0 || allVisibleSelected} data-testid="resource-bulk-select-all">
              현재 필터 전체 선택
            </button>
            <button className="rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={onClearSelection} disabled={selectedCount === 0} data-testid="resource-bulk-clear">
              선택 해제
            </button>
            <button className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.06)] px-2.5 py-1.5 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.1)] disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={onCopySelectedNames} disabled={selectedCount === 0} data-testid="resource-bulk-copy-names" title="선택한 리소스 이름을 클립보드에 복사">
              <Copy size={13} aria-hidden="true" />
              이름 복사
            </button>
            <button className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={() => onExportSelected('json')} disabled={selectedCount === 0} data-testid="resource-bulk-export-json" title="선택한 리소스 safe inventory를 JSON으로 다운로드">
              <Download size={13} aria-hidden="true" />
              JSON
            </button>
            <button className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(60,60,67,0.12)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[rgba(60,60,67,0.72)] transition hover:bg-[rgba(242,242,247,0.9)] disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={() => onExportSelected('csv')} disabled={selectedCount === 0} data-testid="resource-bulk-export-csv" title="선택한 리소스 safe inventory를 CSV로 다운로드">
              <Download size={13} aria-hidden="true" />
              CSV
            </button>
          </div>
        </div>
        {bulkMessage ? (
          <p className={`rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold ${bulkMessage.tone === 'success' ? 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]' : 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] text-[#8a4d00]'}`} data-testid="resource-bulk-message">
            {bulkMessage.text}
          </p>
        ) : null}
      </div>

      <div
        className="max-h-[68vh] overflow-auto p-2 focus:outline-none focus:ring-2 focus:ring-[rgba(0,122,255,0.22)]"
        role="listbox"
        tabIndex={0}
        aria-label="리소스 목록"
        aria-activedescendant={selectedResourceId && selectedResourceIndex >= 0 ? resourceOptionDomId(selectedResourceId) : undefined}
        onKeyDown={onKeyDown}
      >
        {resources.length === 0 ? <p className="ku-meta p-2">필터와 일치하는 리소스가 없습니다.</p> : null}
        {resources.length > 0 ? (
          <div className={`${headerGridClassName} mb-2 hidden md:grid`} style={gridStyle} data-testid="resource-list-column-header">
            <span className="ku-meta" data-resource-column="select">Select</span>
            <span className="ku-meta" data-resource-column="kind">Kind</span>
            <span className="ku-meta" data-resource-column="name">Name</span>
            {columns.namespace ? <span className="ku-meta" data-resource-column="namespace">Namespace</span> : null}
            <span className="ku-meta" data-resource-column="status">Status</span>
            {columns.cluster ? <span className="ku-meta" data-resource-column="cluster">Cluster</span> : null}
            {columns.age ? <span className="ku-meta" data-resource-column="age">Age</span> : null}
            {columns.summary ? <span className="ku-meta" data-resource-column="summary">Summary</span> : null}
          </div>
        ) : null}
        {resources.map((resource) => {
          const summaryEntries = Object.entries(resource.summary).slice(0, summaryLimit);
          const resourceAge = resourceListAge(resource);
          const bulkSelected = selectedResourceIds.has(resource.id);
          const domId = resourceOptionDomId(resource.id);
          return (
            <div
              key={resource.id}
              id={domId}
              className={resourceRowClassName(resource, density, selectedResourceId, bulkSelected)}
              ref={(node) => { rowRefs.current[resource.id] = node; }}
              role="option"
              aria-selected={resource.id === selectedResourceId}
              data-resource-row="true"
              data-resource-bulk-selected={bulkSelected ? 'true' : 'false'}
              tabIndex={resource.id === selectedResourceId ? 0 : -1}
              onClick={() => onSelectResource(resource.id)}
            >
              <div className={gridClassName} style={gridStyle}>
                <div className="flex min-w-0 items-center gap-2" data-resource-column="select" onClick={(event) => event.stopPropagation()}>
                  <input className="h-4 w-4 rounded border-[rgba(60,60,67,0.24)] text-[#0057b8] focus:ring-[rgba(0,122,255,0.25)]" type="checkbox" checked={bulkSelected} onChange={(event) => onToggleSelection(resource.id, event.currentTarget.checked)} aria-label={`${resource.kind} ${resource.namespace ? `${resource.namespace}/` : ''}${resource.name} 선택`} data-testid={`resource-bulk-checkbox-${domId}`} data-resource-bulk-control="true" />
                  <span className={`${columnLabelClassName} md:hidden`}>선택</span>
                </div>
                <ResourceListCell label="Kind" value={resource.kind} valueClassName={columnValueClassName} />
                <div className="min-w-0" data-resource-column="name">
                  <span className={columnLabelClassName}>Name</span>
                  <p className={density === 'compact' ? 'truncate text-xs font-semibold text-[#1d1d1f]' : 'truncate text-sm font-semibold text-[#1d1d1f]'} title={resource.name}>{resource.name}</p>
                  <p className={`${density === 'compact' ? 'mt-0.5 truncate font-mono text-[9px]' : 'mt-0.5 truncate font-mono text-[10px]'} font-semibold uppercase tracking-[0.03em] text-[rgba(60,60,67,0.58)] md:hidden`}>
                    {resource.namespace ? `${resource.namespace} / ` : ''}{resource.clusterId}
                  </p>
                </div>
                {columns.namespace ? <ResourceListCell label="Namespace" value={resource.namespace || '-'} valueClassName={columnValueClassName} /> : null}
                <div className="min-w-0" data-resource-column="status">
                  <span className={columnLabelClassName}>Status</span>
                  <span className={statusPillClassName(resource.status)}>{resource.status}</span>
                </div>
                {columns.cluster ? <ResourceListCell label="Cluster" value={resource.clusterId} valueClassName={columnValueClassName} /> : null}
                {columns.age ? <ResourceListCell label="Age" value={resourceAge} valueClassName={columnValueClassName} /> : null}
                {columns.summary ? (
                  <div className="min-w-0" data-resource-column="summary">
                    <span className={columnLabelClassName}>Summary</span>
                    {summaryEntries.length > 0 ? (
                      <div className={density === 'compact' ? 'mt-1 flex flex-wrap gap-1 md:mt-0' : 'mt-2 flex flex-wrap gap-1.5 md:mt-0'}>
                        {summaryEntries.map(([key, value]) => <span key={key} className={summaryChipClassName(density)}>{key}:{String(value)}</span>)}
                      </div>
                    ) : <span className={columnValueClassName}>-</span>}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
        {nextCursor ? (
          <div className="flex justify-center border-t border-[rgba(60,60,67,0.1)] px-3 py-4">
            <button className="inline-flex items-center gap-2 rounded-[9px] border border-[rgba(0,122,255,0.2)] bg-[rgba(0,122,255,0.06)] px-4 py-2 text-xs font-semibold text-[#0057b8] transition hover:bg-[rgba(0,122,255,0.1)] disabled:cursor-wait disabled:opacity-60" type="button" onClick={onLoadMore} disabled={loadingMore} data-testid="resource-list-load-more">
              <RefreshCw size={14} className={loadingMore ? 'animate-spin' : ''} aria-hidden="true" />
              {loadingMore ? '추가 리소스 불러오는 중' : `더 불러오기 · ${resources.length} / ${totalFilteredCount}`}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function ResourceListCell({ label, value, valueClassName }: { label: string; value: string; valueClassName: string }) {
  return (
    <div className="min-w-0" data-resource-column={label.toLowerCase()}>
      <span className="ku-meta md:hidden">{label}</span>
      <span className={valueClassName} title={value}>{value}</span>
    </div>
  );
}

export function resourceOptionDomId(resourceId: string) {
  return `kuviewer-resource-${resourceId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function resourceRowClassName(resource: ResourceExplorerItem, density: ResourceListDensity, selectedResourceId: string, bulkSelected: boolean) {
  return `${density === 'compact' ? 'mb-1.5 rounded-[10px] px-2 py-2' : 'mb-2 rounded-[12px] p-3'} w-full cursor-pointer border text-left transition focus:outline-none focus:ring-2 focus:ring-[rgba(0,122,255,0.22)] ${resource.id === selectedResourceId ? 'border-[rgba(0,122,255,0.36)] bg-[rgba(0,122,255,0.1)] shadow-[0_0_0_1px_rgba(0,122,255,0.08)]' : bulkSelected ? 'border-[rgba(52,199,89,0.24)] bg-[rgba(52,199,89,0.08)] hover:bg-[rgba(52,199,89,0.11)]' : 'border-[rgba(60,60,67,0.12)] bg-white/78 hover:bg-white'}`;
}

function resourceListGridTemplate(columns: ResourceListColumnPreference) {
  const tracks = ['minmax(44px,0.32fr)', 'minmax(92px,0.72fr)', 'minmax(150px,1.45fr)'];
  if (columns.namespace) tracks.push('minmax(92px,0.72fr)');
  tracks.push('minmax(92px,0.72fr)');
  if (columns.cluster) tracks.push('minmax(96px,0.82fr)');
  if (columns.age) tracks.push('minmax(74px,0.62fr)');
  if (columns.summary) tracks.push('minmax(150px,1.25fr)');
  return tracks.join(' ');
}

function resourceListAge(resource: ResourceExplorerItem) {
  const metadata = recordFromUnknown(resource.preview.metadata);
  return resourceListCellValue(metadata.age);
}

function resourceListCellValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '-';
}

function summaryChipClassName(density: ResourceListDensity) {
  return density === 'compact'
    ? 'rounded-full bg-[rgba(242,242,247,0.78)] px-1.5 py-0 font-mono text-[9px] font-semibold text-[rgba(60,60,67,0.72)]'
    : 'rounded-full bg-[rgba(242,242,247,0.78)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[rgba(60,60,67,0.72)]';
}

function statusPillClassName(status: string) {
  if (status === 'healthy') return 'shrink-0 rounded-full border border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#248a3d]';
  if (status === 'warning') return 'shrink-0 rounded-full border border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#a05a00]';
  if (status === 'error') return 'shrink-0 rounded-full border border-[rgba(255,59,48,0.24)] bg-[rgba(255,59,48,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#c01f17]';
  return 'shrink-0 rounded-full border border-[rgba(142,142,147,0.22)] bg-[rgba(142,142,147,0.1)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#636366]';
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
