import type { ResourceStatus, SummaryValue } from '../../types/topology';
import { isRecord, type KubeObject } from './kubernetesObject.ts';

const maxNodeResourceEntries = 128;
const maxNodeConditionEntries = 64;
const maxNodeVersionBytes = 64;
const maxSummaryCount = 1_000_000_000;

const quantityPattern = /^[0-9]+(?:\.[0-9]+)?(?:n|u|m|k|K|M|G|T|P|E|Ki|Mi|Gi|Ti|Pi|Ei|[eE][+-]?[0-9]+)?$/;
const kubeletVersionPattern = /^v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const runtimeVersionPattern = /^[a-z0-9][a-z0-9._-]{0,31}:\/\/[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const architecturePattern = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const conditionTypePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

interface NodeStatusAnalysis {
  valid: boolean;
  observed: boolean;
  ready: boolean;
  summary: Record<string, SummaryValue>;
}

interface ParsedNodeCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
}

interface ParsedNodeSystemInfo {
  kubeletVersion: string;
  containerRuntime: string;
  operatingSystem: string;
  architecture: string;
}

export function uploadNodeStatusIsValid(object: KubeObject) {
  return analyzeNodeStatus(object).valid;
}

export function uploadNodeStatus(object: KubeObject): ResourceStatus {
  const analysis = analyzeNodeStatus(object);
  if (!analysis.observed) return 'unknown';
  return analysis.valid && analysis.ready ? 'healthy' : 'warning';
}

export function uploadNodeSummary(object: KubeObject): Record<string, SummaryValue> {
  return analyzeNodeStatus(object).summary;
}

function analyzeNodeStatus(object: KubeObject): NodeStatusAnalysis {
  const status = object.status;
  if (status == null || isRecord(status) && !nodeStatusObserved(status)) {
    return { valid: true, observed: false, ready: false, summary: nodeSummaryValues({}, {}, [], emptyNodeSystemInfo()) };
  }
  if (!isRecord(status)) {
    return invalidNodeStatusAnalysis();
  }

  const capacity = parseNodeResourceList(status.capacity);
  const allocatable = parseNodeResourceList(status.allocatable);
  const conditions = parseNodeConditions(status.conditions);
  const nodeInfo = parseNodeSystemInfo(status.nodeInfo);
  if (!capacity || !allocatable || !conditions || !nodeInfo || !validPodAllocation(capacity, allocatable)) {
    return invalidNodeStatusAnalysis();
  }
  return {
    valid: true,
    observed: true,
    ready: conditions.some((condition) => condition.type === 'Ready' && condition.status === 'True'),
    summary: nodeSummaryValues(capacity, allocatable, conditions, nodeInfo),
  };
}

function nodeStatusObserved(status: Record<string, unknown>) {
  return ['conditions', 'capacity', 'allocatable', 'nodeInfo'].some((key) => status[key] != null);
}

function parseNodeResourceList(value: unknown): Record<string, string> | null {
  if (value == null) return {};
  if (!isRecord(value) || Object.keys(value).length > maxNodeResourceEntries) return null;
  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const normalized = normalizeQuantityValue(rawValue);
    if (!normalized) return null;
    result[key] = normalized;
  }
  for (const key of ['cpu', 'memory', 'ephemeral-storage']) {
    if (result[key] != null && !validNodeQuantity(result[key])) return null;
  }
  if (result.pods != null && parsePodCapacity(result.pods) === null) return null;
  return result;
}

function parseNodeConditions(value: unknown): ParsedNodeCondition[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxNodeConditionEntries || value.some((item) => !isRecord(item))) return null;
  const seen = new Set<string>();
  const result: ParsedNodeCondition[] = [];
  for (const condition of value as Record<string, unknown>[]) {
    if (typeof condition.type !== 'string' || !conditionTypePattern.test(condition.type) || seen.has(condition.type) ||
      (condition.status !== 'True' && condition.status !== 'False' && condition.status !== 'Unknown')) {
      return null;
    }
    seen.add(condition.type);
    result.push({ type: condition.type, status: condition.status });
  }
  return result;
}

function parseNodeSystemInfo(value: unknown): ParsedNodeSystemInfo | null {
  if (value == null) return emptyNodeSystemInfo();
  if (!isRecord(value)) return null;
  const kubeletVersion = optionalString(value.kubeletVersion);
  const containerRuntime = optionalString(value.containerRuntimeVersion);
  const operatingSystem = optionalString(value.operatingSystem);
  const architecture = optionalString(value.architecture);
  if (kubeletVersion === null || containerRuntime === null || operatingSystem === null || architecture === null) {
    return null;
  }
  const validOperatingSystem = operatingSystem === '' || operatingSystem === 'linux' || operatingSystem === 'windows';
  const validArchitecture = architecture === '' || architecturePattern.test(architecture);
  if (!validOptionalNodeValue(kubeletVersion, kubeletVersionPattern) ||
    !validOptionalNodeValue(containerRuntime, runtimeVersionPattern) || !validOperatingSystem || !validArchitecture) {
    return null;
  }
  return { kubeletVersion, containerRuntime, operatingSystem, architecture };
}

function nodeSummaryValues(
  capacity: Record<string, string>,
  allocatable: Record<string, string>,
  conditions: ParsedNodeCondition[],
  info: ParsedNodeSystemInfo,
): Record<string, SummaryValue> {
  return {
    capacityCpu: capacity.cpu ?? 'unknown',
    allocatableCpu: allocatable.cpu ?? 'unknown',
    capacityMemory: capacity.memory ?? 'unknown',
    allocatableMemory: allocatable.memory ?? 'unknown',
    capacityPods: capacity.pods == null ? 'unknown' : parsePodCapacity(capacity.pods) ?? 'invalid',
    allocatablePods: allocatable.pods == null ? 'unknown' : parsePodCapacity(allocatable.pods) ?? 'invalid',
    capacityEphemeralStorage: capacity['ephemeral-storage'] ?? 'unknown',
    allocatableEphemeralStorage: allocatable['ephemeral-storage'] ?? 'unknown',
    capacityResourceCount: Object.keys(capacity).length,
    allocatableResourceCount: Object.keys(allocatable).length,
    kubeletVersion: info.kubeletVersion || 'unknown',
    containerRuntime: info.containerRuntime || 'unknown',
    operatingSystem: info.operatingSystem || 'unknown',
    architecture: info.architecture || 'unknown',
    conditions: conditions.length === 0
      ? 'unknown'
      : conditions.map((condition) => `${condition.type}=${condition.status}`).sort().join(', '),
  };
}

function invalidNodeStatusAnalysis(): NodeStatusAnalysis {
  const summary = Object.fromEntries([
    'capacityCpu', 'allocatableCpu', 'capacityMemory', 'allocatableMemory', 'capacityPods', 'allocatablePods',
    'capacityEphemeralStorage', 'allocatableEphemeralStorage', 'capacityResourceCount', 'allocatableResourceCount',
    'kubeletVersion', 'containerRuntime', 'operatingSystem', 'architecture', 'conditions',
  ].map((key) => [key, 'invalid'])) as Record<string, SummaryValue>;
  return { valid: false, observed: true, ready: false, summary };
}

function validPodAllocation(capacity: Record<string, string>, allocatable: Record<string, string>) {
  const capacityPods = capacity.pods == null ? null : parsePodCapacity(capacity.pods);
  const allocatablePods = allocatable.pods == null ? null : parsePodCapacity(allocatable.pods);
  return capacityPods == null || allocatablePods == null || allocatablePods <= capacityPods;
}

function normalizeQuantityValue(value: unknown) {
  if (typeof value === 'string') return value;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maxSummaryCount ? String(value) : '';
}

function validNodeQuantity(value: string) {
  return value.length > 0 && value.length <= maxNodeVersionBytes && value.trim() === value && quantityPattern.test(value);
}

function parsePodCapacity(value: string) {
  return /^[0-9]{1,10}$/.test(value) && Number(value) <= maxSummaryCount ? Number(value) : null;
}

function validOptionalNodeValue(value: string, pattern: RegExp) {
  return value === '' || value.length <= maxNodeVersionBytes && value.trim() === value && pattern.test(value);
}

function optionalString(value: unknown) {
  return value == null ? '' : typeof value === 'string' ? value : null;
}

function emptyNodeSystemInfo(): ParsedNodeSystemInfo {
  return { kubeletVersion: '', containerRuntime: '', operatingSystem: '', architecture: '' };
}
