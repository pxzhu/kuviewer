import { unzipSync, strFromU8 } from 'fflate';
import { loadAll } from 'js-yaml';
import type { ClusterSummary, EdgeType, ResourceKind, ResourceStatus, TopologyEdge, TopologyNode, TopologySnapshot } from '../../types/topology';

export interface UploadedTopologyState {
  snapshot: TopologySnapshot;
  files: string[];
  warnings: string[];
  loadedAt: number;
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
  'NetworkPolicy',
  'ConfigMap',
  'Secret',
  'PersistentVolumeClaim',
  'PersistentVolume',
  'StorageClass',
]);

export async function parseKubernetesFiles(files: File[]): Promise<UploadedTopologyState> {
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
    snapshot: buildSnapshotFromKubernetesObjects(parsedObjects, warnings),
    files: parsedFiles,
    warnings,
    loadedAt: Date.now(),
  };
}

export function importTopologySnapshot(value: unknown): TopologySnapshot {
  if (!isSnapshot(value)) {
    throw new Error('invalid_topology_json');
  }
  return value;
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

function buildSnapshotFromKubernetesObjects(objects: KubeObject[], warnings: string[]): TopologySnapshot {
  const context: BuildContext = {
    clusterId: 'uploaded-bundle',
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

  validObjects.forEach((object) => {
    const namespace = object.metadata?.namespace || '';
    if (namespace) {
      namespaces.add(namespace);
    }
    if (object.kind === 'Namespace' && object.metadata?.name) {
      namespaces.add(object.metadata.name);
    }
  });

  addNode(context, 'Cluster', '', 'uploaded-bundle', 'healthy', { provider: 'upload' }, { objects: validObjects.length, namespaces: namespaces.size });
  namespaces.forEach((namespace) => {
    addNode(context, 'Namespace', '', namespace, 'healthy', {}, { source: 'uploaded' });
    addEdge(context, 'owns', id(context.clusterId, '', 'Cluster', 'uploaded-bundle'), id(context.clusterId, '', 'Namespace', namespace), 'metadata.namespace', 'observed');
  });

  validObjects.forEach((object) => addObjectNode(context, object));
  validObjects.forEach((object) => addObjectEdges(context, object));
  addServiceSelectorEdges(context, services, pods);
  addNetworkPolicyEdges(context, networkPolicies, pods, namespaceRecords(namespaces, namespaceObjects));

  const clusterSummary: ClusterSummary = {
    id: context.clusterId,
    name: 'uploaded-bundle',
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

function addObjectNode(context: BuildContext, object: KubeObject) {
  const kind = normalizeKind(object.kind);
  if (!kind) {
    context.warnings.push(`지원하지 않는 kind: ${object.kind || 'unknown'}`);
    return;
  }
  const name = object.metadata?.name || '';
  const namespace = object.metadata?.namespace || '';
  addNode(context, kind, namespace, name, objectStatus(kind, object), labels(object), objectSummary(kind, object));
}

function addObjectEdges(context: BuildContext, object: KubeObject) {
  const kind = normalizeKind(object.kind);
  const name = object.metadata?.name || '';
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

  if (kind === 'Pod') {
    addPodEdges(context, object, objectId, namespace);
  }
  if (kind === 'Ingress') {
    ingressBackends(object).forEach((serviceName) => {
      ensureReferenceNode(context, 'Service', namespace, serviceName);
      addEdge(context, 'routes-to', objectId, id(context.clusterId, namespace, 'Service', serviceName), 'Ingress.spec.rules.http.paths.backend.service', 'observed');
    });
  }
  if (kind === 'HTTPRoute') {
    httpRouteParentGateways(object, namespace).forEach((gatewayRef) => {
      ensureReferenceNode(context, 'Gateway', gatewayRef.namespace, gatewayRef.name);
      addEdge(context, 'attaches-to', objectId, id(context.clusterId, gatewayRef.namespace, 'Gateway', gatewayRef.name), 'HTTPRoute.spec.parentRefs', 'observed');
    });
    httpRouteBackendServices(object, namespace).forEach((serviceRef) => {
      ensureReferenceNode(context, 'Service', serviceRef.namespace, serviceRef.name);
      addEdge(context, 'routes-to', objectId, id(context.clusterId, serviceRef.namespace, 'Service', serviceRef.name), 'HTTPRoute.spec.rules.backendRefs', 'observed');
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
    const matchingPods = selectorHasExpressions(podSelector)
      ? []
      : pods.filter((pod) => (pod.metadata?.namespace || '') === namespace && selectorMatchesLabels(selectorMatchLabels(podSelector), labels(pod)));

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
    if (selectorHasExpressions(podSelector) || selectorHasExpressions(namespaceSelector)) {
      return;
    }

    const matchingNamespaces = matchingNetworkPolicyNamespaces(namespaces, policyNamespace, namespaceSelector);
    if (isRecord(podSelector)) {
      pods
        .filter((pod) => matchingNamespaces.has(pod.metadata?.namespace || '') && selectorMatchesLabels(selectorMatchLabels(podSelector), labels(pod)))
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

function addNode(context: BuildContext, kind: ResourceKind, namespace: string, name: string, status: ResourceStatus, labels: Record<string, string>, summary: Record<string, string | number | boolean>) {
  const nodeId = id(context.clusterId, namespace, kind, name);
  if (!name || context.nodeSet.has(nodeId)) {
    return nodeId;
  }
  context.nodes.push({ id: nodeId, clusterId: context.clusterId, kind, namespace: namespace || undefined, name, status, labels, summary, x: 0, y: 0 });
  context.nodeSet.add(nodeId);
  return nodeId;
}

function ensureReferenceNode(context: BuildContext, kind: ResourceKind, namespace: string, name: string) {
  const summary: Record<string, string | number | boolean> = { referenced: true };
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

function objectSummary(kind: ResourceKind, object: KubeObject): Record<string, string | number | boolean> {
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
    return { phase: stringAt(object, ['status', 'phase']) || 'Pending', node: stringAt(object, ['spec', 'nodeName']) || '-', containers: asArray(readAt(object, ['spec', 'containers'])).length };
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
  if (kind === 'HTTPRoute') {
    return {
      hosts: asStringArray(readAt(object, ['spec', 'hostnames'])).join(',') || '-',
      rules: asArray(readAt(object, ['spec', 'rules'])).length,
      backends: httpRouteBackendServices(object, object.metadata?.namespace || '').length,
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
  return { source: 'uploaded' };
}

function objectStatus(kind: ResourceKind, object: KubeObject): ResourceStatus {
  if (kind === 'Secret') {
    return 'unknown';
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

function httpRouteParentGateways(object: KubeObject, namespace: string) {
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

function httpRouteBackendServices(object: KubeObject, namespace: string) {
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
  const matchLabels = selectorMatchLabels(namespaceSelector);
  return new Set(namespaces.filter((namespace) => selectorMatchesLabels(matchLabels, namespace.labels)).map((namespace) => namespace.name));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
