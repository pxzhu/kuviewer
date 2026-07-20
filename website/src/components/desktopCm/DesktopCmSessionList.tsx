import {
  Activity,
  Copy,
  Download,
  Folder,
  KeyRound,
  Pencil,
  Play,
  ServerCog,
  Square,
  Star,
  Trash2,
  XCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { DesktopCmSession, DesktopCmSessionRuntimeProfile } from '../../features/desktop/desktopConnectionProfile';
import {
  defaultDesktopCmSessionGroup,
  getDesktopCmSessionPreference,
  getDisplayedCmDiagnostic,
  maxDesktopCmSessionGroupNameLength,
  type DesktopCmSessionGroup,
  type DesktopCmSessionViewPreference,
} from '../../features/desktop/desktopCmSessionView';
import {
  formatCmSessionCheckStatus,
  formatRuntimeHealthStatus,
} from '../../features/desktop/desktopCmSessionPresentation';
import { DesktopCmDiagnostics } from './DesktopCmSessionPrimitives';

export interface DesktopCmSessionListActions {
  onToggleGroupSelection: (sessionIds: string[], checked: boolean) => void;
  onToggleGroupCollapsed: (group: string) => void;
  onToggleSessionSelection: (sessionId: string, checked: boolean) => void;
  onToggleFavorite: (sessionId: string) => void;
  onSetGroup: (sessionId: string, group: string) => void;
  onSelect: (sessionId: string) => Promise<void>;
  onKeyFilePathChange: (sessionId: string, value: string) => void;
  onImportPrivateKey: (sessionId: string) => Promise<void>;
  onCheckSession: (sessionId: string) => Promise<void>;
  onCheckRuntime: () => Promise<void>;
  onStopRuntime: () => Promise<void>;
  onStartRuntime: (sessionId: string) => Promise<void>;
  onDeleteCredential: (sessionId: string) => Promise<void>;
  onEdit: (session: DesktopCmSession) => void;
  onClone: (session: DesktopCmSession) => void;
  onDelete: (sessionId: string) => Promise<void>;
}

interface DesktopCmSessionListProps {
  sessions: DesktopCmSession[];
  visibleSessionCount: number;
  groups: DesktopCmSessionGroup[];
  preferences: Map<string, DesktopCmSessionViewPreference>;
  selectedSessionIds: Set<string>;
  runtimeProfile: DesktopCmSessionRuntimeProfile | null;
  activeRuntimeSessionId: string;
  keyFilePaths: Record<string, string>;
  busyAction: string;
  deleteConfirmId: string;
  credentialDeleteConfirmId: string;
  actions: DesktopCmSessionListActions;
}

export function DesktopCmSessionList({
  sessions,
  visibleSessionCount,
  groups,
  preferences,
  selectedSessionIds,
  runtimeProfile,
  activeRuntimeSessionId,
  keyFilePaths,
  busyAction,
  deleteConfirmId,
  credentialDeleteConfirmId,
  actions,
}: DesktopCmSessionListProps) {
  if (sessions.length === 0) {
    return (
      <p className="text-xs font-semibold text-[rgba(60,60,67,0.58)]">
        CM/SSH 세션은 설치형 앱에서만 관리됩니다. private key는 Rust가 OS credential store에 저장하고 브라우저에는 safe metadata만 표시합니다.
      </p>
    );
  }

  if (visibleSessionCount === 0) {
    return (
      <p
        className="rounded-[8px] border border-[rgba(60,60,67,0.1)] bg-white/70 px-3 py-2 text-xs font-semibold text-[rgba(60,60,67,0.58)]"
        data-testid="desktop-cm-session-search-empty"
      >
        일치하는 CM/SSH session 없음
      </p>
    );
  }

  return (
    <div className="grid gap-3" data-testid="desktop-cm-session-groups">
      {groups.map((group) => (
        <section
          key={group.group}
          className="grid gap-2 rounded-[10px] border border-[rgba(60,60,67,0.1)] bg-white/58 px-3 py-3"
          data-testid={`desktop-cm-session-group-${group.slug}`}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label className="ku-control h-8 text-xs" data-testid={`desktop-cm-session-group-select-${group.slug}`}>
              <input
                className="h-4 w-4 accent-[#007aff]"
                data-testid={`desktop-cm-session-group-select-input-${group.slug}`}
                type="checkbox"
                checked={group.sessions.length > 0 && group.sessions.every((session) => selectedSessionIds.has(session.id))}
                onChange={(event) => actions.onToggleGroupSelection(group.sessions.map((session) => session.id), event.currentTarget.checked)}
              />
              선택
            </label>
            <button
              className="ku-control h-8 text-xs"
              data-testid={`desktop-cm-session-group-toggle-${group.slug}`}
              type="button"
              onClick={() => actions.onToggleGroupCollapsed(group.group)}
            >
              {group.collapsed ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
              <Folder size={13} aria-hidden="true" />
              <span className="truncate">{group.group}</span>
            </button>
            <span className="ku-chip" data-testid={`desktop-cm-session-group-count-${group.slug}`}>
              {group.sessions.length} / {group.totalCount}
            </span>
            <span className="ku-chip" data-testid={`desktop-cm-session-group-favorites-${group.slug}`}>
              <Star size={12} aria-hidden="true" />
              favorite {group.favoriteCount}
            </span>
            {group.sessions.some((session) => selectedSessionIds.has(session.id)) ? (
              <span className="ku-chip" data-testid={`desktop-cm-session-group-selected-${group.slug}`}>
                selected {group.sessions.filter((session) => selectedSessionIds.has(session.id)).length}
              </span>
            ) : null}
          </div>
          {group.collapsed ? null : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3" data-testid={`desktop-cm-session-group-items-${group.slug}`}>
              {group.sessions.map((session) => (
                <DesktopCmSessionCard
                  key={session.id}
                  session={session}
                  preference={getDesktopCmSessionPreference(session.id, preferences)}
                  selected={selectedSessionIds.has(session.id)}
                  runtimeProfile={runtimeProfile}
                  activeRuntimeSessionId={activeRuntimeSessionId}
                  keyFilePath={keyFilePaths[session.id] || ''}
                  busyAction={busyAction}
                  deleteConfirmId={deleteConfirmId}
                  credentialDeleteConfirmId={credentialDeleteConfirmId}
                  actions={actions}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

interface DesktopCmSessionCardProps {
  session: DesktopCmSession;
  preference: DesktopCmSessionViewPreference;
  selected: boolean;
  runtimeProfile: DesktopCmSessionRuntimeProfile | null;
  activeRuntimeSessionId: string;
  keyFilePath: string;
  busyAction: string;
  deleteConfirmId: string;
  credentialDeleteConfirmId: string;
  actions: DesktopCmSessionListActions;
}

function DesktopCmSessionCard({
  session,
  preference,
  selected,
  runtimeProfile,
  activeRuntimeSessionId,
  keyFilePath,
  busyAction,
  deleteConfirmId,
  credentialDeleteConfirmId,
  actions,
}: DesktopCmSessionCardProps) {
  const runtimeActive = activeRuntimeSessionId === session.id;

  return (
    <div
      className={`grid min-w-0 gap-2 rounded-[8px] border px-3 py-2 text-left transition ${
        session.selected
          ? 'border-[rgba(52,199,89,0.28)] bg-[rgba(52,199,89,0.09)]'
          : 'border-[rgba(60,60,67,0.13)] bg-white/72 hover:bg-white'
      }`}
      data-testid={`desktop-cm-session-${session.id}`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="ku-control w-fit text-[11px]" data-testid={`desktop-cm-session-bulk-select-${session.id}`}>
          <input
            className="h-4 w-4 accent-[#007aff]"
            data-testid={`desktop-cm-session-bulk-select-input-${session.id}`}
            type="checkbox"
            checked={selected}
            onChange={(event) => actions.onToggleSessionSelection(session.id, event.currentTarget.checked)}
          />
          선택
        </label>
        <button
          className={`ku-control w-fit text-[11px] ${preference.favorite ? 'border-[rgba(255,204,0,0.32)] bg-[rgba(255,204,0,0.14)] text-[#8a6500]' : ''}`}
          data-testid={`desktop-cm-session-favorite-${session.id}`}
          type="button"
          onClick={() => actions.onToggleFavorite(session.id)}
        >
          <Star size={13} aria-hidden="true" fill={preference.favorite ? 'currentColor' : 'none'} />
          {preference.favorite ? '즐겨찾기' : '즐겨찾기 추가'}
        </button>
        <label className="min-w-[150px] flex-1">
          <span className="ku-meta">Group</span>
          <input
            key={`${session.id}:${preference.group}`}
            className="ku-field mt-1 h-8 w-full text-xs"
            data-testid={`desktop-cm-session-group-input-${session.id}`}
            maxLength={maxDesktopCmSessionGroupNameLength}
            placeholder={defaultDesktopCmSessionGroup}
            defaultValue={preference.group}
            onBlur={(event) => actions.onSetGroup(session.id, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
          />
        </label>
      </div>
      <button className="min-w-0 text-left" type="button" onClick={() => void actions.onSelect(session.id)}>
        <span className="flex min-w-0 items-center gap-2">
          <ServerCog className="shrink-0 text-[rgba(60,60,67,0.48)]" size={15} aria-hidden="true" />
          <span className="truncate text-sm font-semibold text-[#1d1d1f]">{session.name}</span>
        </span>
        <span className="mt-1 block truncate font-mono text-xs font-semibold text-[rgba(60,60,67,0.62)]">
          {session.user}@{session.host}:{session.port}
        </span>
        <span className="mt-1 block truncate font-mono text-xs font-semibold text-[rgba(60,60,67,0.58)]">
          API {session.remoteApiHost}:{session.remoteApiPort}
        </span>
        <span className="mt-1 block truncate text-xs font-semibold text-[rgba(60,60,67,0.58)]">
          {session.authType} · {session.status} · {session.runtimeStatus}
        </span>
        <span className={`mt-1 flex min-w-0 items-center gap-1 truncate text-xs font-semibold ${session.credentialAvailable ? 'text-[#248a3d]' : 'text-[rgba(60,60,67,0.58)]'}`}>
          <KeyRound className="shrink-0" size={12} aria-hidden="true" />
          <span className="truncate">
            {session.credentialAvailable ? `${session.credentialStore} · credential ready` : `${session.credentialStore} · credential 없음`}
          </span>
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1 truncate text-xs font-semibold text-[rgba(60,60,67,0.58)]">
          <Activity className="shrink-0" size={12} aria-hidden="true" />
          <span className="truncate">
            {formatCmSessionCheckStatus(session.lastCheckStatus)}
            {session.lastCheckAt ? ` · ${new Date(session.lastCheckAt).toLocaleTimeString()}` : ''}
          </span>
        </span>
      </button>
      <DesktopCmDiagnostics
        diagnostic={getDisplayedCmDiagnostic(session, runtimeProfile, activeRuntimeSessionId)}
        testId={`desktop-cm-session-diagnostics-${session.id}`}
      />
      {runtimeActive && runtimeProfile ? <DesktopCmRuntimeDetail runtimeProfile={runtimeProfile} sessionId={session.id} /> : null}
      <div className="grid gap-2">
        <label className="min-w-0">
          <span className="ku-meta">Private key path</span>
          <input
            className="ku-field mt-1 h-8 w-full font-mono text-xs"
            data-testid={`desktop-cm-session-key-path-${session.id}`}
            placeholder="~/.ssh/id_ed25519"
            value={keyFilePath}
            onChange={(event) => actions.onKeyFilePathChange(session.id, event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className="ku-control w-fit text-[11px]"
            data-testid={`desktop-cm-session-import-key-${session.id}`}
            type="button"
            disabled={busyAction === `import-key:${session.id}`}
            onClick={() => void actions.onImportPrivateKey(session.id)}
          >
            <KeyRound size={13} aria-hidden="true" />
            credential 가져오기
          </button>
          <button
            className="ku-control w-fit text-[11px]"
            data-testid={`desktop-cm-session-check-${session.id}`}
            type="button"
            disabled={busyAction === `check:${session.id}`}
            onClick={() => void actions.onCheckSession(session.id)}
          >
            <Activity size={13} aria-hidden="true" />
            연결 확인
          </button>
          {runtimeActive ? (
            <>
              <button
                className="ku-control w-fit text-[11px]"
                data-testid={`desktop-cm-session-check-runtime-${session.id}`}
                type="button"
                disabled={busyAction === 'check-runtime'}
                onClick={() => void actions.onCheckRuntime()}
              >
                <Activity size={13} aria-hidden="true" />
                health 재확인
              </button>
              <button
                className="ku-control w-fit text-[11px]"
                data-testid={`desktop-cm-session-stop-runtime-${session.id}`}
                type="button"
                disabled={busyAction === 'stop-runtime'}
                onClick={() => void actions.onStopRuntime()}
              >
                <Square size={13} aria-hidden="true" />
                runtime 중지
              </button>
            </>
          ) : (
            <button
              className="ku-control w-fit text-[11px]"
              data-testid={`desktop-cm-session-start-runtime-${session.id}`}
              type="button"
              disabled={!session.credentialAvailable || busyAction === `start-runtime:${session.id}`}
              onClick={() => void actions.onStartRuntime(session.id)}
            >
              <Play size={13} aria-hidden="true" />
              runtime 시작
            </button>
          )}
          <button
            className="ku-control w-fit text-[11px]"
            data-testid={`desktop-cm-session-delete-credential-${session.id}`}
            type="button"
            disabled={!session.credentialAvailable || busyAction === `delete-credential:${session.id}`}
            onClick={() => void actions.onDeleteCredential(session.id)}
          >
            <Trash2 size={13} aria-hidden="true" />
            {credentialDeleteConfirmId === session.id ? 'credential 삭제 확인' : 'credential 삭제'}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className="ku-control w-fit text-[11px]"
          data-testid={`desktop-cm-session-edit-${session.id}`}
          type="button"
          onClick={() => actions.onEdit(session)}
        >
          <Pencil size={13} aria-hidden="true" />
          수정
        </button>
        <button
          className="ku-control w-fit text-[11px]"
          data-testid={`desktop-cm-session-clone-${session.id}`}
          type="button"
          onClick={() => actions.onClone(session)}
        >
          <Copy size={13} aria-hidden="true" />
          복제
        </button>
        <button
          className="ku-control w-fit text-[11px]"
          data-testid={`desktop-cm-session-delete-${session.id}`}
          type="button"
          disabled={busyAction === `delete:${session.id}` || busyAction === `select:${session.id}`}
          onClick={() => void actions.onDelete(session.id)}
        >
          <Trash2 size={13} aria-hidden="true" />
          {deleteConfirmId === session.id ? '삭제 확인' : '삭제'}
        </button>
      </div>
    </div>
  );
}

function DesktopCmRuntimeDetail({ runtimeProfile, sessionId }: { runtimeProfile: DesktopCmSessionRuntimeProfile; sessionId: string }) {
  return (
    <div
      className="grid gap-1 rounded-[8px] border border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.07)] px-2.5 py-2 text-xs font-semibold text-[#0066cc]"
      data-testid={`desktop-cm-session-runtime-detail-${sessionId}`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className={`ku-chip max-w-full ${runtimeProfile.healthStatus === 'healthy' ? 'border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]' : 'border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]'}`}>
          <Activity size={12} aria-hidden="true" />
          {formatRuntimeHealthStatus(runtimeProfile.healthStatus)}
        </span>
        <span className="truncate font-mono" title={runtimeProfile.serverUrl}>{runtimeProfile.serverUrl}</span>
      </div>
      <div className="truncate font-mono text-[rgba(0,78,140,0.78)]">
        remote {runtimeProfile.remoteApiHost}:{runtimeProfile.remoteApiPort}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-[rgba(0,78,140,0.74)]">
        <span className="truncate">
          {runtimeProfile.lastHealthAt ? `health ${new Date(runtimeProfile.lastHealthAt).toLocaleTimeString()}` : 'health 미확인'}
        </span>
        {runtimeProfile.lastHealthMessage ? <span className="truncate">{runtimeProfile.lastHealthMessage}</span> : null}
      </div>
    </div>
  );
}

interface DesktopCmSessionBulkToolbarProps {
  selectedCount: number;
  selectedVisibleCount: number;
  bulkGroupName: string;
  bulkDeleteConfirm: boolean;
  busyAction: string;
  onExport: () => void;
  onSetFavorite: (favorite: boolean) => void;
  onDelete: () => Promise<void>;
  onClear: () => void;
  onBulkGroupNameChange: (value: string) => void;
  onMoveToGroup: () => void;
}

export function DesktopCmSessionBulkToolbar({
  selectedCount,
  selectedVisibleCount,
  bulkGroupName,
  bulkDeleteConfirm,
  busyAction,
  onExport,
  onSetFavorite,
  onDelete,
  onClear,
  onBulkGroupNameChange,
  onMoveToGroup,
}: DesktopCmSessionBulkToolbarProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div
      className="grid gap-2 rounded-[10px] border border-[rgba(0,122,255,0.16)] bg-[rgba(0,122,255,0.06)] px-3 py-2"
      data-testid="desktop-cm-session-bulk-toolbar"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="ku-chip border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.08)] text-[#0066cc]" data-testid="desktop-cm-session-bulk-count">
          선택 {selectedCount}개 · 현재 결과 {selectedVisibleCount}개
        </span>
        <button className="ku-control h-8 text-xs" data-testid="desktop-cm-session-bulk-export" type="button" onClick={onExport}>
          <Download size={13} aria-hidden="true" />
          선택 export
        </button>
        <button className="ku-control h-8 text-xs" data-testid="desktop-cm-session-bulk-favorite-on" type="button" onClick={() => onSetFavorite(true)}>
          <Star size={13} aria-hidden="true" />
          즐겨찾기 설정
        </button>
        <button className="ku-control h-8 text-xs" data-testid="desktop-cm-session-bulk-favorite-off" type="button" onClick={() => onSetFavorite(false)}>
          <Star size={13} aria-hidden="true" />
          즐겨찾기 해제
        </button>
        <button
          className={`ku-control h-8 text-xs ${bulkDeleteConfirm ? 'border-[rgba(255,59,48,0.28)] bg-[rgba(255,59,48,0.1)] text-[#b42318]' : ''}`}
          data-testid="desktop-cm-session-bulk-delete"
          type="button"
          disabled={busyAction === 'bulk-delete-sessions'}
          onClick={() => void onDelete()}
        >
          <Trash2 size={13} aria-hidden="true" />
          {bulkDeleteConfirm ? '선택 삭제 확인' : '선택 삭제'}
        </button>
        <button className="ku-control h-8 text-xs" data-testid="desktop-cm-session-bulk-clear-toolbar" type="button" onClick={onClear}>
          <XCircle size={13} aria-hidden="true" />
          선택 해제
        </button>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="min-w-[180px] flex-1">
          <span className="ku-meta">Bulk group</span>
          <input
            className="ku-field mt-1 h-8 w-full text-xs"
            data-testid="desktop-cm-session-bulk-group-input"
            maxLength={maxDesktopCmSessionGroupNameLength}
            placeholder={defaultDesktopCmSessionGroup}
            value={bulkGroupName}
            onChange={(event) => onBulkGroupNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onMoveToGroup();
              }
            }}
          />
        </label>
        <button className="ku-control h-8 self-end text-xs" data-testid="desktop-cm-session-bulk-group-apply" type="button" onClick={onMoveToGroup}>
          <Folder size={13} aria-hidden="true" />
          Group 이동
        </button>
        <span className="text-xs font-semibold text-[rgba(60,60,67,0.58)]">
          selection은 메모리 전용 · export/import/Tauri payload 제외
        </span>
      </div>
    </div>
  );
}
