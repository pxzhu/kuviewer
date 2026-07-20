import { useCallback, useEffect, useState } from 'react';
import type {
  DesktopCmSession,
  DesktopCmSessionInput,
  DesktopCmSessionRuntimeProfile,
} from './desktopConnectionProfile';

const loadDesktopConnectionApi = () => import('./desktopConnectionProfile');

interface DesktopCmSessionControllerOptions {
  enabled: boolean;
  onRuntimeStarted: () => void;
  onRuntimeStopped: () => void;
}

export function useDesktopCmSessionController({
  enabled,
  onRuntimeStarted,
  onRuntimeStopped,
}: DesktopCmSessionControllerOptions) {
  const [sessions, setSessions] = useState<DesktopCmSession[]>([]);
  const [runtimeProfile, setRuntimeProfile] = useState<DesktopCmSessionRuntimeProfile | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    void loadDesktopConnectionApi()
      .then(({ getDesktopCmSessions }) => getDesktopCmSessions())
      .then((nextSessions) => {
        if (cancelled) {
          return;
        }
        setSessions(nextSessions);
        setMessage(nextSessions.length > 0 ? 'CM/SSH session metadata 준비됨' : 'CM/SSH session 없음');
      })
      .catch(() => {
        if (!cancelled) {
          setSessions([]);
          setMessage('CM/SSH session 읽기 실패');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    let unsubscribe = () => {};
    void loadDesktopConnectionApi()
      .then(async (desktopApi) => {
        desktopApi.clearDesktopCmRuntimeProfile();
        const profile = await desktopApi.getDesktopCmSessionRuntime();
        if (cancelled) {
          return;
        }
        if (profile) {
          desktopApi.storeDesktopCmRuntimeProfile(profile);
          setRuntimeProfile(profile);
        } else {
          desktopApi.clearDesktopCmRuntimeProfile();
          setRuntimeProfile(null);
        }
        unsubscribe = desktopApi.subscribeDesktopCmRuntimeProfile(() => {
          setRuntimeProfile(desktopApi.getDesktopCmRuntimeProfile());
        });
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeProfile(null);
        }
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled]);

  const saveSession = useCallback(async (session: DesktopCmSessionInput) => {
    const { saveDesktopCmSession } = await loadDesktopConnectionApi();
    const savedSession = await saveDesktopCmSession(session);
    if (!savedSession) {
      throw new Error('desktop_cm_session_save_failed');
    }
    setSessions((currentSessions) => upsertDesktopCmSession(currentSessions, savedSession));
    setMessage(`${savedSession.name} 저장됨 · metadata-only`);
  }, []);

  const selectSession = useCallback(async (sessionId: string) => {
    const { selectDesktopCmSession } = await loadDesktopConnectionApi();
    const selectedSession = await selectDesktopCmSession(sessionId);
    if (!selectedSession) {
      throw new Error('desktop_cm_session_not_found');
    }
    setSessions((currentSessions) =>
      currentSessions.map((session) => ({
        ...session,
        selected: session.id === selectedSession.id,
        status: session.id === selectedSession.id ? selectedSession.status : 'metadata-only',
      })),
    );
    setMessage(`${selectedSession.name} 선택됨 · ${selectedSession.credentialAvailable ? 'credential ready' : 'credential 필요'}`);
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    const { clearDesktopCmRuntimeProfile, deleteDesktopCmSession } = await loadDesktopConnectionApi();
    const nextSessions = await deleteDesktopCmSession(sessionId);
    setSessions(nextSessions);
    if (runtimeProfile?.sessionId === sessionId) {
      clearDesktopCmRuntimeProfile();
      setRuntimeProfile(null);
      onRuntimeStopped();
    }
    setMessage('CM/SSH session 삭제됨');
  }, [onRuntimeStopped, runtimeProfile?.sessionId]);

  const importPrivateKey = useCallback(async (sessionId: string, keyFilePath: string) => {
    const { importDesktopCmSessionPrivateKey } = await loadDesktopConnectionApi();
    const updatedSession = await importDesktopCmSessionPrivateKey(sessionId, keyFilePath);
    if (!updatedSession) {
      throw new Error('desktop_cm_private_key_import_failed');
    }
    setSessions((currentSessions) => upsertDesktopCmSession(currentSessions, updatedSession));
    setMessage(`${updatedSession.name} credential 저장됨`);
  }, []);

  const deleteCredential = useCallback(async (sessionId: string) => {
    const { clearDesktopCmRuntimeProfile, deleteDesktopCmSessionCredential } = await loadDesktopConnectionApi();
    const updatedSession = await deleteDesktopCmSessionCredential(sessionId);
    if (!updatedSession) {
      throw new Error('desktop_cm_credential_delete_failed');
    }
    if (runtimeProfile?.sessionId === sessionId) {
      clearDesktopCmRuntimeProfile();
      setRuntimeProfile(null);
      onRuntimeStopped();
    }
    setSessions((currentSessions) => upsertDesktopCmSession(currentSessions, updatedSession));
    setMessage(`${updatedSession.name} credential 삭제됨`);
  }, [onRuntimeStopped, runtimeProfile?.sessionId]);

  const checkSession = useCallback(async (sessionId: string) => {
    const { checkDesktopCmSession } = await loadDesktopConnectionApi();
    const updatedSession = await checkDesktopCmSession(sessionId);
    if (!updatedSession) {
      throw new Error('desktop_cm_session_check_failed');
    }
    setSessions((currentSessions) => upsertDesktopCmSession(currentSessions, updatedSession));
    setMessage(`${updatedSession.name} 확인 · ${formatCmSessionStatus(updatedSession.lastCheckStatus)}`);
  }, []);

  const startRuntime = useCallback(async (sessionId: string) => {
    const { startDesktopCmSessionRuntime, storeDesktopCmRuntimeProfile } = await loadDesktopConnectionApi();
    const profile = await startDesktopCmSessionRuntime(sessionId);
    if (!profile) {
      throw new Error('desktop_cm_runtime_start_failed');
    }
    storeDesktopCmRuntimeProfile(profile);
    setRuntimeProfile(profile);
    setSessions((currentSessions) =>
      currentSessions.map((session) => ({
        ...session,
        selected: session.id === profile.sessionId,
        status: session.id === profile.sessionId ? 'runtime-active' : session.status,
        runtimeStatus: session.id === profile.sessionId ? 'runtime-active' : 'stopped',
        diagnosticStage: session.id === profile.sessionId ? profile.diagnosticStage : session.diagnosticStage,
        diagnosticSeverity: session.id === profile.sessionId ? profile.diagnosticSeverity : session.diagnosticSeverity,
        diagnosticMessage: session.id === profile.sessionId ? profile.diagnosticMessage : session.diagnosticMessage,
        diagnosticHint: session.id === profile.sessionId ? profile.diagnosticHint : session.diagnosticHint,
      })),
    );
    onRuntimeStarted();
    setMessage(`${profile.sessionName} runtime 시작됨`);
  }, [onRuntimeStarted]);

  const stopRuntime = useCallback(async () => {
    const { clearDesktopCmRuntimeProfile, stopDesktopCmSessionRuntime } = await loadDesktopConnectionApi();
    await stopDesktopCmSessionRuntime();
    const stoppedSessionId = runtimeProfile?.sessionId;
    clearDesktopCmRuntimeProfile();
    setRuntimeProfile(null);
    setSessions((currentSessions) =>
      currentSessions.map((session) => ({
        ...session,
        status: session.id === stoppedSessionId && session.credentialAvailable ? 'credential-ready' : session.status,
        runtimeStatus: session.id === stoppedSessionId ? 'stopped' : session.runtimeStatus,
        diagnosticStage: session.id === stoppedSessionId ? 'runtime' : session.diagnosticStage,
        diagnosticSeverity: session.id === stoppedSessionId ? 'info' : session.diagnosticSeverity,
        diagnosticMessage: session.id === stoppedSessionId ? 'runtime-stopped' : session.diagnosticMessage,
        diagnosticHint: session.id === stoppedSessionId ? 'Start runtime again when needed.' : session.diagnosticHint,
      })),
    );
    onRuntimeStopped();
    setMessage('CM/SSH runtime 중지됨');
  }, [onRuntimeStopped, runtimeProfile?.sessionId]);

  const checkRuntime = useCallback(async () => {
    const { checkDesktopCmSessionRuntime, clearDesktopCmRuntimeProfile, storeDesktopCmRuntimeProfile } = await loadDesktopConnectionApi();
    const previousSessionId = runtimeProfile?.sessionId;
    const profile = await checkDesktopCmSessionRuntime();
    if (!profile) {
      clearDesktopCmRuntimeProfile();
      setRuntimeProfile(null);
      setSessions((currentSessions) =>
        currentSessions.map((session) => ({
          ...session,
          status: session.id === previousSessionId ? 'runtime-lost' : session.status,
          runtimeStatus: session.id === previousSessionId ? 'runtime-lost' : session.runtimeStatus,
          diagnosticStage: session.id === previousSessionId ? 'runtime' : session.diagnosticStage,
          diagnosticSeverity: session.id === previousSessionId ? 'error' : session.diagnosticSeverity,
          diagnosticMessage: session.id === previousSessionId ? 'runtime-lost' : session.diagnosticMessage,
          diagnosticHint: session.id === previousSessionId ? 'SSH tunnel process exited. Start the runtime again.' : session.diagnosticHint,
        })),
      );
      onRuntimeStopped();
      setMessage('CM/SSH runtime 끊김');
      return;
    }
    storeDesktopCmRuntimeProfile(profile);
    setRuntimeProfile(profile);
    setSessions((currentSessions) =>
      currentSessions.map((session) => ({
        ...session,
        status: session.id === profile.sessionId ? (profile.healthStatus === 'healthy' ? 'runtime-active' : 'runtime-unhealthy') : session.status,
        runtimeStatus: session.id === profile.sessionId ? (profile.healthStatus === 'healthy' ? 'runtime-active' : 'runtime-unhealthy') : session.runtimeStatus,
        diagnosticStage: session.id === profile.sessionId ? profile.diagnosticStage : session.diagnosticStage,
        diagnosticSeverity: session.id === profile.sessionId ? profile.diagnosticSeverity : session.diagnosticSeverity,
        diagnosticMessage: session.id === profile.sessionId ? profile.diagnosticMessage : session.diagnosticMessage,
        diagnosticHint: session.id === profile.sessionId ? profile.diagnosticHint : session.diagnosticHint,
      })),
    );
    setMessage(`${profile.sessionName} health · ${formatCmRuntimeHealthStatus(profile.healthStatus)}`);
  }, [onRuntimeStopped, runtimeProfile?.sessionId]);

  return {
    sessions,
    runtimeProfile,
    message,
    saveSession,
    selectSession,
    deleteSession,
    importPrivateKey,
    deleteCredential,
    checkSession,
    startRuntime,
    stopRuntime,
    checkRuntime,
  };
}

function upsertDesktopCmSession(sessions: DesktopCmSession[], savedSession: DesktopCmSession) {
  if (!sessions.some((session) => session.id === savedSession.id)) {
    return [savedSession, ...sessions];
  }
  return sessions.map((session) => (session.id === savedSession.id ? savedSession : session));
}

function formatCmSessionStatus(status: string) {
  switch (status) {
    case 'reachable':
      return '연결 가능';
    case 'auth-failed':
      return '인증 실패';
    case 'timeout':
      return '시간 초과';
    case 'unreachable':
      return '연결 불가';
    case 'not-ssh':
      return 'SSH 아님';
    case 'ssh-binary-missing':
      return 'ssh 없음';
    case 'credential-ready':
      return 'credential 준비됨';
    case 'credential-missing':
      return 'credential 없음';
    default:
      return status || '확인 안 됨';
  }
}

function formatCmRuntimeHealthStatus(status: string) {
  switch (status) {
    case 'healthy':
      return '정상';
    case 'unhealthy':
      return 'health 실패';
    case 'unknown':
      return '미확인';
    default:
      return status || '미확인';
  }
}
