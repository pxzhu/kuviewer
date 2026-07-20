import type { ResourceStatus, SummaryValue } from '../../types/topology';
import { isRecord, readAt, type KubeObject } from './kubernetesObject.ts';

const maxConfigMapEntries = 4096;

interface ConfigMapAnalysis {
  valid: boolean;
  status: ResourceStatus;
  summary: Record<string, SummaryValue>;
}

interface ConfigMapKeyField {
  valid: boolean;
  keys: Set<string>;
}

const sanitizedAnalysis = new WeakMap<KubeObject, ConfigMapAnalysis>();

export function uploadConfigMapStatus(object: KubeObject) {
  return configMapAnalysis(object).status;
}

export function uploadConfigMapSummary(object: KubeObject) {
  return configMapAnalysis(object).summary;
}

// Uploaded values are parsed locally, then discarded before the topology build retains the object.
export function sanitizeUploadConfigMap(object: KubeObject): KubeObject {
  if (object.kind !== 'ConfigMap') return object;
  const analysis = analyzeConfigMap(object);
  const sanitized: KubeObject = {
    ...object,
    data: undefined,
    binaryData: undefined,
  };
  sanitizedAnalysis.set(sanitized, analysis);
  return sanitized;
}

function configMapAnalysis(object: KubeObject) {
  return sanitizedAnalysis.get(object) ?? analyzeConfigMap(object);
}

function analyzeConfigMap(object: KubeObject): ConfigMapAnalysis {
  const data = parseKeyField(readAt(object, ['data']));
  const binaryData = parseKeyField(readAt(object, ['binaryData']));
  const immutable = readAt(object, ['immutable']);
  const total = data.keys.size + binaryData.keys.size;
  const valid = data.valid && binaryData.valid && total <= maxConfigMapEntries &&
    immutableValueIsValid(immutable) && !setsOverlap(data.keys, binaryData.keys);
  if (!valid) {
    return {
      valid: false,
      status: 'warning',
      summary: invalidSummary('keys', 'dataKeys', 'binaryKeys', 'immutable'),
    };
  }
  return {
    valid: true,
    status: 'healthy',
    summary: {
      keys: total,
      dataKeys: data.keys.size,
      binaryKeys: binaryData.keys.size,
      immutable: typeof immutable === 'boolean' ? immutable : 'unset',
    },
  };
}

function parseKeyField(value: unknown): ConfigMapKeyField {
  if (value == null) return { valid: true, keys: new Set() };
  if (!isRecord(value)) return { valid: false, keys: new Set() };
  const entries = Object.entries(value);
  if (entries.length > maxConfigMapEntries) return { valid: false, keys: new Set() };
  const keys = new Set<string>();
  for (const [key, entryValue] of entries) {
    if (!validConfigMapKey(key) || typeof entryValue !== 'string' || keys.has(key)) {
      return { valid: false, keys: new Set() };
    }
    keys.add(key);
  }
  return { valid: true, keys };
}

function immutableValueIsValid(value: unknown) {
  return value == null || typeof value === 'boolean';
}

function setsOverlap(left: Set<string>, right: Set<string>) {
  for (const key of left) {
    if (right.has(key)) return true;
  }
  return false;
}

function validConfigMapKey(value: string) {
  return value.length > 0 && value !== '.' && value.length <= 253 && !value.startsWith('..') && /^[-._A-Za-z0-9]+$/.test(value);
}

function invalidSummary(...keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, 'invalid'])) as Record<string, SummaryValue>;
}
