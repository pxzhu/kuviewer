import type { ResourceStatus, SummaryValue } from '../../types/topology';
import { isRecord, readAt, type KubeObject } from './kubernetesObject.ts';
import { validUploadContainerImage } from './workloadSchema.ts';

const maxRuntimeStatuses = 64;
const maxRuntimeSummaryItems = 8;
const maxSummaryCount = 1_000_000_000;

type RuntimeState = 'running' | 'waiting' | 'terminated' | 'unknown';

interface ParsedRuntimeStatus {
  ready: boolean;
  restarts: number;
  state: RuntimeState;
  reasons: string[];
  image: string;
}

interface PodRuntimeAnalysis {
  valid: boolean;
  phase: string;
  statuses: ParsedRuntimeStatus[];
  allStatuses: ParsedRuntimeStatus[];
}

export function uploadPodRuntimeIsValid(object: KubeObject) {
  return analyzePodRuntime(object).valid;
}

export function uploadPodRuntimeStatus(object: KubeObject): ResourceStatus {
  const analysis = analyzePodRuntime(object);
  if (!analysis.valid) return 'warning';
  if (!analysis.phase) return 'unknown';
  if (analysis.phase === 'Failed') return 'error';
  if (analysis.phase === 'Succeeded') return 'healthy';
  if (analysis.phase === 'Running' && analysis.statuses.length > 0 && analysis.statuses.every((status) => status.ready && status.state === 'running')) {
    return 'healthy';
  }
  return 'warning';
}

export function uploadPodRuntimeSummary(object: KubeObject): Record<string, SummaryValue> {
  const analysis = analyzePodRuntime(object);
  if (!analysis.valid) {
    return {
      phase: 'invalid',
      ready: 'invalid',
      restarts: 'invalid',
      runtimeStates: [],
      runtimeReasonCount: 'invalid',
      runtimeReasons: [],
      runtimeImageCount: 'invalid',
      runtimeImages: [],
    };
  }

  const stateCounts = new Map<RuntimeState, number>();
  const reasons = new Set<string>();
  const images = new Set<string>();
  analysis.allStatuses.forEach((status) => {
    stateCounts.set(status.state, (stateCounts.get(status.state) ?? 0) + 1);
    status.reasons.forEach((reason) => reasons.add(reason));
    if (status.image) images.add(status.image);
  });
  const sortedReasons = Array.from(reasons).sort();
  const sortedImages = Array.from(images).sort();
  return {
    phase: analysis.phase || 'unknown',
    ready: `${analysis.statuses.filter((status) => status.ready).length}/${analysis.statuses.length}`,
    restarts: boundedRestartTotal(analysis.statuses),
    runtimeStates: (['running', 'waiting', 'terminated', 'unknown'] as const)
      .filter((state) => stateCounts.has(state))
      .map((state) => `${state}:${stateCounts.get(state)}`),
    runtimeReasonCount: sortedReasons.length,
    runtimeReasons: sortedReasons.slice(0, maxRuntimeSummaryItems),
    runtimeImageCount: sortedImages.length,
    runtimeImages: sortedImages.slice(0, maxRuntimeSummaryItems),
  };
}

function analyzePodRuntime(object: KubeObject): PodRuntimeAnalysis {
  const phaseValue = readAt(object, ['status', 'phase']);
  const phase = phaseValue == null ? '' : typeof phaseValue === 'string' ? phaseValue : '__invalid__';
  const seenNames = new Set<string>();
  const statuses = parseRuntimeStatuses(readAt(object, ['status', 'containerStatuses']), seenNames);
  const initStatuses = parseRuntimeStatuses(readAt(object, ['status', 'initContainerStatuses']), seenNames);
  const ephemeralStatuses = parseRuntimeStatuses(readAt(object, ['status', 'ephemeralContainerStatuses']), seenNames);
  if (!validPodPhase(phase) || !statuses || !initStatuses || !ephemeralStatuses || statuses.length + initStatuses.length + ephemeralStatuses.length > maxRuntimeStatuses) {
    return { valid: false, phase, statuses: [], allStatuses: [] };
  }
  return { valid: true, phase, statuses, allStatuses: [...statuses, ...initStatuses, ...ephemeralStatuses] };
}

function parseRuntimeStatuses(value: unknown, seenNames: Set<string>): ParsedRuntimeStatus[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxRuntimeStatuses || value.some((item) => !isRecord(item))) return null;
  const result: ParsedRuntimeStatus[] = [];
  for (const status of value as Record<string, unknown>[]) {
    if (typeof status.name !== 'string' || !validContainerName(status.name) || seenNames.has(status.name) || typeof status.ready !== 'boolean' || !validCount(status.restartCount)) {
      return null;
    }
    if (status.image != null && (typeof status.image !== 'string' || !validUploadContainerImage(status.image))) {
      return null;
    }
    const currentState = parseContainerState(status.state);
    const lastState = parseContainerState(status.lastState);
    if (!currentState || !lastState) return null;
    seenNames.add(status.name);
    result.push({
      ready: status.ready,
      restarts: status.restartCount,
      state: currentState.state,
      reasons: [
        ...(currentState.reason ? [`${currentState.state}:${currentState.reason}`] : []),
        ...(lastState.reason ? [`last:${lastState.reason}`] : []),
      ],
      image: typeof status.image === 'string' ? status.image : '',
    });
  }
  return result;
}

function parseContainerState(value: unknown): { state: RuntimeState; reason: string } | null {
  if (value == null) return { state: 'unknown', reason: '' };
  if (!isRecord(value)) return null;
  const set = ['waiting', 'running', 'terminated'].filter((key) => value[key] != null);
  if (set.length === 0) return { state: 'unknown', reason: '' };
  if (set.length !== 1) return null;
  const state = set[0] as Exclude<RuntimeState, 'unknown'>;
  const detail = value[state];
  if (!isRecord(detail)) return null;
  if (state === 'running') return { state, reason: '' };
  const reason = detail.reason == null ? '' : typeof detail.reason === 'string' ? detail.reason : '__invalid__';
  if (!validRuntimeReason(reason)) return null;
  if (state === 'terminated' && !validCount(detail.exitCode)) return null;
  if (state === 'terminated' && detail.signal != null && !validCount(detail.signal)) return null;
  return { state, reason };
}

function boundedRestartTotal(statuses: ParsedRuntimeStatus[]) {
  return statuses.reduce((total, status) => Math.min(maxSummaryCount, total + status.restarts), 0);
}

function validPodPhase(value: string) {
  return ['', 'Pending', 'Running', 'Succeeded', 'Failed', 'Unknown'].includes(value);
}

function validContainerName(value: string) {
  return value.length > 0 && value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

function validRuntimeReason(value: string) {
  return value === '' || value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value);
}

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maxSummaryCount;
}
