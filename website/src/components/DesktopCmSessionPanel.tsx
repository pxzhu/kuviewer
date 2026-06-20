import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, KeyRound, Pencil, Plus, ServerCog, ShieldCheck, Trash2, Unplug } from 'lucide-react';
import type { DesktopCmSession, DesktopCmSessionInput } from '../features/desktop/desktopConnectionProfile';

interface DesktopCmSessionPanelProps {
  message: string;
  sessions: DesktopCmSession[];
  onDeleteSession: (sessionId: string) => Promise<void>;
  onSaveSession: (session: DesktopCmSessionInput) => Promise<void>;
  onSelectSession: (sessionId: string) => Promise<void>;
}

const emptyForm: DesktopCmSessionInput = {
  name: '',
  host: '',
  port: 22,
  user: '',
  description: '',
};

export function DesktopCmSessionPanel({
  message,
  sessions,
  onDeleteSession,
  onSaveSession,
  onSelectSession,
}: DesktopCmSessionPanelProps) {
  const selectedSession = useMemo(() => sessions.find((session) => session.selected), [sessions]);
  const [form, setForm] = useState<DesktopCmSessionInput>(emptyForm);
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState('');

  useEffect(() => {
    if (form.id && !sessions.some((session) => session.id === form.id)) {
      setForm(emptyForm);
    }
  }, [form.id, sessions]);

  const handleSave = async () => {
    setError('');
    setBusyAction('save');
    try {
      await onSaveSession(form);
      setForm(emptyForm);
    } catch (requestError) {
      setError(formatCmSessionError(requestError instanceof Error ? requestError.message : 'desktop_cm_session_save_failed'));
    } finally {
      setBusyAction('');
    }
  };

  const handleSelect = async (sessionId: string) => {
    setError('');
    setBusyAction(`select:${sessionId}`);
    try {
      await onSelectSession(sessionId);
    } catch (requestError) {
      setError(formatCmSessionError(requestError instanceof Error ? requestError.message : 'desktop_cm_session_select_failed'));
    } finally {
      setBusyAction('');
    }
  };

  const handleDelete = async (sessionId: string) => {
    if (deleteConfirmId !== sessionId) {
      setDeleteConfirmId(sessionId);
      return;
    }

    setError('');
    setBusyAction(`delete:${sessionId}`);
    try {
      await onDeleteSession(sessionId);
      setDeleteConfirmId('');
      if (form.id === sessionId) {
        setForm(emptyForm);
      }
    } catch (requestError) {
      setError(formatCmSessionError(requestError instanceof Error ? requestError.message : 'desktop_cm_session_delete_failed'));
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div
      className="grid gap-3 border-t border-[rgba(60,60,67,0.1)] bg-[rgba(247,250,255,0.48)] px-3 py-3 lg:px-4"
      data-testid="desktop-cm-session-panel"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="ku-meta">Desktop CM/SSH sessions</span>
        {selectedSession ? (
          <span className="ku-chip max-w-full border-[rgba(52,199,89,0.22)] bg-[rgba(52,199,89,0.1)] text-[#248a3d]" title={`${selectedSession.user}@${selectedSession.host}:${selectedSession.port}`}>
            <CheckCircle2 size={13} aria-hidden="true" />
            <span className="truncate">{selectedSession.name}</span>
          </span>
        ) : (
          <span className="ku-chip max-w-full">
            <Unplug size={13} aria-hidden="true" />
            선택된 세션 없음
          </span>
        )}
        <span className="ku-chip max-w-full">
          <ShieldCheck size={13} aria-hidden="true" />
          secret 저장 없음
        </span>
        <span className="ku-chip max-w-full">
          <KeyRound size={13} aria-hidden="true" />
          credential store 후속
        </span>
        {message ? (
          <span className="ku-chip max-w-full border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.08)] text-[#0066cc]">
            <ServerCog size={13} aria-hidden="true" />
            {message}
          </span>
        ) : null}
        {error ? (
          <span className="ku-chip max-w-full border-[rgba(255,149,0,0.24)] bg-[rgba(255,149,0,0.12)] text-[#b05f00]">
            {error}
          </span>
        ) : null}
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(130px,1fr)_minmax(160px,1.4fr)_90px_minmax(110px,0.8fr)_minmax(140px,1fr)_auto] md:items-end">
        <label className="min-w-0">
          <span className="ku-meta">Name</span>
          <input
            className="ku-field mt-1 h-9 w-full"
            data-testid="desktop-cm-session-name"
            placeholder="prod cm"
            value={form.name}
            onChange={(event) => {
              setForm((current) => ({ ...current, name: event.target.value }));
              setError('');
            }}
          />
        </label>
        <label className="min-w-0">
          <span className="ku-meta">Host</span>
          <input
            className="ku-field mt-1 h-9 w-full font-mono"
            data-testid="desktop-cm-session-host"
            placeholder="cm.example.internal"
            value={form.host}
            onChange={(event) => {
              setForm((current) => ({ ...current, host: event.target.value }));
              setError('');
            }}
          />
        </label>
        <label className="min-w-0">
          <span className="ku-meta">Port</span>
          <input
            className="ku-field mt-1 h-9 w-full font-mono"
            data-testid="desktop-cm-session-port"
            inputMode="numeric"
            value={form.port}
            onChange={(event) => {
              setForm((current) => ({ ...current, port: Number(event.target.value || 0) }));
              setError('');
            }}
          />
        </label>
        <label className="min-w-0">
          <span className="ku-meta">User</span>
          <input
            className="ku-field mt-1 h-9 w-full font-mono"
            data-testid="desktop-cm-session-user"
            placeholder="ubuntu"
            value={form.user}
            onChange={(event) => {
              setForm((current) => ({ ...current, user: event.target.value }));
              setError('');
            }}
          />
        </label>
        <label className="min-w-0">
          <span className="ku-meta">Description</span>
          <input
            className="ku-field mt-1 h-9 w-full"
            data-testid="desktop-cm-session-description"
            placeholder="readonly entry"
            value={form.description || ''}
            onChange={(event) => {
              setForm((current) => ({ ...current, description: event.target.value }));
              setError('');
            }}
          />
        </label>
        <div className="flex gap-2">
          <button className="ku-control-primary h-9" data-testid="desktop-cm-session-save" type="button" disabled={busyAction === 'save'} onClick={() => void handleSave()}>
            <Plus size={15} aria-hidden="true" />
            {form.id ? '수정' : '저장'}
          </button>
          {form.id ? (
            <button className="ku-control h-9" type="button" onClick={() => setForm(emptyForm)}>
              취소
            </button>
          ) : null}
        </div>
      </div>

      {sessions.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`grid min-w-0 gap-2 rounded-[8px] border px-3 py-2 text-left transition ${
                session.selected
                  ? 'border-[rgba(52,199,89,0.28)] bg-[rgba(52,199,89,0.09)]'
                  : 'border-[rgba(60,60,67,0.13)] bg-white/72 hover:bg-white'
              }`}
              data-testid={`desktop-cm-session-${session.id}`}
            >
              <button className="min-w-0 text-left" type="button" onClick={() => void handleSelect(session.id)}>
                <span className="flex min-w-0 items-center gap-2">
                  <ServerCog className="shrink-0 text-[rgba(60,60,67,0.48)]" size={15} aria-hidden="true" />
                  <span className="truncate text-sm font-semibold text-[#1d1d1f]">{session.name}</span>
                </span>
                <span className="mt-1 block truncate font-mono text-xs font-semibold text-[rgba(60,60,67,0.62)]">
                  {session.user}@{session.host}:{session.port}
                </span>
                <span className="mt-1 block truncate text-xs font-semibold text-[rgba(60,60,67,0.58)]">
                  {session.authType} · {session.status}
                </span>
              </button>
              <div className="flex flex-wrap gap-2">
                <button
                  className="ku-control w-fit text-[11px]"
                  data-testid={`desktop-cm-session-edit-${session.id}`}
                  type="button"
                  onClick={() => {
                    setForm({
                      id: session.id,
                      name: session.name,
                      host: session.host,
                      port: session.port,
                      user: session.user,
                      description: session.description || '',
                    });
                    setError('');
                  }}
                >
                  <Pencil size={13} aria-hidden="true" />
                  수정
                </button>
                <button
                  className="ku-control w-fit text-[11px]"
                  data-testid={`desktop-cm-session-delete-${session.id}`}
                  type="button"
                  disabled={busyAction === `delete:${session.id}` || busyAction === `select:${session.id}`}
                  onClick={() => void handleDelete(session.id)}
                >
                  <Trash2 size={13} aria-hidden="true" />
                  {deleteConfirmId === session.id ? '삭제 확인' : '삭제'}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs font-semibold text-[rgba(60,60,67,0.58)]">
          CM/SSH 세션은 설치형 앱에서만 관리됩니다. 현재 단계는 안전한 metadata-only 세션 목록이며 실제 SSH 연결과 credential 저장은 다음 작업에서 추가합니다.
        </p>
      )}
    </div>
  );
}

function formatCmSessionError(error: string) {
  if (error.includes('host')) {
    return 'host 형식 오류';
  }
  if (error.includes('port')) {
    return 'port 1-65535';
  }
  if (error.includes('user')) {
    return 'user 형식 오류';
  }
  if (error.includes('name')) {
    return 'name 필요';
  }
  if (error.includes('too_long')) {
    return '값이 너무 김';
  }
  if (error.includes('not_found')) {
    return '세션 없음';
  }
  return '세션 오류';
}
