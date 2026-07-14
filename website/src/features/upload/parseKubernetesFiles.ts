import { unzipSync, strFromU8 } from 'fflate';
import { loadAll } from 'js-yaml';
import type { ClusterSummary, EdgeType, ResourceKind, ResourceStatus, SummaryValue, TopologyEdge, TopologyNode, TopologySnapshot } from '../../types/topology';
import { safeAnnotations, sensitiveField } from '../../utils/safeMetadata';

export interface UploadedTopologyState {
  snapshot: TopologySnapshot;
  files: string[];
  warnings: string[];
  loadedAt: number;
}

export interface UploadParseOptions {
  clusterId?: string;
  clusterName?: string;
}

interface KubeObject {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    ownerReferences?: Array<{ kind?: string; name?: string }>;
    creationTimestamp?: string;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  data?: Record<string, unknown>;
  binaryData?: Record<string, unknown>;
  items?: KubeObject[];
}

interface BuildContext {
  clusterId: string;
  nodeSet: Set<string>;
  edgeSet: Set<string>;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  warnings: string[];
}

interface NamespaceRecord {
  name: string;
  labels: Record<string, string>;
}

interface CustomResourceDefinitionRecord {
  name: string;
  group: string;
  kind: string;
  versions: string[];
  scope: string;
}

const supportedKinds = new Set<ResourceKind>([
  'Cluster',
  'Namespace',
  'Node',
  'Deployment',
  'ReplicaSet',
  'StatefulSet',
  'DaemonSet',
  'Job',
  'CronJob',
  'HorizontalPodAutoscaler',
  'Pod',
  'ServiceAccount',
  'Service',
  'EndpointSlice',
  'Ingress',
  'Gateway',
  'HTTPRoute',
  'GRPCRoute',
  'TLSRoute',
  'TCPRoute',
  'NetworkPolicy',
  'ConfigMap',
  'Secret',
  'PersistentVolumeClaim',
  'PersistentVolume',
  'StorageClass',
  'CustomResourceDefinition',
]);

const defaultUploadedCluster = 'uploaded-bundle';
const maxImportedClusters = 100;
const maxImportedNodes = 50_000;
const maxImportedEdges = 100_000;
const importedEdgeTypes = new Set<EdgeType>([
  'owns',
  'selects',
  'service-endpoint',
  'routes-to',
  'mounts',
  'env-from',
  'scheduled-on',
  'binds-storage',
  'uses-service-account',
  'targets-scale',
  'applies-to',
  'attaches-to',
  'allows-ingress',
  'allows-egress',
  'references',
]);
const importedResourceStatuses = new Set<ResourceStatus>(['healthy', 'warning', 'error', 'unknown']);

export async function parseKubernetesFiles(files: File[], options: UploadParseOptions = {}): Promise<UploadedTopologyState> {
  const parsedObjects: KubeObject[] = [];
  const parsedFiles: string[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.zip')) {
      const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
      Object.entries(archive).forEach(([name, content]) => {
        if (!isManifestName(name)) {
          return;
        }
        parsedFiles.push(`${file.name}/${name}`);
        parsedObjects.push(...parseManifestText(strFromU8(content), `${file.name}/${name}`, warnings));
      });
      continue;
    }

    if (!isManifestName(file.name)) {
      warnings.push(`Skipped unsupported file: ${file.name}`);
      continue;
    }
    parsedFiles.push(file.name);
    parsedObjects.push(...parseManifestText(await file.text(), file.name, warnings));
  }

  return {
    snapshot: buildSnapshotFromKubernetesObjects(parsedObjects, warnings, normalizeUploadOptions(options)),
    files: parsedFiles,
    warnings,
    loadedAt: Date.now(),
  };
}

export function importTopologySnapshot(value: unknown): TopologySnapshot {
  if (
    !isSnapshot(value) ||
    value.clusters.length > maxImportedClusters ||
    value.nodes.length > maxImportedNodes ||
    value.edges.length > maxImportedEdges
  ) {
    throw new Error('invalid_topology_json');
  }
  const clusters = value.clusters.map(sanitizeImportedCluster);
  const nodes = value.nodes.map(sanitizeImportedNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = value.edges.map((edge) => sanitizeImportedEdge(edge, nodeIds));
  if (new Set(clusters.map((cluster) => cluster.id)).size !== clusters.length || nodeIds.size !== nodes.length || new Set(edges.map((edge) => edge.id)).size !== edges.length) {
    throw new Error('invalid_topology_json');
  }
  return { clusters, nodes, edges };
}

function sanitizeImportedCluster(value: unknown): ClusterSummary {
  if (!isRecord(value)) {
    throw new Error('invalid_topology_json');
  }
  return {
    id: requiredImportedString(value.id, 160),
    name: requiredImportedString(value.name, 160),
    provider: importedString(value.provider, 160),
    version: importedString(value.version, 80),
    nodeReady: importedCount(value.nodeReady),
    nodeTotal: importedCount(value.nodeTotal),
    podRunning: importedCount(value.podRunning),
    podWarning: importedCount(value.podWarning),
    namespaces: importedCount(value.namespaces),
  };
}

function sanitizeImportedNode(value: unknown): TopologyNode {
  if (!isRecord(value) || !isResourceKind(value.kind) || !isResourceStatus(value.status)) {
    throw new Error('invalid_topology_json');
  }
  const labels = importedStringRecord(value.labels, 200, 160, 512);
  const annotations = safeAnnotations(importedStringRecord(value.annotations, 200, 256, 2_000));
  const kind = value.kind;
  return {
    id: requiredImportedString(value.id, 500),
    clusterId: requiredImportedString(value.clusterId, 160),
    kind,
    namespace: optionalImportedString(value.namespace, 160),
    name: requiredImportedString(value.name, 253),
    status: value.status,
    labels,
    annotations: Object.keys(annotations).length > 0 ? annotations : undefined,
    uid: optionalImportedString(value.uid, 160),
    age: optionalImportedString(value.age, 80),
    owners: importedStringArray(value.owners, 100, 320),
    summary: sanitizeImportedSummary(value.summary, kind),
    x: importedCoordinate(value.x),
    y: importedCoordinate(value.y),
  };
}

function sanitizeImportedEdge(value: unknown, nodeIds: Set<string>): TopologyEdge {
  if (!isRecord(value) || !isEdgeType(value.type) || (value.confidence !== 'observed' && value.confidence !== 'inferred')) {
    throw new Error('invalid_topology_json');
  }
  const source = requiredImportedString(value.source, 500);
  const target = requiredImportedString(value.target, 500);
  if (!nodeIds.has(source) || !nodeIds.has(target)) {
    throw new Error('invalid_topology_json');
  }
  return {
    id: requiredImportedString(value.id, 1_200),
    clusterId: requiredImportedString(value.clusterId, 160),
    source,
    target,
    type: value.type,
    confidence: value.confidence,
    sourceField: importedString(value.sourceField, 500),
  };
}

function sanitizeImportedSummary(value: unknown, kind: ResourceKind): Record<string, SummaryValue> {
  if (!isRecord(value)) {
    return kind === 'Secret' ? { values: 'hidden' } : {};
  }
  if (kind === 'Secret') {
    const summary: Record<string, SummaryValue> = { values: 'hidden' };
    if (typeof value.type === 'string') {
      summary.type = importedString(value.type, 160);
    }
    if (typeof value.keys === 'number') {
      summary.keys = importedCount(value.keys);
    }
    if (typeof value.referenced === 'boolean') {
      summary.referenced = value.referenced;
    }
    return summary;
  }

  const entries: Array<[string, SummaryValue]> = [];
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 100)) {
    const key = importedString(rawKey, 160);
    if (!key || sensitiveField(key) || key.toLowerCase() === 'data' || key.toLowerCase() === 'stringdata') {
      continue;
    }
    const summaryValue = importedSummaryValue(rawValue);
    if (summaryValue !== undefined) {
      entries.push([key, typeof summaryValue === 'string' && sensitiveField(summaryValue) ? 'redacted' : summaryValue]);
    }
  }
  return Object.fromEntries(entries);
}

function importedSummaryValue(value: unknown): SummaryValue | undefined {
  if (typeof value === 'string') {
    return importedString(value, 2_000);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (!Array.isArray(value) || value.length > 100) {
    return undefined;
  }
  if (value.every((item) => typeof item === 'string')) {
    return value.map((item) => importedString(item, 500));
  }
  if (value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    return value;
  }
  if (value.every((item) => typeof item === 'boolean')) {
    return value;
  }
  return undefined;
}

function importedStringRecord(value: unknown, maxEntries: number, maxKeyLength: number, maxValueLength: number) {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, maxEntries)
      .flatMap(([key, entryValue]) => {
        const safeKey = importedString(key, maxKeyLength);
        return safeKey && typeof entryValue === 'string' ? [[safeKey, importedString(entryValue, maxValueLength)]] : [];
      }),
  );
}

function importedStringArray(value: unknown, maxEntries: number, maxLength: number) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.slice(0, maxEntries).flatMap((entry) => typeof entry === 'string' ? [importedString(entry, maxLength)] : []);
}

function requiredImportedString(value: unknown, maxLength: number) {
  const result = importedString(value, maxLength);
  if (!result) {
    throw new Error('invalid_topology_json');
  }
  return result;
}

function optionalImportedString(value: unknown, maxLength: number) {
  const result = importedString(value, maxLength);
  return result || undefined;
}

function importedString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function importedCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function importedCoordinate(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(-100_000, Math.min(100_000, value)) : 0;
}

function isResourceKind(value: unknown): value is ResourceKind {
  return typeof value === 'string' && (value === 'CustomResource' || supportedKinds.has(value as ResourceKind));
}

function isResourceStatus(value: unknown): value is ResourceStatus {
  return typeof value === 'string' && importedResourceStatuses.has(value as ResourceStatus);
}

function isEdgeType(value: unknown): value is EdgeType {
  return typeof value === 'string' && importedEdgeTypes.has(value as EdgeType);
}

function parseManifestText(text: string, filename: string, warnings: string[]) {
  const objects: KubeObject[] = [];
  try {
    if (filename.toLowerCase().endsWith('.json')) {
      collectObject(JSON.parse(text), objects);
      return objects;
    }

    loadAll(text).forEach((document) => collectObject(document, objects));
  } catch (error) {
    const message = error instanceof Error ? error.message : '파싱 실패';
    warnings.push(`${filename}: ${message}`);
  }
  return objects;
}

function buildSnapshotFromKubernetesObjects(objects: KubeObject[], warnings: string[], options: Required<UploadParseOptions>): TopologySnapshot {
  const context: BuildContext = {
    clusterId: options.clusterId,
    nodeSet: new Set(),
    edgeSet: new Set(),
    nodes: [],
    edges: [],
    warnings,
  };
  const validObjects = objects.filter((object) => object.kind && object.metadata?.name);
  const namespaces = new Set<string>();
  const pods = validObjects.filter((object) => object.kind === 'Pod');
  const services = validObjects.filter((object) => object.kind === 'Service');
  const networkPolicies = validObjects.filter((object) => object.kind === 'NetworkPolicy');
  const namespaceObjects = validObjects.filter((object) => object.kind === 'Namespace');
  const customResourceDefinitions = customResourceDefinitionRecords(validObjects);

  validObjects.forEach((object) => {
    const namespace = object.metadata?.namespace || '';
    if (namespace) {
      namespaces.add(namespace);
    }
    if (object.kind === 'Namespace' && object.metadata?.name) {
      namespaces.add(object.metadata.name);
    }
  });

  addNode(context, 'Cluster', '', options.clusterName, 'healthy', { provider: 'upload' }, { objects: validObjects.length, namespaces: namespaces.size });
  namespaces.forEach((namespace) => {
    addNode(context, 'Namespace', '', namespace, 'healthy', {}, { source: 'uploaded' });
    addEdge(context, 'owns', id(context.clusterId, '', 'Cluster', options.clusterName), id(context.clusterId, '', 'Namespace', namespace), 'metadata.namespace', 'observed');
  });

  validObjects.forEach((object) => addObjectNode(context, object, customResourceDefinitions));
  validObjects.forEach((object) => addObjectEdges(context, object, customResourceDefinitions));
  addServiceSelectorEdges(context, services, pods);
  addNetworkPolicyEdges(context, networkPolicies, pods, namespaceRecords(namespaces, namespaceObjects));

  const clusterSummary: ClusterSummary = {
    id: context.clusterId,
    name: options.clusterName,
    provider: 'Upload',
    version: 'yaml',
    nodeReady: context.nodes.filter((node) => node.kind === 'Node' && node.status === 'healthy').length,
    nodeTotal: context.nodes.filter((node) => node.kind === 'Node').length,
    podRunning: context.nodes.filter((node) => node.kind === 'Pod' && node.status === 'healthy').length,
    podWarning: context.nodes.filter((node) => node.kind === 'Pod' && node.status !== 'healthy').length,
    namespaces: namespaces.size,
  };

  return { clusters: [clusterSummary], nodes: context.nodes, edges: context.edges };
}

function addObjectNode(context: BuildContext, object: KubeObject, customResourceDefinitions: CustomResourceDefinitionRecord[]) {
  const { kind, customResourceDefinition } = normalizeObjectKind(object, customResourceDefinitions);
  if (!kind) {
    context.warnings.push(`지원하지 않는 kind: ${object.kind || 'unknown'}`);
    return;
  }
  const name = objectNameForKind(kind, object);
  const namespace = object.metadata?.namespace || '';
  addNode(context, kind, namespace, name, objectStatus(kind, object), labels(object), objectSummary(kind, object, customResourceDefinition));
}

function addObjectEdges(context: BuildContext, object: KubeObject, customResourceDefinitions: CustomResourceDefinitionRecord[]) {
  const { kind, customResourceDefinition } = normalizeObjectKind(object, customResourceDefinitions);
  const name = kind ? objectNameForKind(kind, object) : '';
  const namespace = object.metadata?.namespace || '';
  if (!kind || !name) {
    return;
  }

  const objectId = id(context.clusterId, namespace, kind, name);
  object.metadata?.ownerReferences?.forEach((owner) => {
    const ownerKind = normalizeKind(owner.kind);
    if (ownerKind && owner.name) {
      addEdge(context, 'owns', id(context.clusterId, namespace, ownerKind, owner.name), objectId, 'metadata.ownerReferences', 'observed');
    }
  });

  if (namespace) {
    addEdge(context, 'owns', id(context.clusterId, '', 'Namespace', namespace), objectId, 'metadata.namespace', 'observed');
  }

  if (kind === 'CustomResource' && customResourceDefinition) {
    addEdge(context, 'owns', id(context.clusterId, '', 'CustomResourceDefinition', customResourceDefinition.name), objectId, 'CustomResourceDefinition.spec.names.kind', 'observed');
    addCustomResourceReferenceEdges(context, object, objectId, customResourceDefinition, customResourceDefinitions);
    return;
  }

  if (kind === 'Pod') {
    addPodEdges(context, object, objectId, namespace);
  }
  if (kind === 'Ingress') {
    ingressBackends(object).forEach((serviceName) => {
      ensureReferenceNode(context, 'Service', namespace, serviceName);
      addEdge(context, 'routes-to', objectId, id(context.clusterId, namespace, 'Service', serviceName), 'Ingress.spec.rules.http.paths.backend.service', 'observed');
    });
  }
  if (isGatewayRouteKind(kind)) {
    gatewayRouteParentGateways(object, namespace).forEach((gatewayRef) => {
      ensureReferenceNode(context, 'Gateway', gatewayRef.namespace, gatewayRef.name);
      addEdge(context, 'attaches-to', objectId, id(context.clusterId, gatewayRef.namespace, 'Gateway', gatewayRef.name), `${kind}.spec.parentRefs`, 'observed');
    });
    gatewayRouteBackendServices(object, namespace).forEach((serviceRef) => {
      ensureReferenceNode(context, 'Service', serviceRef.namespace, serviceRef.name);
      addEdge(context, 'routes-to', objectId, id(context.clusterId, serviceRef.namespace, 'Service', serviceRef.name), `${kind}.spec.rules.backendRefs`, 'observed');
    });
  }
  if (kind === 'HorizontalPodAutoscaler') {
    const targetKind = normalizeKind(stringAt(object, ['spec', 'scaleTargetRef', 'kind']));
    const targetName = stringAt(object, ['spec', 'scaleTargetRef', 'name']);
    if (targetKind && targetName) {
      ensureReferenceNode(context, targetKind, namespace, targetName);
      addEdge(context, 'targets-scale', objectId, id(context.clusterId, namespace, targetKind, targetName), 'HorizontalPodAutoscaler.spec.scaleTargetRef', 'observed');
    }
  }
  if (kind === 'PersistentVolumeClaim') {
    const volumeName = stringAt(object, ['spec', 'volumeName']);
    const storageClassName = stringAt(object, ['spec', 'storageClassName']);
    if (volumeName) {
      ensureReferenceNode(context, 'PersistentVolume', '', volumeName);
      addEdge(context, 'binds-storage', objectId, id(context.clusterId, '', 'PersistentVolume', volumeName), 'PersistentVolumeClaim.spec.volumeName', 'observed');
    }
    if (storageClassName) {
      ensureReferenceNode(context, 'StorageClass', '', storageClassName);
      addEdge(context, 'binds-storage', objectId, id(context.clusterId, '', 'StorageClass', storageClassName), 'PersistentVolumeClaim.spec.storageClassName', 'observed');
    }
  }
  if (kind === 'PersistentVolume') {
    const storageClassName = stringAt(object, ['spec', 'storageClassName']);
    if (storageClassName) {
      ensureReferenceNode(context, 'StorageClass', '', storageClassName);
      addEdge(context, 'binds-storage', objectId, id(context.clusterId, '', 'StorageClass', storageClassName), 'PersistentVolume.spec.storageClassName', 'observed');
    }
  }
}

function addPodEdges(context: BuildContext, pod: KubeObject, podId: string, namespace: string) {
  const nodeName = stringAt(pod, ['spec', 'nodeName']);
  const serviceAccountName = stringAt(pod, ['spec', 'serviceAccountName']);
  if (nodeName) {
    ensureReferenceNode(context, 'Node', '', nodeName);
    addEdge(context, 'scheduled-on', podId, id(context.clusterId, '', 'Node', nodeName), 'Pod.spec.nodeName', 'observed');
  }
  if (serviceAccountName) {
    ensureReferenceNode(context, 'ServiceAccount', namespace, serviceAccountName);
    addEdge(context, 'uses-service-account', podId, id(context.clusterId, namespace, 'ServiceAccount', serviceAccountName), 'Pod.spec.serviceAccountName', 'observed');
  }

  forEachContainer(pod, (container) => {
    asArray(container.envFrom).forEach((entry) => {
      const configMapName = stringAt(entry, ['configMapRef', 'name']);
      const secretName = stringAt(entry, ['secretRef', 'name']);
      if (configMapName) {
        ensureReferenceNode(context, 'ConfigMap', namespace, configMapName);
        addEdge(context, 'env-from', podId, id(context.clusterId, namespace, 'ConfigMap', configMapName), 'Pod.spec.containers.envFrom.configMapRef', 'observed');
      }
      if (secretName) {
        ensureReferenceNode(context, 'Secret', namespace, secretName);
        addEdge(context, 'env-from', podId, id(context.clusterId, namespace, 'Secret', secretName), 'Pod.spec.containers.envFrom.secretRef', 'observed');
      }
    });
    asArray(container.env).forEach((entry) => {
      const configMapName = stringAt(entry, ['valueFrom', 'configMapKeyRef', 'name']);
      const secretName = stringAt(entry, ['valueFrom', 'secretKeyRef', 'name']);
      if (configMapName) {
        ensureReferenceNode(context, 'ConfigMap', namespace, configMapName);
        addEdge(context, 'env-from', podId, id(context.clusterId, namespace, 'ConfigMap', configMapName), 'Pod.spec.containers.env.valueFrom.configMapKeyRef', 'observed');
      }
      if (secretName) {
        ensureReferenceNode(context, 'Secret', namespace, secretName);
        addEdge(context, 'env-from', podId, id(context.clusterId, namespace, 'Secret', secretName), 'Pod.spec.containers.env.valueFrom.secretKeyRef', 'observed');
      }
    });
  });

  asArray(readAt(pod, ['spec', 'volumes'])).forEach((volume) => {
    const configMapName = stringAt(volume, ['configMap', 'name']);
    const secretName = stringAt(volume, ['secret', 'secretName']);
    const claimName = stringAt(volume, ['persistentVolumeClaim', 'claimName']);
    if (configMapName) {
      ensureReferenceNode(context, 'ConfigMap', namespace, configMapName);
      addEdge(context, 'mounts', podId, id(context.clusterId, namespace, 'ConfigMap', configMapName), 'Pod.spec.volumes.configMap', 'observed');
    }
    if (secretName) {
      ensureReferenceNode(context, 'Secret', namespace, secretName);
      addEdge(context, 'mounts', podId, id(context.clusterId, namespace, 'Secret', secretName), 'Pod.spec.volumes.secret', 'observed');
    }
    if (claimName) {
      ensureReferenceNode(context, 'PersistentVolumeClaim', namespace, claimName);
      addEdge(context, 'binds-storage', podId, id(context.clusterId, namespace, 'PersistentVolumeClaim', claimName), 'Pod.spec.volumes.persistentVolumeClaim', 'observed');
    }
  });
}

function addServiceSelectorEdges(context: BuildContext, services: KubeObject[], pods: KubeObject[]) {
  services.forEach((service) => {
    const namespace = service.metadata?.namespace || '';
    const serviceName = service.metadata?.name || '';
    const selector = readAt(service, ['spec', 'selector']);
    if (!isRecord(selector) || Object.keys(selector).length === 0) {
      return;
    }

    pods
      .filter((pod) => (pod.metadata?.namespace || '') === namespace && labelsMatch(labels(pod), selector as Record<string, string>))
      .forEach((pod) => {
        addEdge(context, 'service-endpoint', id(context.clusterId, namespace, 'Service', serviceName), id(context.clusterId, namespace, 'Pod', pod.metadata?.name || ''), 'Service.spec.selector', 'inferred');
      });
  });
}

function addNetworkPolicyEdges(context: BuildContext, networkPolicies: KubeObject[], pods: KubeObject[], namespaces: NamespaceRecord[]) {
  networkPolicies.forEach((networkPolicy) => {
    const namespace = networkPolicy.metadata?.namespace || '';
    const name = networkPolicy.metadata?.name || '';
    const networkPolicyId = id(context.clusterId, namespace, 'NetworkPolicy', name);
    const podSelector = readAt(networkPolicy, ['spec', 'podSelector']);
    const matchingPods = pods.filter((pod) => (pod.metadata?.namespace || '') === namespace && labelSelectorMatches(podSelector, labels(pod)));

    if (matchingPods.length === 0) {
      const namespaceId = id(context.clusterId, '', 'Namespace', namespace);
      addEdge(context, 'applies-to', networkPolicyId, namespaceId, 'NetworkPolicy.spec.podSelector', 'observed');
    } else {
      matchingPods.forEach((pod) => {
        addEdge(context, 'applies-to', networkPolicyId, id(context.clusterId, namespace, 'Pod', pod.metadata?.name || ''), 'NetworkPolicy.spec.podSelector', 'inferred');
      });
    }

    const policyTypes = networkPolicyTypes(networkPolicy);
    if (policyTypes.includes('Ingress')) {
      asArray(readAt(networkPolicy, ['spec', 'ingress'])).forEach((rule) => {
        addNetworkPolicyPeerEdges(context, networkPolicyId, namespace, rule, 'from', 'allows-ingress', 'NetworkPolicy.spec.ingress.from', pods, namespaces);
      });
    }
    if (policyTypes.includes('Egress')) {
      asArray(readAt(networkPolicy, ['spec', 'egress'])).forEach((rule) => {
        addNetworkPolicyPeerEdges(context, networkPolicyId, namespace, rule, 'to', 'allows-egress', 'NetworkPolicy.spec.egress.to', pods, namespaces);
      });
    }
  });
}

function addNetworkPolicyPeerEdges(
  context: BuildContext,
  networkPolicyId: string,
  policyNamespace: string,
  rule: Record<string, unknown>,
  peerKey: 'from' | 'to',
  edgeType: Extract<EdgeType, 'allows-ingress' | 'allows-egress'>,
  sourceField: string,
  pods: KubeObject[],
  namespaces: NamespaceRecord[],
) {
  asArray(rule[peerKey]).forEach((peer) => {
    if (isRecord(peer.ipBlock)) {
      return;
    }

    const podSelector = peer.podSelector;
    const namespaceSelector = peer.namespaceSelector;
    if (!isRecord(podSelector) && !isRecord(namespaceSelector)) {
      return;
    }

    const matchingNamespaces = matchingNetworkPolicyNamespaces(namespaces, policyNamespace, namespaceSelector);
    if (isRecord(podSelector)) {
      pods
        .filter((pod) => matchingNamespaces.has(pod.metadata?.namespace || '') && labelSelectorMatches(podSelector, labels(pod)))
        .forEach((pod) => {
          addEdge(context, edgeType, networkPolicyId, id(context.clusterId, pod.metadata?.namespace || '', 'Pod', pod.metadata?.name || ''), sourceField, 'inferred');
        });
      return;
    }

    matchingNamespaces.forEach((namespace) => {
      addEdge(context, edgeType, networkPolicyId, id(context.clusterId, '', 'Namespace', namespace), sourceField, 'inferred');
    });
  });
}

function addCustomResourceReferenceEdges(context: BuildContext, object: KubeObject, objectId: string, customResourceDefinition: CustomResourceDefinitionRecord, customResourceDefinitions: CustomResourceDefinitionRecord[]) {
  const namespace = object.metadata?.namespace || '';
  const references = customResourceReferences(readAt(object, ['spec']), namespace, customResourceDefinition, customResourceDefinitions);
  references.forEach((reference) => {
    const targetId = id(context.clusterId, reference.namespace, reference.kind, reference.name);
    if (context.nodeSet.has(targetId)) {
      addEdge(context, 'references', objectId, targetId, reference.sourceField, 'inferred');
    }
  });
}

interface CustomResourceReference {
  kind: ResourceKind;
  namespace: string;
  name: string;
  sourceField: string;
}

function customResourceReferences(spec: unknown, defaultNamespace: string, sourceDefinition: CustomResourceDefinitionRecord, customResourceDefinitions: CustomResourceDefinitionRecord[]) {
  const references: CustomResourceReference[] = [];
  collectCustomResourceReferences(spec, 'spec', defaultNamespace, sourceDefinition, customResourceDefinitions, references);
  return references;
}

function collectCustomResourceReferences(
  value: unknown,
  path: string,
  defaultNamespace: string,
  sourceDefinition: CustomResourceDefinitionRecord,
  customResourceDefinitions: CustomResourceDefinitionRecord[],
  references: CustomResourceReference[],
) {
  if (references.length >= 80 || value == null) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectCustomResourceReferences(item, `${path}[${index}]`, defaultNamespace, sourceDefinition, customResourceDefinitions, references));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  Object.entries(value).forEach(([key, child]) => {
    const childPath = `${path}.${key}`;
    const referenceKind = customResourceReferenceKindFromKey(key);
    if (isRecord(child) && isReferenceFieldName(key)) {
      const reference = customResourceReferenceFromObject(child, referenceKind, childPath, defaultNamespace, sourceDefinition, customResourceDefinitions);
      if (reference) {
        references.push(reference);
      }
    }
    if (Array.isArray(child) && isReferenceFieldName(key)) {
      child.forEach((item, index) => {
        if (isRecord(item)) {
          const reference = customResourceReferenceFromObject(item, referenceKind, `${childPath}[${index}]`, defaultNamespace, sourceDefinition, customResourceDefinitions);
          if (reference) {
            references.push(reference);
          }
        }
      });
    }
    const nameKind = customResourceReferenceKindFromNameKey(key);
    if (nameKind && typeof child === 'string' && child.trim()) {
      references.push({
        kind: nameKind,
        namespace: targetNamespaceForKind(nameKind, stringAt(value, ['namespace']) || defaultNamespace, sourceDefinition),
        name: child.trim(),
        sourceField: childPath,
      });
    }
    collectCustomResourceReferences(child, childPath, defaultNamespace, sourceDefinition, customResourceDefinitions, references);
  });
}

function customResourceReferenceFromObject(
  value: Record<string, unknown>,
  fallbackKind: ResourceKind | undefined,
  sourceField: string,
  defaultNamespace: string,
  sourceDefinition: CustomResourceDefinitionRecord,
  customResourceDefinitions: CustomResourceDefinitionRecord[],
): CustomResourceReference | undefined {
  const name = stringAt(value, ['name']);
  if (!name) {
    return undefined;
  }
  const apiVersion = stringAt(value, ['apiVersion']);
  const kindName = stringAt(value, ['kind']);
  const customDefinition = kindName && apiVersion ? customResourceDefinitionForReference(apiVersion, kindName, customResourceDefinitions) : undefined;
  const nativeKind = normalizeKind(kindName);
  const kind = customDefinition ? 'CustomResource' : nativeKind || fallbackKind;
  if (!kind) {
    return undefined;
  }
  const namespace = targetNamespaceForKind(kind, stringAt(value, ['namespace']) || defaultNamespace, customDefinition || sourceDefinition);
  return {
    kind,
    namespace,
    name: kind === 'CustomResource' ? `${kindName || customDefinition?.kind || 'CustomResource'}:${name}` : name,
    sourceField,
  };
}

function isReferenceFieldName(key: string) {
  return /(Ref|Refs|Reference|References)$/.test(key);
}

function customResourceReferenceKindFromKey(key: string): ResourceKind | undefined {
  const normalized = key.toLowerCase();
  if (normalized === 'secretref' || normalized === 'secretrefs') return 'Secret';
  if (normalized === 'configmapref' || normalized === 'configmaprefs') return 'ConfigMap';
  if (normalized === 'serviceaccountref' || normalized === 'serviceaccountrefs') return 'ServiceAccount';
  if (normalized === 'serviceref' || normalized === 'servicerefs' || normalized === 'backendref' || normalized === 'backendrefs') return 'Service';
  return undefined;
}

function customResourceReferenceKindFromNameKey(key: string): ResourceKind | undefined {
  const normalized = key.toLowerCase();
  if (normalized === 'secretname') return 'Secret';
  if (normalized === 'configmapname') return 'ConfigMap';
  if (normalized === 'serviceaccountname') return 'ServiceAccount';
  if (normalized === 'servicename') return 'Service';
  return undefined;
}

function customResourceDefinitionForReference(apiVersion: string, kind: string, definitions: CustomResourceDefinitionRecord[]) {
  const { group, version } = apiVersionParts(apiVersion);
  if (!group || !version) {
    return undefined;
  }
  return definitions.find((definition) => definition.group === group && definition.kind === kind && definition.versions.includes(version));
}

function targetNamespaceForKind(kind: ResourceKind, namespace: string, customResourceDefinition?: CustomResourceDefinitionRecord) {
  if (kind === 'CustomResource' && customResourceDefinition?.scope === 'Cluster') {
    return '';
  }
  if (clusterScopedKinds.has(kind)) {
    return '';
  }
  return namespace;
}

const clusterScopedKinds = new Set<ResourceKind>(['Cluster', 'Namespace', 'Node', 'PersistentVolume', 'StorageClass', 'CustomResourceDefinition']);

function addNode(context: BuildContext, kind: ResourceKind, namespace: string, name: string, status: ResourceStatus, labels: Record<string, string>, summary: Record<string, SummaryValue>) {
  const nodeId = id(context.clusterId, namespace, kind, name);
  if (!name || context.nodeSet.has(nodeId)) {
    return nodeId;
  }
  context.nodes.push({ id: nodeId, clusterId: context.clusterId, kind, namespace: namespace || undefined, name, status, labels, summary, x: 0, y: 0 });
  context.nodeSet.add(nodeId);
  return nodeId;
}

function ensureReferenceNode(context: BuildContext, kind: ResourceKind, namespace: string, name: string) {
  const summary: Record<string, SummaryValue> = { referenced: true };
  if (kind === 'Secret') {
    summary.values = 'hidden';
  }
  return addNode(context, kind, namespace, name, 'unknown', {}, summary);
}

function addEdge(context: BuildContext, type: EdgeType, source: string, target: string, sourceField: string, confidence: TopologyEdge['confidence']) {
  if (!source || !target || !context.nodeSet.has(source) || !context.nodeSet.has(target)) {
    return;
  }
  const edgeId = `${source}->${target}:${type}:${sourceField}`;
  if (context.edgeSet.has(edgeId)) {
    return;
  }
  context.edges.push({ id: edgeId, clusterId: context.clusterId, source, target, type, confidence, sourceField });
  context.edgeSet.add(edgeId);
}

function objectSummary(kind: ResourceKind, object: KubeObject, customResourceDefinition?: CustomResourceDefinitionRecord): Record<string, SummaryValue> {
  if (kind === 'Secret') {
    return { type: stringAt(object, ['type']) || 'Opaque', keys: Object.keys(object.data || {}).length, values: 'hidden' };
  }
  if (kind === 'ConfigMap') {
    return { keys: Object.keys(object.data || {}).length + Object.keys(object.binaryData || {}).length };
  }
  if (kind === 'Deployment' || kind === 'ReplicaSet' || kind === 'StatefulSet') {
    const desired = numberAt(object, ['spec', 'replicas']) ?? 1;
    const ready = numberAt(object, ['status', 'readyReplicas']) ?? numberAt(object, ['status', 'availableReplicas']) ?? 0;
    return { replicas: `${ready}/${desired}`, selector: selectorSummary(readAt(object, ['spec', 'selector', 'matchLabels'])) };
  }
  if (kind === 'DaemonSet') {
    return { ready: `${numberAt(object, ['status', 'numberReady']) ?? 0}/${numberAt(object, ['status', 'desiredNumberScheduled']) ?? 0}` };
  }
  if (kind === 'Job') {
    return {
      completions: numberAt(object, ['spec', 'completions']) ?? 1,
      succeeded: numberAt(object, ['status', 'succeeded']) ?? 0,
      failed: numberAt(object, ['status', 'failed']) ?? 0,
    };
  }
  if (kind === 'CronJob') {
    return {
      schedule: stringAt(object, ['spec', 'schedule']) || '-',
      suspend: boolAt(object, ['spec', 'suspend']) ?? false,
      active: asArray(readAt(object, ['status', 'active'])).length,
    };
  }
  if (kind === 'HorizontalPodAutoscaler') {
    return {
      target: `${stringAt(object, ['spec', 'scaleTargetRef', 'kind']) || '-'}/${stringAt(object, ['spec', 'scaleTargetRef', 'name']) || '-'}`,
      replicas: `${numberAt(object, ['status', 'currentReplicas']) ?? 0}/${numberAt(object, ['status', 'desiredReplicas']) ?? 0}`,
      range: `${numberAt(object, ['spec', 'minReplicas']) ?? 1}-${numberAt(object, ['spec', 'maxReplicas']) ?? 0}`,
    };
  }
  if (kind === 'NetworkPolicy') {
    const policyTypes = networkPolicyTypes(object);
    const intent = networkPolicyIntentSummary(object, policyTypes);
    return {
      policyTypes: policyTypes.join(','),
      selector: selectorSummaryOrAll(readAt(object, ['spec', 'podSelector'])),
      ingress: intent.ingress,
      egress: intent.egress,
      ports: intent.ports,
    };
  }
  if (kind === 'Pod') {
    const containers = containerNames(readAt(object, ['spec', 'containers']));
    const initContainers = containerNames(readAt(object, ['spec', 'initContainers']));
    return { phase: stringAt(object, ['status', 'phase']) || 'Pending', node: stringAt(object, ['spec', 'nodeName']) || '-', containers: containers.length, containerNames: containers, initContainers };
  }
  if (kind === 'Service') {
    return { type: stringAt(object, ['spec', 'type']) || 'ClusterIP', ports: asArray(readAt(object, ['spec', 'ports'])).length };
  }
  if (kind === 'Ingress') {
    return { rules: asArray(readAt(object, ['spec', 'rules'])).length, tls: asArray(readAt(object, ['spec', 'tls'])).length > 0 };
  }
  if (kind === 'Gateway') {
    return {
      class: stringAt(object, ['spec', 'gatewayClassName']) || '-',
      listeners: asArray(readAt(object, ['spec', 'listeners'])).length,
      hosts: gatewayHosts(object).join(',') || '-',
    };
  }
  if (isGatewayRouteKind(kind)) {
    return {
      ...(kind !== 'TCPRoute' ? { hosts: asStringArray(readAt(object, ['spec', 'hostnames'])).join(',') || '-' } : {}),
      rules: asArray(readAt(object, ['spec', 'rules'])).length,
      backends: gatewayRouteBackendServices(object, object.metadata?.namespace || '').length,
      ...(kind === 'GRPCRoute' ? { methods: grpcRouteMethods(object).join(',') || '-' } : {}),
    };
  }
  if (kind === 'PersistentVolumeClaim') {
    return { storage: stringAt(object, ['spec', 'resources', 'requests', 'storage']) || '-', storageClass: stringAt(object, ['spec', 'storageClassName']) || '-' };
  }
  if (kind === 'PersistentVolume') {
    return { storage: stringAt(object, ['spec', 'capacity', 'storage']) || '-', storageClass: stringAt(object, ['spec', 'storageClassName']) || '-' };
  }
  if (kind === 'StorageClass') {
    return { provisioner: stringAt(object, ['provisioner']) || stringAt(object, ['spec', 'provisioner']) || '-' };
  }
  if (kind === 'CustomResourceDefinition') {
    return {
      group: stringAt(object, ['spec', 'group']) || '-',
      kind: stringAt(object, ['spec', 'names', 'kind']) || '-',
      plural: stringAt(object, ['spec', 'names', 'plural']) || '-',
      scope: stringAt(object, ['spec', 'scope']) || '-',
      servedVersions: crdServedVersions(object).join(',') || '-',
      storageVersion: crdStorageVersion(object) || '-',
    };
  }
  if (kind === 'CustomResource') {
    const apiVersion = object.apiVersion || (customResourceDefinition ? `${customResourceDefinition.group}/${customResourceDefinition.versions[0] || '-'}` : '-');
    const apiParts = apiVersionParts(apiVersion);
    return {
      apiVersion,
      kind: object.kind || customResourceDefinition?.kind || '-',
      name: object.metadata?.name || '-',
      crd: customResourceDefinition?.name || '-',
      group: customResourceDefinition?.group || apiParts.group || '-',
      scope: customResourceDefinition?.scope || '-',
      version: apiParts.version || customResourceDefinition?.versions[0] || '-',
      specFields: fieldCount(object.spec),
      statusFields: fieldCount(object.status),
      conditions: customResourceConditionSummary(object) || '-',
    };
  }
  return { source: 'uploaded' };
}

function objectStatus(kind: ResourceKind, object: KubeObject): ResourceStatus {
  if (kind === 'Secret') {
    return 'unknown';
  }
  if (kind === 'CustomResourceDefinition') {
    return crdEstablished(object) ? 'healthy' : 'unknown';
  }
  if (kind === 'CustomResource') {
    return customResourceStatus(object);
  }
  if (kind === 'Pod') {
    const phase = stringAt(object, ['status', 'phase']);
    return phase === 'Running' || phase === 'Succeeded' ? 'healthy' : phase ? 'warning' : 'unknown';
  }
  if (kind === 'Job') {
    if ((numberAt(object, ['status', 'failed']) ?? 0) > 0) {
      return 'error';
    }
    const completions = numberAt(object, ['spec', 'completions']) ?? 1;
    const succeeded = numberAt(object, ['status', 'succeeded']) ?? 0;
    return succeeded >= completions ? 'healthy' : 'warning';
  }
  if (kind === 'HorizontalPodAutoscaler') {
    const desired = numberAt(object, ['status', 'desiredReplicas']) ?? 0;
    const current = numberAt(object, ['status', 'currentReplicas']) ?? 0;
    return desired === 0 || current >= desired ? 'healthy' : 'warning';
  }
  if (kind === 'PersistentVolumeClaim') {
    const phase = stringAt(object, ['status', 'phase']);
    return !phase || phase === 'Bound' ? 'healthy' : 'warning';
  }
  return 'healthy';
}

function ingressBackends(object: KubeObject) {
  const services = new Set<string>();
  asArray(readAt(object, ['spec', 'rules'])).forEach((rule) => {
    asArray(readAt(rule, ['http', 'paths'])).forEach((path) => {
      const serviceName = stringAt(path, ['backend', 'service', 'name']);
      if (serviceName) {
        services.add(serviceName);
      }
    });
  });
  const defaultBackend = stringAt(object, ['spec', 'defaultBackend', 'service', 'name']);
  if (defaultBackend) {
    services.add(defaultBackend);
  }
  return Array.from(services);
}

function gatewayRouteParentGateways(object: KubeObject, namespace: string) {
  return asArray(readAt(object, ['spec', 'parentRefs']))
    .filter((parentRef) => {
      const kind = stringAt(parentRef, ['kind']);
      const group = stringAt(parentRef, ['group']);
      return (!kind || kind === 'Gateway') && (!group || group === 'gateway.networking.k8s.io');
    })
    .map((parentRef) => ({
      name: stringAt(parentRef, ['name']),
      namespace: stringAt(parentRef, ['namespace']) || namespace,
    }))
    .filter((parentRef) => parentRef.name);
}

function gatewayRouteBackendServices(object: KubeObject, namespace: string) {
  const services: Array<{ name: string; namespace: string }> = [];
  asArray(readAt(object, ['spec', 'rules'])).forEach((rule) => {
    asArray(readAt(rule, ['backendRefs'])).forEach((backendRef) => {
      const kind = stringAt(backendRef, ['kind']);
      const group = stringAt(backendRef, ['group']);
      const name = stringAt(backendRef, ['name']);
      if (name && (!kind || kind === 'Service') && !group) {
        services.push({ name, namespace: stringAt(backendRef, ['namespace']) || namespace });
      }
    });
  });
  return uniqueRefs(services);
}

function grpcRouteMethods(object: KubeObject) {
  return uniqueStrings(
    asArray(readAt(object, ['spec', 'rules'])).flatMap((rule) =>
      asArray(rule.matches).map((match) => {
        const service = stringAt(match, ['method', 'service']);
        const method = stringAt(match, ['method', 'method']);
        return service && method ? `${service}/${method}` : service || method;
      }),
    ),
  );
}

function containerNames(value: unknown) {
  return asArray(value)
    .map((container) => stringAt(container, ['name']))
    .filter(Boolean)
    .sort();
}

function isGatewayRouteKind(kind: ResourceKind) {
  return kind === 'HTTPRoute' || kind === 'GRPCRoute' || kind === 'TLSRoute' || kind === 'TCPRoute';
}

function crdServedVersions(object: KubeObject) {
  return asArray(readAt(object, ['spec', 'versions']))
    .filter((version) => isRecord(version) && version.served === true && typeof version.name === 'string')
    .map((version) => String((version as Record<string, unknown>).name))
    .sort();
}

function crdStorageVersion(object: KubeObject) {
  const version = asArray(readAt(object, ['spec', 'versions']))
    .filter(isRecord)
    .find((candidate) => candidate.storage === true && typeof candidate.name === 'string');
  return version ? String(version.name) : '';
}

function crdEstablished(object: KubeObject) {
  return asArray(readAt(object, ['status', 'conditions'])).some((condition) => isRecord(condition) && condition.type === 'Established' && condition.status === 'True');
}

function customResourceDefinitionRecords(objects: KubeObject[]): CustomResourceDefinitionRecord[] {
  return objects
    .filter((object) => object.kind === 'CustomResourceDefinition')
    .map((object) => {
      const storageVersion = crdStorageVersion(object);
      const servedVersions = crdServedVersions(object);
      const versions = servedVersions.length > 0 ? servedVersions : storageVersion ? [storageVersion] : [];
      return {
        name: object.metadata?.name || '',
        group: stringAt(object, ['spec', 'group']),
        kind: stringAt(object, ['spec', 'names', 'kind']),
        versions,
        scope: stringAt(object, ['spec', 'scope']) || '-',
      };
    })
    .filter((definition) => definition.name && definition.group && definition.kind && definition.versions.length > 0);
}

function customResourceDefinitionForObject(object: KubeObject, definitions: CustomResourceDefinitionRecord[]) {
  if (!object.kind || !object.apiVersion) {
    return undefined;
  }
  const { group, version } = apiVersionParts(object.apiVersion);
  if (!group || !version) {
    return undefined;
  }
  return definitions.find((definition) => definition.group === group && definition.kind === object.kind && definition.versions.includes(version));
}

function customResourceDisplayName(object: KubeObject) {
  const kind = object.kind || 'CustomResource';
  return `${kind}:${object.metadata?.name || ''}`;
}

function customResourceStatus(object: KubeObject): ResourceStatus {
  const conditions = customResourceConditions(object);
  if (conditions.length === 0) {
    return 'unknown';
  }
  const readinessConditions = conditions.filter((condition) => condition.type === 'Ready' || condition.type === 'Synced' || condition.type === 'Reconciled');
  if (readinessConditions.some((condition) => condition.status === 'True')) {
    return 'healthy';
  }
  if (readinessConditions.some((condition) => condition.status === 'False')) {
    return 'warning';
  }
  return 'unknown';
}

function customResourceConditionSummary(object: KubeObject) {
  return customResourceConditions(object)
    .map((condition) => `${condition.type}=${condition.status || '-'}`)
    .sort()
    .join(', ');
}

function customResourceConditions(object: KubeObject) {
  return asArray(readAt(object, ['status', 'conditions']))
    .filter(isRecord)
    .map((condition) => ({
      type: stringAt(condition, ['type']),
      status: stringAt(condition, ['status']),
    }))
    .filter((condition) => condition.type);
}

function apiVersionParts(apiVersion: string) {
  const parts = apiVersion.split('/');
  if (parts.length === 1) {
    return { group: '', version: parts[0] || '' };
  }
  return { group: parts.slice(0, -1).join('/'), version: parts[parts.length - 1] || '' };
}

function fieldCount(value: unknown) {
  return isRecord(value) ? Object.keys(value).length : 0;
}

function gatewayHosts(object: KubeObject) {
  return uniqueStrings(
    asArray(readAt(object, ['spec', 'listeners']))
      .map((listener) => stringAt(listener, ['hostname']))
      .filter(Boolean),
  );
}

function forEachContainer(object: KubeObject, callback: (container: Record<string, unknown>) => void) {
  [...asArray(readAt(object, ['spec', 'containers'])), ...asArray(readAt(object, ['spec', 'initContainers']))].forEach((container) => {
    if (isRecord(container)) {
      callback(container);
    }
  });
}

function collectObject(value: unknown, target: KubeObject[]) {
  if (!isRecord(value)) {
    return;
  }
  const object = value as KubeObject;
  if (object.kind === 'List' && Array.isArray(object.items)) {
    object.items.forEach((item) => collectObject(item, target));
    return;
  }
  if (object.kind && object.metadata?.name) {
    target.push(object);
  }
}

function normalizeKind(kind: unknown): ResourceKind | undefined {
  return typeof kind === 'string' && supportedKinds.has(kind as ResourceKind) ? (kind as ResourceKind) : undefined;
}

function normalizeObjectKind(object: KubeObject, customResourceDefinitions: CustomResourceDefinitionRecord[]): { kind?: ResourceKind; customResourceDefinition?: CustomResourceDefinitionRecord } {
  const knownKind = normalizeKind(object.kind);
  if (knownKind) {
    return { kind: knownKind };
  }
  const customResourceDefinition = customResourceDefinitionForObject(object, customResourceDefinitions);
  if (customResourceDefinition) {
    return { kind: 'CustomResource', customResourceDefinition };
  }
  return {};
}

function objectNameForKind(kind: ResourceKind, object: KubeObject) {
  return kind === 'CustomResource' ? customResourceDisplayName(object) : object.metadata?.name || '';
}

function id(clusterId: string, namespace: string, kind: ResourceKind, name: string) {
  return namespace ? `${clusterId}:${namespace}:${kind}:${name}` : `${clusterId}:${kind}:${name}`;
}

function isManifestName(name: string) {
  return /\.(ya?ml|json)$/i.test(name);
}

function labels(object: KubeObject) {
  return object.metadata?.labels || {};
}

function labelsMatch(labels: Record<string, string>, selector: Record<string, string>) {
  return Object.entries(selector).every(([key, value]) => labels[key] === value);
}

function selectorMatchesLabels(selector: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(selector).every(([key, value]) => labels[key] === value);
}

function labelSelectorMatches(selector: unknown, labels: Record<string, string>) {
  if (!isRecord(selector)) {
    return true;
  }
  if (!selectorMatchesLabels(selectorMatchLabels(selector), labels)) {
    return false;
  }
  return asArray(readAt(selector, ['matchExpressions'])).every((expression) => labelSelectorExpressionMatches(expression, labels));
}

function labelSelectorExpressionMatches(expression: unknown, labels: Record<string, string>) {
  if (!isRecord(expression)) {
    return false;
  }
  const key = typeof expression.key === 'string' ? expression.key : '';
  const operator = typeof expression.operator === 'string' ? expression.operator : '';
  const values = asStringArray(expression.values);
  if (!key) {
    return false;
  }
  switch (operator) {
    case 'In':
      return values.length > 0 && values.includes(labels[key]);
    case 'NotIn':
      return values.length > 0 && !values.includes(labels[key]);
    case 'Exists':
      return values.length === 0 && Object.prototype.hasOwnProperty.call(labels, key);
    case 'DoesNotExist':
      return values.length === 0 && !Object.prototype.hasOwnProperty.call(labels, key);
    default:
      return false;
  }
}

function selectorSummary(value: unknown) {
  return isRecord(value) ? Object.keys(value).join(',') || '-' : '-';
}

function selectorSummaryOrAll(value: unknown, emptyLabel = 'all pods') {
  const matchLabels = selectorMatchLabels(value);
  const keys = Object.keys(matchLabels);
  const expressions = asArray(readAt(value, ['matchExpressions'])).length;
  if (keys.length === 0 && expressions === 0) {
    return emptyLabel;
  }
  return [...keys, expressions > 0 ? `${expressions} expressions` : ''].filter(Boolean).join(',');
}

function namespaceRecords(namespaces: Set<string>, namespaceObjects: KubeObject[]): NamespaceRecord[] {
  const labelsByNamespace = new Map(namespaceObjects.map((namespace) => [namespace.metadata?.name || '', labels(namespace)]));
  return Array.from(namespaces)
    .sort()
    .map((name) => ({ name, labels: labelsByNamespace.get(name) || {} }));
}

function selectorMatchLabels(selector: unknown) {
  const matchLabels = readAt(selector, ['matchLabels']);
  return isRecord(matchLabels) ? stringRecord(matchLabels) : {};
}

function selectorHasExpressions(selector: unknown) {
  return asArray(readAt(selector, ['matchExpressions'])).length > 0;
}

function matchingNetworkPolicyNamespaces(namespaces: NamespaceRecord[], policyNamespace: string, namespaceSelector: unknown) {
  if (!isRecord(namespaceSelector)) {
    return new Set([policyNamespace]);
  }
  return new Set(namespaces.filter((namespace) => labelSelectorMatches(namespaceSelector, namespace.labels)).map((namespace) => namespace.name));
}

function networkPolicyTypes(object: KubeObject) {
  const explicit = asStringArray(readAt(object, ['spec', 'policyTypes']));
  if (explicit.length > 0) {
    return uniqueStrings(explicit);
  }

  const types = ['Ingress'];
  if (asArray(readAt(object, ['spec', 'egress'])).length > 0) {
    types.push('Egress');
  }
  return types;
}

function networkPolicyIntentSummary(object: KubeObject, policyTypes: string[]) {
  const ingressRules = asArray(readAt(object, ['spec', 'ingress']));
  const egressRules = asArray(readAt(object, ['spec', 'egress']));
  const ports = uniqueStrings([...rulePortSummaries(ingressRules), ...rulePortSummaries(egressRules)]);

  return {
    ingress: networkPolicyDirectionSummary(policyTypes.includes('Ingress'), ingressRules, 'from'),
    egress: networkPolicyDirectionSummary(policyTypes.includes('Egress'), egressRules, 'to'),
    ports: limitSummary(ports, 4) || '-',
  };
}

function networkPolicyDirectionSummary(isIsolated: boolean, rules: Record<string, unknown>[], peerKey: 'from' | 'to') {
  if (!isIsolated) {
    return 'not isolated';
  }
  if (rules.length === 0) {
    return 'deny all';
  }

  const peerValues = uniqueStrings(rules.flatMap((rule) => peerSummaries(asArray(rule[peerKey]))));
  const portValues = uniqueStrings(rulePortSummaries(rules));
  const peers = limitSummary(peerValues, 3) || 'all peers';
  const ports = limitSummary(portValues, 3) || 'all ports';
  return `${rules.length} rule${rules.length === 1 ? '' : 's'}: ${peers}; ${ports}`;
}

function peerSummaries(peers: Record<string, unknown>[]) {
  if (peers.length === 0) {
    return ['all peers'];
  }
  return peers.map((peer) => {
    const parts: string[] = [];
    const namespaceSelector = peer.namespaceSelector;
    const podSelector = peer.podSelector;
    const ipBlock = peer.ipBlock;
    if (isRecord(namespaceSelector)) {
      parts.push(`ns:${selectorSummaryOrAll(namespaceSelector, 'all namespaces')}`);
    }
    if (isRecord(podSelector)) {
      parts.push(`pod:${selectorSummaryOrAll(podSelector)}`);
    }
    if (isRecord(ipBlock)) {
      parts.push(`ip:${stringAt(ipBlock, ['cidr']) || 'cidr'}`);
    }
    return parts.join('+') || 'all peers';
  });
}

function rulePortSummaries(rules: Record<string, unknown>[]) {
  return rules.flatMap((rule) => {
    const ports = asArray(rule.ports);
    if (ports.length === 0) {
      return [];
    }
    return ports.map((port) => {
      const protocol = stringAt(port, ['protocol']) || 'TCP';
      const value = readAt(port, ['port']);
      const endPort = readAt(port, ['endPort']);
      const portValue = typeof value === 'number' || typeof value === 'string' ? String(value) : '*';
      const suffix = typeof endPort === 'number' ? `-${endPort}` : '';
      return `${protocol}:${portValue}${suffix}`;
    });
  });
}

function limitSummary(values: string[], limit: number) {
  if (values.length <= limit) {
    return values.join(', ');
  }
  return `${values.slice(0, limit).join(', ')} +${values.length - limit}`;
}

function stringRecord(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function isSnapshot(value: unknown): value is TopologySnapshot {
  return isRecord(value) && Array.isArray(value.clusters) && Array.isArray(value.nodes) && Array.isArray(value.edges);
}

function readAt(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);
}

function stringAt(value: unknown, path: string[]) {
  const result = readAt(value, path);
  return typeof result === 'string' ? result : '';
}

function numberAt(value: unknown, path: string[]) {
  const result = readAt(value, path);
  return typeof result === 'number' ? result : undefined;
}

function boolAt(value: unknown, path: string[]) {
  const result = readAt(value, path);
  return typeof result === 'boolean' ? result : undefined;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value.filter(isRecord) as Record<string, unknown>[]) : [];
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function uniqueRefs(values: Array<{ name: string; namespace: string }>) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.namespace}/${value.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function normalizeUploadOptions(options: UploadParseOptions): Required<UploadParseOptions> {
  const clusterName = options.clusterName?.trim() || defaultUploadedCluster;
  return {
    clusterName,
    clusterId: normalizeClusterId(options.clusterId || clusterName),
  };
}

function normalizeClusterId(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || defaultUploadedCluster;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
