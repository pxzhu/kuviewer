import type { ResourceKind, ResourceStatus, SummaryValue } from '../../types/topology';
import { isRecord, readAt, type KubeObject } from './kubernetesObject.ts';

type StorageResourceKind = 'PersistentVolumeClaim' | 'PersistentVolume' | 'StorageClass';

const maxStorageResourceEntries = 32;
const maxStorageAccessModes = 4;
const maxQuantityBytes = 64;
const maxSummaryCount = 1_000_000_000;

const quantityPattern = /^[0-9]+(?:\.[0-9]+)?(?:n|u|m|k|K|M|G|T|P|E|Ki|Mi|Gi|Ti|Pi|Ei|[eE][+-]?[0-9]+)?$/;
const accessModes = new Set(['ReadWriteOnce', 'ReadOnlyMany', 'ReadWriteMany', 'ReadWriteOncePod']);

interface StorageAnalysis {
  valid: boolean;
  specValid: boolean;
  status: ResourceStatus;
  summary: Record<string, SummaryValue>;
}

export function isUploadStorageKind(kind: ResourceKind): kind is StorageResourceKind {
  return kind === 'PersistentVolumeClaim' || kind === 'PersistentVolume' || kind === 'StorageClass';
}

export function uploadStorageSpecIsValid(kind: StorageResourceKind, object: KubeObject) {
  return analyzeStorage(kind, object).specValid;
}

export function uploadStorageStatus(kind: StorageResourceKind, object: KubeObject) {
  return analyzeStorage(kind, object).status;
}

export function uploadStorageSummary(kind: StorageResourceKind, object: KubeObject) {
  return analyzeStorage(kind, object).summary;
}

export function uploadStorageReferences(kind: StorageResourceKind, object: KubeObject) {
  const analysis = analyzeStorage(kind, object);
  if (!analysis.specValid || kind === 'StorageClass') return [];
  const result: Array<{ kind: 'PersistentVolume' | 'StorageClass'; name: string }> = [];
  if (kind === 'PersistentVolumeClaim') {
    const volumeName = optionalString(readAt(object, ['spec', 'volumeName']));
    if (volumeName && validReferenceName(volumeName)) result.push({ kind: 'PersistentVolume', name: volumeName });
  }
  const storageClassName = optionalString(readAt(object, ['spec', 'storageClassName']));
  if (storageClassName && validReferenceName(storageClassName)) result.push({ kind: 'StorageClass', name: storageClassName });
  return result;
}

function analyzeStorage(kind: StorageResourceKind, object: KubeObject): StorageAnalysis {
  if (kind === 'PersistentVolumeClaim') return analyzePVC(object);
  if (kind === 'PersistentVolume') return analyzePV(object);
  return analyzeStorageClass(object);
}

function analyzePVC(object: KubeObject): StorageAnalysis {
  const requests = parseResourceList(readAt(object, ['spec', 'resources', 'requests']), false);
  const capacity = parseResourceList(readAt(object, ['status', 'capacity']), false);
  const specAccessModes = parseAccessModes(readAt(object, ['spec', 'accessModes']), false);
  const statusAccessModes = parseAccessModes(readAt(object, ['status', 'accessModes']), false);
  const volumeName = optionalReference(readAt(object, ['spec', 'volumeName']));
  const storageClassName = optionalReference(readAt(object, ['spec', 'storageClassName']));
  const volumeMode = optionalEnum(readAt(object, ['spec', 'volumeMode']), ['', 'Filesystem', 'Block']);
  const phase = optionalEnum(readAt(object, ['status', 'phase']), ['', 'Pending', 'Bound', 'Lost']);
  const specValid = requests !== null && specAccessModes !== null && volumeName !== null && storageClassName !== null && volumeMode !== null;
  const valid = specValid && capacity !== null && statusAccessModes !== null && phase !== null;
  return {
    valid,
    specValid,
    status: pvcStatusValue(phase, valid),
    summary: valid ? {
      phase: phase || 'unknown',
      requestedStorage: storageQuantitySummary(requests),
      capacityStorage: storageQuantitySummary(capacity),
      accessModes: accessModeSummary(specAccessModes),
      statusAccessModes: accessModeSummary(statusAccessModes),
      volumeMode: volumeMode || 'Filesystem',
      volume: volumeName || 'unbound',
      storageClass: storageClassName || 'default',
      requestResourceCount: Object.keys(requests).length,
      capacityResourceCount: Object.keys(capacity).length,
    } : invalidSummary('phase', 'requestedStorage', 'capacityStorage', 'accessModes', 'statusAccessModes', 'volumeMode', 'volume', 'storageClass', 'requestResourceCount', 'capacityResourceCount'),
  };
}

function analyzePV(object: KubeObject): StorageAnalysis {
  const capacity = parseResourceList(readAt(object, ['spec', 'capacity']), true);
  const specAccessModes = parseAccessModes(readAt(object, ['spec', 'accessModes']), true);
  const storageClassName = optionalReference(readAt(object, ['spec', 'storageClassName']));
  const volumeMode = optionalEnum(readAt(object, ['spec', 'volumeMode']), ['', 'Filesystem', 'Block']);
  const reclaimPolicy = optionalEnum(readAt(object, ['spec', 'persistentVolumeReclaimPolicy']), ['', 'Retain', 'Recycle', 'Delete']);
  const phase = optionalEnum(readAt(object, ['status', 'phase']), ['', 'Pending', 'Available', 'Bound', 'Released', 'Failed']);
  const specValid = capacity !== null && specAccessModes !== null && storageClassName !== null && volumeMode !== null && reclaimPolicy !== null;
  const valid = specValid && phase !== null;
  return {
    valid,
    specValid,
    status: pvStatusValue(phase, valid),
    summary: valid ? {
      phase: phase || 'unknown',
      storage: storageQuantitySummary(capacity),
      accessModes: accessModeSummary(specAccessModes),
      volumeMode: volumeMode || 'Filesystem',
      reclaimPolicy: reclaimPolicy || 'Retain',
      storageClass: storageClassName || 'none',
      capacityResourceCount: Object.keys(capacity).length,
    } : invalidSummary('phase', 'storage', 'accessModes', 'volumeMode', 'reclaimPolicy', 'storageClass', 'capacityResourceCount'),
  };
}

function analyzeStorageClass(object: KubeObject): StorageAnalysis {
  const provisioner = requiredString(readAt(object, ['provisioner']));
  const reclaimPolicy = optionalEnum(readAt(object, ['reclaimPolicy']), ['', 'Retain', 'Delete']);
  const volumeBindingMode = optionalEnum(readAt(object, ['volumeBindingMode']), ['', 'Immediate', 'WaitForFirstConsumer']);
  const allowVolumeExpansion = optionalBoolean(readAt(object, ['allowVolumeExpansion']));
  const valid = provisioner !== null && validLabelKey(provisioner) && reclaimPolicy !== null && volumeBindingMode !== null && allowVolumeExpansion !== null;
  return {
    valid,
    specValid: valid,
    status: valid ? 'healthy' : 'warning',
    summary: valid ? {
      provisioner,
      reclaimPolicy: reclaimPolicy || 'Delete',
      volumeBindingMode: volumeBindingMode || 'Immediate',
      allowVolumeExpansion: allowVolumeExpansion == null ? 'unknown' : allowVolumeExpansion,
    } : invalidSummary('provisioner', 'reclaimPolicy', 'volumeBindingMode', 'allowVolumeExpansion'),
  };
}

function parseResourceList(value: unknown, storageRequired: boolean): Record<string, string> | null {
  if (value == null) return storageRequired ? null : {};
  if (!isRecord(value) || Object.keys(value).length > maxStorageResourceEntries) return null;
  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const normalized = normalizeQuantity(rawValue);
    if (!validLabelKey(key) || !normalized || !validQuantity(normalized)) return null;
    result[key] = normalized;
  }
  return storageRequired && result.storage == null ? null : result;
}

function parseAccessModes(value: unknown, required: boolean): string[] | null {
  if (value == null) return required ? null : [];
  if (!Array.isArray(value) || value.length > maxStorageAccessModes || required && value.length === 0 ||
    value.some((item) => typeof item !== 'string' || !accessModes.has(item))) return null;
  return new Set(value).size === value.length ? [...value].sort() : null;
}

function validQuantity(value: string) {
  return value.length <= maxQuantityBytes && value.trim() === value && quantityPattern.test(value);
}

function normalizeQuantity(value: unknown) {
  if (typeof value === 'string') return value;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maxSummaryCount ? String(value) : '';
}

function optionalReference(value: unknown) {
  const normalized = optionalString(value);
  return normalized === null || normalized !== '' && !validReferenceName(normalized) ? null : normalized;
}

function optionalString(value: unknown) {
  return value == null ? '' : typeof value === 'string' ? value : null;
}

function requiredString(value: unknown) {
  return typeof value === 'string' && value !== '' ? value : null;
}

function optionalBoolean(value: unknown) {
  return value == null ? undefined : typeof value === 'boolean' ? value : null;
}

function optionalEnum<T extends string>(value: unknown, values: readonly T[]): T | null {
  const normalized = optionalString(value);
  return normalized !== null && values.includes(normalized as T) ? normalized as T : null;
}

function pvcStatusValue(phase: string | null, valid: boolean): ResourceStatus {
  if (!valid) return 'warning';
  if (phase === '') return 'unknown';
  if (phase === 'Bound') return 'healthy';
  return phase === 'Lost' ? 'error' : 'warning';
}

function pvStatusValue(phase: string | null, valid: boolean): ResourceStatus {
  if (!valid) return 'warning';
  if (phase === '') return 'unknown';
  if (phase === 'Bound' || phase === 'Available') return 'healthy';
  return phase === 'Failed' ? 'error' : 'warning';
}

function storageQuantitySummary(resources: Record<string, string>) {
  return resources.storage ?? 'unknown';
}

function accessModeSummary(values: string[]) {
  return values.length === 0 ? 'unknown' : values.join(',');
}

function invalidSummary(...keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, 'invalid'])) as Record<string, SummaryValue>;
}

function validLabelKey(value: string) {
  if (!value || value.length > 317 || value.split('/').length > 2) return false;
  const parts = value.split('/');
  const name = parts[parts.length - 1] || '';
  return validQualifiedName(name) && (parts.length === 1 || validDNSSubdomain(parts[0]));
}

function validQualifiedName(value: string) {
  return value.length > 0 && value.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/.test(value);
}

function validReferenceName(value: string) {
  return value.length <= 253 && validDNSSubdomain(value);
}

function validDNSSubdomain(value: string) {
  return value.length > 0 && value.length <= 253 && value.split('.').every((part) =>
    part.length > 0 && part.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part));
}
