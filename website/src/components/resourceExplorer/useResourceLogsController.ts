import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchResourceLogs, streamResourceLogs } from '../../services/resourceApi';
import type { ResourceExplorerItem } from '../../types/resourceExplorer';
import {
  collectLogSearchMatches,
  downloadTextFile,
  filterLogLines,
  logDownloadFileName,
  parseLogLines,
  podLogContainerOptions,
  readLogDensityPreference,
  sortLogLines,
  writeLogDensityPreference,
} from './resourceDetailActivity';
import type { LogDensity, LogSortOrder, LogTimeRangeFilter } from './resourceDetailTypes';

const maxVisibleLogLines = 500;

export function useResourceLogsController({ liveEnabled, resource }: { liveEnabled: boolean; resource: ResourceExplorerItem }) {
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logsError, setLogsError] = useState('');
  const [logsWarning, setLogsWarning] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsStreaming, setLogsStreaming] = useState(false);
  const [logsPaused, setLogsPaused] = useState(false);
  const [pendingLogLines, setPendingLogLines] = useState<string[]>([]);
  const [selectedLogContainer, setSelectedLogContainer] = useState('');
  const [previousLogs, setPreviousLogs] = useState(false);
  const [logFilter, setLogFilter] = useState('');
  const [activeLogMatchIndex, setActiveLogMatchIndex] = useState(0);
  const [logTimeRangeFilter, setLogTimeRangeFilter] = useState<LogTimeRangeFilter>('all');
  const [logSortOrder, setLogSortOrder] = useState<LogSortOrder>('received');
  const [logCopyStatus, setLogCopyStatus] = useState<{ tone: 'success' | 'warning'; message: string } | null>(null);
  const [logDensity, setLogDensity] = useState<LogDensity>(() => readLogDensityPreference());
  const logsStreamControllerRef = useRef<AbortController | null>(null);
  const logsPausedRef = useRef(false);
  const pendingLogLinesRef = useRef<string[]>([]);
  const logLineRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const canFetchLogs = liveEnabled && resource.kind === 'Pod';
  const logContainerOptions = useMemo(() => podLogContainerOptions(resource), [resource]);
  const effectiveLogContainer = selectedLogContainer || logContainerOptions.find((option) => !option.init)?.name || logContainerOptions[0]?.name || '';
  const parsedLogLines = useMemo(() => parseLogLines(logLines), [logLines]);
  const filteredLogLines = useMemo(
    () => sortLogLines(filterLogLines(parsedLogLines, logFilter, logTimeRangeFilter, Date.now()), logSortOrder),
    [logFilter, logSortOrder, logTimeRangeFilter, parsedLogLines],
  );
  const logSearchMatches = useMemo(() => collectLogSearchMatches(filteredLogLines, logFilter), [filteredLogLines, logFilter]);
  const activeLogMatch = logSearchMatches[activeLogMatchIndex] || null;

  const resetLogPauseState = useCallback(() => {
    logsPausedRef.current = false;
    pendingLogLinesRef.current = [];
    setLogsPaused(false);
    setPendingLogLines([]);
  }, []);

  const abortLogStream = useCallback(() => {
    logsStreamControllerRef.current?.abort();
    logsStreamControllerRef.current = null;
  }, []);

  const stopLogStream = useCallback(() => {
    abortLogStream();
    setLogsStreaming(false);
    resetLogPauseState();
  }, [abortLogStream, resetLogPauseState]);

  const resetResourceLogState = useCallback(() => {
    abortLogStream();
    setLogLines([]);
    setLogsError('');
    setLogsWarning('');
    setLogsLoading(false);
    setLogsStreaming(false);
    resetLogPauseState();
    setSelectedLogContainer('');
    setPreviousLogs(false);
    setLogFilter('');
    setActiveLogMatchIndex(0);
    setLogTimeRangeFilter('all');
    setLogSortOrder('received');
    setLogCopyStatus(null);
  }, [abortLogStream, resetLogPauseState]);

  const clearLogOutput = useCallback(() => {
    setLogLines([]);
    setLogsError('');
    setLogsWarning('');
    setLogFilter('');
    setActiveLogMatchIndex(0);
    setLogTimeRangeFilter('all');
    setLogSortOrder('received');
    setLogCopyStatus(null);
  }, []);

  useEffect(() => resetResourceLogState(), [resetResourceLogState, resource.id]);
  useEffect(() => () => abortLogStream(), [abortLogStream]);
  useEffect(() => writeLogDensityPreference(logDensity), [logDensity]);

  useEffect(() => {
    if (!logCopyStatus) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setLogCopyStatus(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [logCopyStatus]);

  useEffect(() => {
    setActiveLogMatchIndex((current) => logSearchMatches.length === 0 ? 0 : Math.min(current, logSearchMatches.length - 1));
  }, [logSearchMatches.length]);

  useEffect(() => {
    if (!activeLogMatch) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      logLineRefs.current[activeLogMatch.lineIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeLogMatch?.id]);

  const fetchLogs = useCallback(async () => {
    if (!canFetchLogs) {
      return;
    }
    stopLogStream();
    resetLogPauseState();
    setActiveLogMatchIndex(0);
    setLogsLoading(true);
    setLogsError('');
    setLogsWarning('');
    setLogCopyStatus(null);
    try {
      const response = await fetchResourceLogs(resource, { container: effectiveLogContainer || undefined, previous: previousLogs });
      setLogLines(response.lines);
      setLogsWarning(response.warning || '');
    } catch (requestError) {
      setLogLines([]);
      setLogsError(requestError instanceof Error ? requestError.message : 'resource_logs_request_failed');
    } finally {
      setLogsLoading(false);
    }
  }, [canFetchLogs, effectiveLogContainer, previousLogs, resetLogPauseState, resource, stopLogStream]);

  const pauseLogStream = useCallback(() => {
    if (!logsStreaming) {
      return;
    }
    logsPausedRef.current = true;
    setLogsPaused(true);
    setLogCopyStatus(null);
  }, [logsStreaming]);

  const resumeLogStream = useCallback(() => {
    const pendingLines = pendingLogLinesRef.current;
    resetLogPauseState();
    if (pendingLines.length > 0) {
      setLogLines((current) => [...current, ...pendingLines].slice(-maxVisibleLogLines));
    }
    setLogCopyStatus(null);
  }, [resetLogPauseState]);

  const toggleLogStream = useCallback(async () => {
    if (!canFetchLogs || previousLogs) {
      return;
    }
    if (logsStreaming) {
      stopLogStream();
      return;
    }

    const controller = new AbortController();
    logsStreamControllerRef.current = controller;
    setLogLines([]);
    setLogsError('');
    setLogsWarning('');
    setLogCopyStatus(null);
    setActiveLogMatchIndex(0);
    resetLogPauseState();
    setLogsStreaming(true);
    try {
      await streamResourceLogs(
        resource,
        { container: effectiveLogContainer || undefined, previous: false, signal: controller.signal, tailLines: 200 },
        (message) => {
          if (message.warning) {
            setLogsWarning(message.warning);
          }
          if (typeof message.line !== 'string') {
            return;
          }
          const line = message.line;
          if (logsPausedRef.current) {
            pendingLogLinesRef.current = [...pendingLogLinesRef.current, line].slice(-maxVisibleLogLines);
            setPendingLogLines(pendingLogLinesRef.current);
          } else {
            setLogLines((current) => [...current, line].slice(-maxVisibleLogLines));
          }
        },
      );
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setLogsError(requestError instanceof Error ? requestError.message : 'resource_logs_stream_failed');
      }
    } finally {
      if (logsStreamControllerRef.current === controller) {
        logsStreamControllerRef.current = null;
        setLogsStreaming(false);
        resetLogPauseState();
      }
    }
  }, [canFetchLogs, effectiveLogContainer, logsStreaming, previousLogs, resetLogPauseState, resource, stopLogStream]);

  const copyLogs = useCallback(async (mode: 'visible' | 'all') => {
    const lines = mode === 'all' ? logLines : filteredLogLines.map(({ line }) => line);
    if (lines.length === 0) {
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setLogCopyStatus({ tone: 'warning', message: '복사할 수 없습니다' });
      return;
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setLogCopyStatus({ tone: 'success', message: `${lines.length}줄 복사됨` });
    } catch {
      setLogCopyStatus({ tone: 'warning', message: '복사할 수 없습니다' });
    }
  }, [filteredLogLines, logLines]);

  const downloadLogs = useCallback((mode: 'visible' | 'all') => {
    const lines = mode === 'all' ? logLines : filteredLogLines.map(({ line }) => line);
    if (lines.length === 0) {
      return;
    }
    downloadTextFile(`${lines.join('\n')}\n`, 'text/plain;charset=utf-8', logDownloadFileName(resource, effectiveLogContainer, previousLogs));
    setLogCopyStatus({ tone: 'success', message: `${lines.length}줄 다운로드 준비됨` });
  }, [effectiveLogContainer, filteredLogLines, logLines, previousLogs, resource]);

  const moveActiveLogMatch = useCallback((offset: number) => {
    if (logSearchMatches.length === 0) {
      return;
    }
    setActiveLogMatchIndex((current) => (current + offset + logSearchMatches.length) % logSearchMatches.length);
    setLogCopyStatus(null);
  }, [logSearchMatches.length]);

  return {
    activeLogMatch,
    activeLogMatchIndex,
    canFetchLogs,
    clearLogOutput,
    copyLogs,
    downloadLogs,
    effectiveLogContainer,
    fetchLogs,
    filteredLogLines,
    logContainerOptions,
    logCopyStatus,
    logDensity,
    logFilter,
    logLineRefs,
    logLines,
    logSearchMatches,
    logSortOrder,
    logsError,
    logsLoading,
    logsPaused,
    logsStreaming,
    logsWarning,
    logTimeRangeFilter,
    moveActiveLogMatch,
    pauseLogStream,
    pendingLogLines,
    previousLogs,
    resetLogPauseState,
    resetResourceLogState,
    resumeLogStream,
    selectedLogContainer,
    setActiveLogMatchIndex,
    setLogCopyStatus,
    setLogDensity,
    setLogFilter,
    setLogSortOrder,
    setLogTimeRangeFilter,
    setPreviousLogs,
    setSelectedLogContainer,
    stopLogStream,
    toggleLogStream,
  };
}
