import type { ReactNode } from 'react';
import { CheckCircle2, Copy, Plus, RotateCcw, ServerCog } from 'lucide-react';
import {
  desktopCmDefaultRemoteApiHost,
  desktopCmDefaultRemoteApiPort,
  type DesktopCmSessionInput,
} from '../../features/desktop/desktopConnectionProfile';

const quickApiEndpoints = [
  { label: '127.0.0.1:18085', host: desktopCmDefaultRemoteApiHost, port: desktopCmDefaultRemoteApiPort, testId: 'desktop-cm-session-api-preset-local-18085' },
  { label: 'localhost:18085', host: 'localhost', port: desktopCmDefaultRemoteApiPort, testId: 'desktop-cm-session-api-preset-localhost-18085' },
  { label: '127.0.0.1:8080', host: desktopCmDefaultRemoteApiHost, port: 8080, testId: 'desktop-cm-session-api-preset-local-8080' },
] as const;

interface DesktopCmConnectionProfileFormProps {
  busy: boolean;
  cloneDraftSourceName: string;
  connectionPreview: string;
  form: DesktopCmSessionInput;
  hasSelectedSession: boolean;
  onApplyRemoteApiEndpoint: (host: string, port: number) => void;
  onCancel: () => void;
  onChange: (patch: Partial<DesktopCmSessionInput>) => void;
  onFillSelected: () => void;
  onSave: () => void;
}

export function DesktopCmConnectionProfileForm({
  busy,
  cloneDraftSourceName,
  connectionPreview,
  form,
  hasSelectedSession,
  onApplyRemoteApiEndpoint,
  onCancel,
  onChange,
  onFillSelected,
  onSave,
}: DesktopCmConnectionProfileFormProps) {
  return (
    <div className="grid gap-3 rounded-[10px] border border-[rgba(60,60,67,0.1)] bg-white/68 px-3 py-3" data-testid="desktop-cm-connection-profile-form">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="ku-meta">Connection profile</span>
        <span className="ku-chip max-w-full font-mono" data-testid="desktop-cm-session-connection-preview" title={connectionPreview}>
          <ServerCog size={13} aria-hidden="true" />
          <span className="truncate">{connectionPreview}</span>
        </span>
        {hasSelectedSession ? (
          <button className="ku-control h-8 text-xs" data-testid="desktop-cm-session-fill-selected" type="button" onClick={onFillSelected}>
            <CheckCircle2 size={13} aria-hidden="true" />
            선택 세션으로 채우기
          </button>
        ) : null}
        {cloneDraftSourceName ? (
          <span className="ku-chip max-w-full border-[rgba(0,122,255,0.18)] bg-[rgba(0,122,255,0.08)] text-[#0066cc]" data-testid="desktop-cm-session-clone-draft">
            <Copy size={13} aria-hidden="true" />
            <span className="truncate">clone draft · {cloneDraftSourceName} · credential/runtime 제외</span>
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(280px,1.4fr)_minmax(260px,1fr)_minmax(220px,0.9fr)] xl:items-start" data-testid="desktop-cm-session-form-sections">
        <section className="grid gap-2" data-testid="desktop-cm-session-form-ssh-endpoint">
          <span className="ku-meta">SSH endpoint</span>
          <div className="grid gap-2 sm:grid-cols-[minmax(120px,1fr)_minmax(160px,1.3fr)_88px_minmax(110px,0.9fr)]">
            <Field label="Name">
              <input className="ku-field mt-1 h-9 w-full" data-testid="desktop-cm-session-name" placeholder="prod cm" value={form.name} onChange={(event) => onChange({ name: event.target.value })} />
            </Field>
            <Field label="Host">
              <input className="ku-field mt-1 h-9 w-full font-mono" data-testid="desktop-cm-session-host" placeholder="cm.internal" value={form.host} onChange={(event) => onChange({ host: event.target.value })} />
            </Field>
            <Field label="Port">
              <input className="ku-field mt-1 h-9 w-full font-mono" data-testid="desktop-cm-session-port" inputMode="numeric" value={form.port} onChange={(event) => onChange({ port: Number(event.target.value || 0) })} />
            </Field>
            <Field label="User">
              <input className="ku-field mt-1 h-9 w-full font-mono" data-testid="desktop-cm-session-user" placeholder="ubuntu" value={form.user} onChange={(event) => onChange({ user: event.target.value })} />
            </Field>
          </div>
        </section>

        <section className="grid gap-2" data-testid="desktop-cm-session-form-api-endpoint">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="ku-meta">Remote Kuviewer API</span>
            <button className="ku-control h-8 text-xs" data-testid="desktop-cm-session-api-default-reset" type="button" onClick={() => onApplyRemoteApiEndpoint(desktopCmDefaultRemoteApiHost, desktopCmDefaultRemoteApiPort)}>
              <RotateCcw size={13} aria-hidden="true" />
              기본 API로 초기화
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(140px,1fr)_88px]">
            <Field label="API host">
              <input className="ku-field mt-1 h-9 w-full font-mono" data-testid="desktop-cm-session-remote-api-host" placeholder={desktopCmDefaultRemoteApiHost} value={form.remoteApiHost || desktopCmDefaultRemoteApiHost} onChange={(event) => onChange({ remoteApiHost: event.target.value })} />
            </Field>
            <Field label="API port">
              <input className="ku-field mt-1 h-9 w-full font-mono" data-testid="desktop-cm-session-remote-api-port" inputMode="numeric" value={form.remoteApiPort || desktopCmDefaultRemoteApiPort} onChange={(event) => onChange({ remoteApiPort: Number(event.target.value || 0) })} />
            </Field>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {quickApiEndpoints.map((endpoint) => (
              <button className="ku-control h-8 text-xs" data-testid={endpoint.testId} key={endpoint.testId} type="button" onClick={() => onApplyRemoteApiEndpoint(endpoint.host, endpoint.port)}>
                {endpoint.label}
              </button>
            ))}
          </div>
        </section>

        <section className="grid gap-2" data-testid="desktop-cm-session-form-notes">
          <span className="ku-meta">Notes</span>
          <Field label="Description">
            <input className="ku-field mt-1 h-9 w-full" data-testid="desktop-cm-session-description" placeholder="readonly entry" value={form.description || ''} onChange={(event) => onChange({ description: event.target.value })} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button className="ku-control-primary h-9" data-testid="desktop-cm-session-save" type="button" disabled={busy} onClick={onSave}>
              <Plus size={15} aria-hidden="true" />
              {form.id ? '수정' : '저장'}
            </button>
            {form.id || cloneDraftSourceName ? (
              <button className="ku-control h-9" data-testid={form.id ? 'desktop-cm-session-edit-cancel' : 'desktop-cm-session-clone-cancel'} type="button" onClick={onCancel}>
                취소
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="min-w-0">
      <span className="ku-meta">{label}</span>
      {children}
    </label>
  );
}
