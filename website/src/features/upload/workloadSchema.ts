import type { EdgeType, ResourceKind, ResourceStatus, SummaryValue } from '../../types/topology';
import { isRecord, readAt, type KubeObject } from './kubernetesObject.ts';

const maxContainers = 64;
const maxContainerEntries = 128;
const maxImageBytes = 512;
const maxSummaryImages = 8;
const maxSummaryCount = 1_000_000_000;
const maxScheduleBytes = 128;

const workloadKinds = ['Deployment', 'ReplicaSet', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'] as const;
type WorkloadKind = (typeof workloadKinds)[number];
type WorkloadReferenceKind = 'ServiceAccount' | 'Secret' | 'ConfigMap' | 'PersistentVolumeClaim';

export interface UploadWorkloadReference {
  kind: WorkloadReferenceKind;
  name: string;
  edgeType: Extract<EdgeType, 'uses-service-account' | 'env-from' | 'mounts'>;
  sourceField: string;
}

interface ParsedTemplate {
  containers: number;
  initContainers: number;
  images: string[];
  references: UploadWorkloadReference[];
}

export function isUploadWorkloadKind(kind: ResourceKind): kind is WorkloadKind {
  return (workloadKinds as readonly string[]).includes(kind);
}

export function uploadWorkloadTemplateIsValid(kind: WorkloadKind, object: KubeObject) {
  return parseTemplate(kind, object) !== null;
}

export function uploadWorkloadReferences(kind: WorkloadKind, object: KubeObject) {
  return parseTemplate(kind, object)?.references ?? [];
}

export function uploadWorkloadSummary(kind: WorkloadKind, object: KubeObject): Record<string, SummaryValue> {
  const template = parseTemplate(kind, object);
  const templateSummary: Record<string, SummaryValue> = template
    ? {
        containers: template.containers,
        initContainers: template.initContainers,
        imageCount: template.images.length,
        images: template.images.slice(0, maxSummaryImages),
      }
    : { containers: 'invalid', initContainers: 'invalid', imageCount: 'invalid', images: [] };

  if (kind === 'Deployment' || kind === 'ReplicaSet' || kind === 'StatefulSet') {
    const desired = countAt(object, ['spec', 'replicas'], 1);
    const ready = countAt(object, ['status', 'readyReplicas'], 0);
    const available = countAt(object, ['status', 'availableReplicas'], 0);
    return {
      replicas: desired === null || ready === null ? 'invalid' : `${ready}/${desired}`,
      ...(kind === 'Deployment' ? { availableReplicas: available ?? 'invalid' } : {}),
      ...templateSummary,
    };
  }
  if (kind === 'DaemonSet') {
    const counts = parseDaemonCounts(object);
    return { ready: counts ? `${counts.ready}/${counts.desired}` : 'invalid', ...templateSummary };
  }
  if (kind === 'Job') {
    const completions = countAt(object, ['spec', 'completions'], 1);
    const succeeded = countAt(object, ['status', 'succeeded'], 0);
    const failed = countAt(object, ['status', 'failed'], 0);
    const active = countAt(object, ['status', 'active'], 0);
    return {
      completions: completions ?? 'invalid',
      succeeded: succeeded ?? 'invalid',
      failed: failed ?? 'invalid',
      active: active ?? 'invalid',
      ...templateSummary,
    };
  }

  const schedule = optionalStringAt(object, ['spec', 'schedule']);
  const suspend = optionalBooleanAt(object, ['spec', 'suspend']);
  const active = objectArrayAt(object, ['status', 'active'], maxContainerEntries);
  return {
    schedule: schedule !== null && validSchedule(schedule) ? schedule : 'invalid',
    suspend: suspend === null ? 'invalid' : suspend ?? false,
    active: active === null || !active.every(validObjectReference) ? 'invalid' : active.length,
    ...templateSummary,
  };
}

export function uploadWorkloadStatus(kind: WorkloadKind, object: KubeObject): ResourceStatus {
  if (!uploadWorkloadTemplateIsValid(kind, object)) {
    return 'warning';
  }
  if (kind === 'Deployment' || kind === 'ReplicaSet' || kind === 'StatefulSet') {
    const desired = countAt(object, ['spec', 'replicas'], 1);
    const ready = countAt(object, ['status', 'readyReplicas'], 0);
    const available = countAt(object, ['status', 'availableReplicas'], 0);
    if (desired === null || ready === null || available === null) {
      return 'warning';
    }
    return (kind === 'Deployment' ? available : ready) >= desired ? 'healthy' : 'warning';
  }
  if (kind === 'DaemonSet') {
    const counts = parseDaemonCounts(object);
    return counts && counts.ready >= counts.desired ? 'healthy' : 'warning';
  }
  if (kind === 'Job') {
    const completions = countAt(object, ['spec', 'completions'], 1);
    const succeeded = countAt(object, ['status', 'succeeded'], 0);
    const failed = countAt(object, ['status', 'failed'], 0);
    const active = countAt(object, ['status', 'active'], 0);
    if (completions === null || succeeded === null || failed === null || active === null) {
      return 'warning';
    }
    if (failed > 0) {
      return 'error';
    }
    return succeeded >= completions ? 'healthy' : 'warning';
  }

  const schedule = optionalStringAt(object, ['spec', 'schedule']);
  const suspend = optionalBooleanAt(object, ['spec', 'suspend']);
  const active = objectArrayAt(object, ['status', 'active'], maxContainerEntries);
  return schedule !== null && validSchedule(schedule) && suspend !== null && active !== null && active.every(validObjectReference) ? 'healthy' : 'warning';
}

function parseTemplate(kind: WorkloadKind, object: KubeObject): ParsedTemplate | null {
  const path = workloadPodSpecPath(kind);
  const sourcePrefix = `${kind}.${path.join('.')}`;
  const podSpec = readAt(object, path);
  if (!isRecord(podSpec)) {
    return null;
  }
  const containers = recordArray(podSpec.containers, maxContainers);
  const initContainers = recordArray(podSpec.initContainers, maxContainers);
  const imagePullSecrets = recordArray(podSpec.imagePullSecrets, maxContainerEntries);
  const volumes = recordArray(podSpec.volumes, maxContainerEntries);
  if (!containers || containers.length === 0 || !initContainers || containers.length + initContainers.length > maxContainers || !imagePullSecrets || !volumes) {
    return null;
  }

  const references: UploadWorkloadReference[] = [];
  const seenReferences = new Set<string>();
  const addReference = (kindValue: WorkloadReferenceKind, name: unknown, edgeType: UploadWorkloadReference['edgeType'], sourceField: string) => {
    if (typeof name !== 'string' || !validReferenceName(name)) {
      return false;
    }
    const key = `${kindValue}\u0000${name}\u0000${edgeType}\u0000${sourceField}`;
    if (!seenReferences.has(key)) {
      seenReferences.add(key);
      references.push({ kind: kindValue, name, edgeType, sourceField });
    }
    return references.length <= maxContainerEntries;
  };

  if (podSpec.serviceAccountName != null) {
    if (typeof podSpec.serviceAccountName !== 'string' || (podSpec.serviceAccountName !== '' && !addReference('ServiceAccount', podSpec.serviceAccountName, 'uses-service-account', `${sourcePrefix}.serviceAccountName`))) {
      return null;
    }
  }
  for (const reference of imagePullSecrets) {
    if (!addReference('Secret', reference.name, 'env-from', `${sourcePrefix}.imagePullSecrets`)) {
      return null;
    }
  }
  for (const volume of volumes) {
    const candidates: Array<[WorkloadReferenceKind, unknown, UploadWorkloadReference['edgeType'], string]> = [];
    if (volume.configMap != null) candidates.push(['ConfigMap', isRecord(volume.configMap) ? volume.configMap.name : undefined, 'mounts', `${sourcePrefix}.volumes.configMap`]);
    if (volume.secret != null) candidates.push(['Secret', isRecord(volume.secret) ? volume.secret.secretName : undefined, 'mounts', `${sourcePrefix}.volumes.secret`]);
    if (volume.persistentVolumeClaim != null) candidates.push(['PersistentVolumeClaim', isRecord(volume.persistentVolumeClaim) ? volume.persistentVolumeClaim.claimName : undefined, 'mounts', `${sourcePrefix}.volumes.persistentVolumeClaim`]);
    if (candidates.length > 1 || candidates.some(([referenceKind, name, edgeType, field]) => !addReference(referenceKind, name, edgeType, field))) {
      return null;
    }
  }

  const images: string[] = [];
  const seenImages = new Set<string>();
  const seenContainerNames = new Set<string>();
  for (const container of [...initContainers, ...containers]) {
    if (typeof container.name !== 'string' || !validDNSLabel(container.name) || seenContainerNames.has(container.name) || (container.image != null && (typeof container.image !== 'string' || !validUploadContainerImage(container.image)))) {
      return null;
    }
    seenContainerNames.add(container.name);
    if (typeof container.image === 'string' && container.image && !seenImages.has(container.image)) {
      seenImages.add(container.image);
      images.push(container.image);
    }
    if (!collectContainerReferences(container, sourcePrefix, addReference)) {
      return null;
    }
  }

  return { containers: containers.length, initContainers: initContainers.length, images: images.sort(), references };
}

function collectContainerReferences(
  container: Record<string, unknown>,
  sourcePrefix: string,
  addReference: (kind: WorkloadReferenceKind, name: unknown, edgeType: UploadWorkloadReference['edgeType'], sourceField: string) => boolean,
) {
  const envFrom = recordArray(container.envFrom, maxContainerEntries);
  const env = recordArray(container.env, maxContainerEntries);
  if (!envFrom || !env) {
    return false;
  }
  for (const entry of envFrom) {
    const candidates: Array<[WorkloadReferenceKind, unknown, string]> = [];
    if (entry.configMapRef != null) candidates.push(['ConfigMap', isRecord(entry.configMapRef) ? entry.configMapRef.name : undefined, `${sourcePrefix}.containers.envFrom.configMapRef`]);
    if (entry.secretRef != null) candidates.push(['Secret', isRecord(entry.secretRef) ? entry.secretRef.name : undefined, `${sourcePrefix}.containers.envFrom.secretRef`]);
    if (candidates.length !== 1 || candidates.some(([kind, name, field]) => !addReference(kind, name, 'env-from', field))) {
      return false;
    }
  }
  for (const entry of env) {
    if (entry.valueFrom == null) continue;
    if (!isRecord(entry.valueFrom)) return false;
    const candidates: Array<[WorkloadReferenceKind, unknown, string]> = [];
    if (entry.valueFrom.configMapKeyRef != null) candidates.push(['ConfigMap', isRecord(entry.valueFrom.configMapKeyRef) ? entry.valueFrom.configMapKeyRef.name : undefined, `${sourcePrefix}.containers.env.valueFrom.configMapKeyRef`]);
    if (entry.valueFrom.secretKeyRef != null) candidates.push(['Secret', isRecord(entry.valueFrom.secretKeyRef) ? entry.valueFrom.secretKeyRef.name : undefined, `${sourcePrefix}.containers.env.valueFrom.secretKeyRef`]);
    if (!validLocalEnvSources(entry.valueFrom, candidates.length) || candidates.some(([kind, name, field]) => !addReference(kind, name, 'env-from', field))) {
      return false;
    }
  }
  return true;
}

function validLocalEnvSources(valueFrom: Record<string, unknown>, referenceSources: number) {
  const localValues = [valueFrom.fieldRef, valueFrom.resourceFieldRef].filter((value) => value != null);
  return referenceSources + localValues.length === 1 && localValues.every(isRecord);
}

function workloadPodSpecPath(kind: WorkloadKind) {
  return kind === 'CronJob' ? ['spec', 'jobTemplate', 'spec', 'template', 'spec'] : ['spec', 'template', 'spec'];
}

function countAt(object: KubeObject, path: string[], fallback: number): number | null {
  const value = readAt(object, path);
  if (value == null) return fallback;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maxSummaryCount ? value : null;
}

function parseDaemonCounts(object: KubeObject) {
  const desired = countAt(object, ['status', 'desiredNumberScheduled'], 0);
  const ready = countAt(object, ['status', 'numberReady'], 0);
  return desired !== null && ready !== null && ready <= desired ? { desired, ready } : null;
}

function optionalStringAt(object: KubeObject, path: string[]) {
  const value = readAt(object, path);
  return typeof value === 'string' ? value : null;
}

function optionalBooleanAt(object: KubeObject, path: string[]) {
  const value = readAt(object, path);
  return value == null ? undefined : typeof value === 'boolean' ? value : null;
}

function objectArrayAt(object: KubeObject, path: string[], limit: number) {
  const value = readAt(object, path);
  return recordArray(value, limit);
}

function recordArray(value: unknown, limit: number): Record<string, unknown>[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > limit || value.some((item) => !isRecord(item))) return null;
  return value as Record<string, unknown>[];
}

function validObjectReference(value: Record<string, unknown>) {
  return (value.kind == null || typeof value.kind === 'string' && /^[A-Za-z][A-Za-z0-9]{0,62}$/.test(value.kind)) &&
    (value.namespace == null || typeof value.namespace === 'string' && validDNSLabel(value.namespace)) &&
    typeof value.name === 'string' && validReferenceName(value.name);
}

function validReferenceName(value: string) {
  return value.length <= 253 && value.split('.').every(validDNSLabel);
}

function validDNSLabel(value: string) {
  return value.length > 0 && value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

export function validUploadContainerImage(value: string) {
  if (!value || value.length > maxImageBytes || value.trim() !== value || value.includes('://') || /[=?#\\]/.test(value)) {
    return false;
  }
  const parts = value.split('@');
  if (parts.length > 2 || parts.length === 2 && !/^[a-z0-9]+(?:[+._-][a-z0-9]+)*:[A-Fa-f0-9]{32,128}$/.test(parts[1])) {
    return false;
  }
  const name = parts[0];
  return /^[A-Za-z0-9](?:[A-Za-z0-9._:/-]{0,510}[A-Za-z0-9])?$/.test(name) && !name.includes('//') && !name.includes('..');
}

function validSchedule(value: string) {
  return value.length > 0 && value.length <= maxScheduleBytes && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value) && !/(?:token|password|secret|credential)\s*[:=]/i.test(value);
}
