import type { ResourceStatus, SummaryValue } from '../../types/topology';
import { labelSelectorSummary } from './labelSelector.ts';
import { isRecord, type KubeObject } from './kubernetesObject.ts';

const maxMetrics = 64;
const maxConditions = 16;
const maxMetricNameLength = 253;
const maxQuantityLength = 64;
const maxCount = 1_000_000_000;
const maxUtilization = 1_000_000;
const metricTypes = ['ContainerResource', 'External', 'Object', 'Pods', 'Resource'] as const;

type MetricType = (typeof metricTypes)[number];

interface ParsedMetric {
  sourceType: MetricType;
  valueType: string;
}

interface ParsedSpec {
  target: { apiVersion: string; kind: string; name: string };
  minimum: number;
  maximum: number;
  metrics: ParsedMetric[];
}

interface ParsedStatus {
  current: number;
  desired: number;
  metrics: ParsedMetric[];
  conditions: Array<{ type: string; status: 'True' | 'False' | 'Unknown' }>;
}

export function uploadHPASpecIsValid(object: KubeObject) {
  return parseSpec(object) !== null;
}

export function uploadHPAScaleTarget(object: KubeObject) {
  return parseSpec(object)?.target;
}

export function uploadHPAStatus(object: KubeObject): ResourceStatus {
  const spec = parseSpec(object);
  const status = parseStatus(object);
  if (!spec || !status || status.conditions.some((condition) => (condition.type === 'AbleToScale' || condition.type === 'ScalingActive') && condition.status !== 'True')) {
    return 'warning';
  }
  return status.desired === 0 || status.current >= status.desired ? 'healthy' : 'warning';
}

export function uploadHPASummary(object: KubeObject): Record<string, SummaryValue> {
  const spec = parseSpec(object);
  const status = parseStatus(object);
  return {
    target: spec ? `${spec.target.kind}/${spec.target.name}` : 'invalid',
    range: spec ? `${spec.minimum}-${spec.maximum}` : 'invalid',
    metrics: spec ? spec.metrics.length : 'invalid',
    metricTypes: spec ? countSummary(spec.metrics.map((metric) => metric.sourceType)) : 'invalid',
    metricTargets: spec ? countSummary(spec.metrics.map((metric) => metric.valueType)) : 'invalid',
    replicas: status ? `${status.current}/${status.desired}` : 'invalid',
    currentMetrics: status ? status.metrics.length : 'invalid',
    currentTypes: status ? countSummary(status.metrics.map((metric) => metric.sourceType)) : 'invalid',
    currentValues: status ? countSummary(status.metrics.map((metric) => metric.valueType)) : 'invalid',
    conditions: status ? status.conditions.map((condition) => `${condition.type}=${condition.status}`).sort().join(',') || '-' : 'invalid',
  };
}

function parseSpec(object: KubeObject): ParsedSpec | null {
  const spec = object.spec;
  if (!isRecord(spec) || !isRecord(spec.scaleTargetRef)) {
    return null;
  }
  const target = parseScaleTarget(spec.scaleTargetRef);
  const minimum = spec.minReplicas == null ? 1 : safeCount(spec.minReplicas);
  const maximum = positiveCount(spec.maxReplicas);
  const metrics = metricArray(spec.metrics, false);
  if (!target || minimum === null || maximum === null || minimum > maximum || !metrics) {
    return null;
  }
  if (minimum === 0 && !metrics.some((metric) => metric.sourceType === 'Object' || metric.sourceType === 'External')) {
    return null;
  }
  return { target, minimum, maximum, metrics };
}

function parseStatus(object: KubeObject): ParsedStatus | null {
  const status = object.status;
  if (!isRecord(status)) {
    return null;
  }
  const current = safeCount(status.currentReplicas);
  const desired = safeCount(status.desiredReplicas);
  const metrics = metricArray(status.currentMetrics, true);
  const conditions = conditionArray(status.conditions);
  return current === null || desired === null || !metrics || !conditions ? null : { current, desired, metrics, conditions };
}

function metricArray(value: unknown, current: boolean): ParsedMetric[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxMetrics) return null;
  const result: ParsedMetric[] = [];
  for (const item of value) {
    const metric = parseMetric(item, current);
    if (!metric) return null;
    result.push(metric);
  }
  return result;
}

function parseMetric(value: unknown, current: boolean): ParsedMetric | null {
  if (!isRecord(value) || !isMetricType(value.type)) return null;
  const sourceField = value.type.charAt(0).toLowerCase() + value.type.slice(1);
  if (!metricTypes.every((type) => {
    const field = type.charAt(0).toLowerCase() + type.slice(1);
    return (value[field] != null) === (field === sourceField);
  })) return null;
  const source = value[sourceField];
  if (!isRecord(source) || !validMetricSourceIdentity(value.type, source)) return null;
  const valueType = current ? parseCurrent(source.current, value.type) : parseTarget(source.target, value.type);
  return valueType ? { sourceType: value.type, valueType } : null;
}

function validMetricSourceIdentity(type: MetricType, source: Record<string, unknown>) {
  if (type === 'Resource') return validMetricName(source.name) && source.container == null && source.metric == null;
  if (type === 'ContainerResource') return validMetricName(source.name) && validDNSLabel(source.container) && source.metric == null;
  if (type === 'Pods' || type === 'External') return source.name == null && source.container == null && validMetricIdentifier(source.metric);
  return source.name == null && source.container == null && validMetricIdentifier(source.metric) && isRecord(source.describedObject) && Boolean(parseScaleTarget(source.describedObject));
}

function validMetricIdentifier(value: unknown) {
  if (!isRecord(value) || !validMetricName(value.name)) return false;
  return value.selector == null || labelSelectorSummary(value.selector) !== 'invalid selector';
}

function parseTarget(value: unknown, sourceType: MetricType) {
  if (!isRecord(value)) return null;
  const rawValue = quantityState(value.value);
  const averageValue = quantityState(value.averageValue);
  const utilization = value.averageUtilization == null ? null : positiveBounded(value.averageUtilization, maxUtilization);
  if (rawValue === false || averageValue === false || utilization === false) return null;
  if (value.type === 'Utilization') return utilization === true && rawValue === null && averageValue === null && (sourceType === 'Resource' || sourceType === 'ContainerResource') ? 'Utilization' : null;
  if (value.type === 'Value') return rawValue === true && averageValue === null && utilization === null && (sourceType === 'Object' || sourceType === 'External') ? 'Value' : null;
  if (value.type === 'AverageValue') return averageValue === true && rawValue === null && utilization === null ? 'AverageValue' : null;
  return null;
}

function parseCurrent(value: unknown, sourceType: MetricType) {
  if (!isRecord(value)) return null;
  const rawValue = quantityState(value.value);
  const averageValue = quantityState(value.averageValue);
  const utilization = value.averageUtilization == null ? null : nonNegativeBounded(value.averageUtilization, maxUtilization);
  if (rawValue === false || averageValue === false || utilization === false) return null;
  const set = [rawValue === true ? 'value' : '', averageValue === true ? 'averageValue' : '', utilization === true ? 'utilization' : ''].filter(Boolean);
  if (set.length !== 1) return null;
  const kind = set[0] || '';
  if ((sourceType === 'Resource' || sourceType === 'ContainerResource') && (kind === 'averageValue' || kind === 'utilization')) return kind;
  if (sourceType === 'Pods' && kind === 'averageValue') return kind;
  if ((sourceType === 'Object' || sourceType === 'External') && (kind === 'value' || kind === 'averageValue')) return kind;
  return null;
}

function conditionArray(value: unknown): ParsedStatus['conditions'] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxConditions) return null;
  const seen = new Set<string>();
  const result: ParsedStatus['conditions'] = [];
  for (const item of value) {
    if (!isRecord(item) || (item.type !== 'AbleToScale' && item.type !== 'ScalingActive' && item.type !== 'ScalingLimited') || (item.status !== 'True' && item.status !== 'False' && item.status !== 'Unknown') || seen.has(item.type)) return null;
    seen.add(item.type);
    result.push({ type: item.type, status: item.status });
  }
  return result;
}

function parseScaleTarget(value: Record<string, unknown>) {
  return validAPIVersion(value.apiVersion) && validKind(value.kind) && validReferenceName(value.name)
    ? { apiVersion: value.apiVersion, kind: value.kind, name: value.name }
    : null;
}

function isMetricType(value: unknown): value is MetricType {
  return typeof value === 'string' && metricTypes.includes(value as MetricType);
}

function validMetricName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxMetricNameLength && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value);
}

function quantityState(value: unknown): boolean | null {
  if (value == null) return null;
  return typeof value === 'string' && value.length > 0 && value.length <= maxQuantityLength && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+|[numkKMGTPE](?:i)?)?$/.test(value);
}

function safeCount(value: unknown) {
  return nonNegativeBounded(value, maxCount) === true ? value as number : null;
}

function positiveCount(value: unknown) {
  return positiveBounded(value, maxCount) === true ? value as number : null;
}

function nonNegativeBounded(value: unknown, maximum: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum;
}

function positiveBounded(value: unknown, maximum: number) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= maximum;
}

function validAPIVersion(value: unknown): value is string {
  if (value === 'v1') return true;
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  return parts.length === 2 && validDNSSubdomain(parts[0]) && /^v[a-z0-9]{1,62}$/.test(parts[1] || '');
}

function validKind(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 63 && /^[A-Za-z][A-Za-z0-9]*$/.test(value);
}

function validReferenceName(value: unknown): value is string {
  return typeof value === 'string' && validDNSSubdomain(value);
}

function validDNSLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 63 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value);
}

function validDNSSubdomain(value: string) {
  return value.length > 0 && value.length <= 253 && value === value.toLowerCase() && value.split('.').every((part) => validDNSLabel(part));
}

function countSummary(values: string[]) {
  if (values.length === 0) return '';
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([value, count]) => `${value}:${count}`).join(',');
}
