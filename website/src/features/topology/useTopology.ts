import { useCallback, useEffect, useMemo, useState } from 'react';
import { mockTopology } from '../../data/mockTopology';
import { fetchTopologySnapshot, getTopologyApiBaseUrl } from '../../services/topologyApi';
import type { ResourceKind, ResourceStatus, TopologyEdge, TopologyNode, TopologySnapshot } from '../../types/topology';

export type ColorMode = 'status' | 'cluster' | 'namespace' | 'kind' | 'node';
export type TopologySourceMode = 'upload' | 'live' | 'mock';

export interface TopologyFilters {
  query: string;
  cluster: string;
  namespace: string;
  node: string;
  kind: string;
  status: string;
}

const liveLockedTopology: TopologySnapshot = {
  clusters: [
    {
      id: 'live-locked',
      name: '실시간 클러스터 잠김',
      provider: 'Kubernetes',
      version: '-',
      nodeReady: 0,
      nodeTotal: 0,
      podRunning: 0,
      podWarning: 0,
      namespaces: 0,
    },
  ],
  nodes: [],
  edges: [],
};

const uploadPendingTopology: TopologySnapshot = {
  clusters: [
    {
      id: 'upload-pending',
      name: 'YAML 또는 ZIP 업로드',
      provider: '업로드',
      version: 'manifest',
      nodeReady: 0,
      nodeTotal: 0,
      podRunning: 0,
      podWarning: 0,
      namespaces: 0,
    },
  ],
  nodes: [],
  edges: [],
};

const refreshIntervalMs = 30_000;

export function useTopology(
  filters: TopologyFilters,
  sourceMode: TopologySourceMode,
  uploadedSnapshot: TopologySnapshot | null,
  liveEnabled: boolean,
) {
  const apiBaseUrl = getTopologyApiBaseUrl();
  const liveFetchEnabled = sourceMode === 'live' && liveEnabled && Boolean(apiBaseUrl);
  const [snapshot, setSnapshot] = useState<TopologySnapshot>(() => sourceSnapshot(sourceMode, uploadedSnapshot, liveEnabled, apiBaseUrl));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(() => (sourceMode === 'live' ? null : Date.now()));
  const [refreshTick, setRefreshTick] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const refresh = useCallback(() => {
    setRefreshTick((currentTick) => currentTick + 1);
  }, []);

  useEffect(() => {
    if (sourceMode === 'mock') {
      setSnapshot(mockTopology);
      setLoading(false);
      setError('');
      setLastUpdatedAt(Date.now());
      return;
    }

    if (sourceMode === 'upload') {
      setSnapshot(uploadedSnapshot || uploadPendingTopology);
      setLoading(false);
      setError('');
      setLastUpdatedAt(uploadedSnapshot ? Date.now() : null);
      return;
    }

    if (!liveEnabled) {
      setSnapshot(liveLockedTopology);
      setLoading(false);
      setError('');
      setLastUpdatedAt(null);
      return;
    }

    if (!apiBaseUrl) {
      setSnapshot(liveLockedTopology);
      setLoading(false);
      setError('api_base_url_not_configured');
      setLastUpdatedAt(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError('');

    fetchTopologySnapshot(controller.signal)
      .then((nextSnapshot) => {
        setSnapshot(nextSnapshot);
        setLastUpdatedAt(Date.now());
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setSnapshot(liveLockedTopology);
        setError(requestError instanceof Error ? requestError.message : 'topology_request_failed');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [apiBaseUrl, liveEnabled, refreshTick, sourceMode, uploadedSnapshot]);

  useEffect(() => {
    if (!liveFetchEnabled && autoRefresh) {
      setAutoRefresh(false);
    }
  }, [autoRefresh, liveFetchEnabled]);

  useEffect(() => {
    if (!liveFetchEnabled || !autoRefresh) {
      return;
    }

    const intervalId = window.setInterval(refresh, refreshIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [autoRefresh, liveFetchEnabled, refresh]);

  return useMemo(() => {
    const query = filters.query.trim().toLowerCase();

    const nodes = snapshot.nodes.filter((node) => {
      const matchesQuery =
        query.length === 0 ||
        node.name.toLowerCase().includes(query) ||
        node.kind.toLowerCase().includes(query) ||
        node.clusterId.toLowerCase().includes(query) ||
        node.namespace?.toLowerCase().includes(query) ||
        searchableRecord(node.labels).includes(query) ||
        searchableRecord(node.summary).includes(query);
      const matchesCluster = filters.cluster === 'all' || node.clusterId === filters.cluster;
      const matchesNamespace = matchesNamespaceFilter(node, filters.namespace);
      const matchesNode = matchesNodeFilter(node, filters.node);
      const matchesKind = filters.kind === 'all' || node.kind === filters.kind;
      const matchesStatus = filters.status === 'all' || node.status === filters.status;

      return matchesQuery && matchesCluster && matchesNamespace && matchesNode && matchesKind && matchesStatus;
    });

    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = snapshot.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

    return {
      snapshot,
      nodes,
      edges,
      clusters: snapshot.clusters,
      namespaces: unique(snapshot.nodes.map((node) => node.namespace).filter(Boolean) as string[]),
      nodeNames: unique(snapshot.nodes.filter((node) => node.kind === 'Node').map((node) => node.name)),
      kinds: unique(snapshot.nodes.map((node) => node.kind)),
      statuses: unique(snapshot.nodes.map((node) => node.status)),
      loading,
      error,
      lastUpdatedAt,
      refresh,
      autoRefresh,
      setAutoRefresh,
      refreshIntervalMs,
      source: sourceMode === 'live' ? 'api' : sourceMode,
    };
  }, [autoRefresh, error, filters.cluster, filters.kind, filters.namespace, filters.node, filters.query, filters.status, lastUpdatedAt, loading, refresh, snapshot, sourceMode]);
}

function sourceSnapshot(sourceMode: TopologySourceMode, uploadedSnapshot: TopologySnapshot | null, liveEnabled: boolean, apiBaseUrl: string) {
  if (sourceMode === 'mock') {
    return mockTopology;
  }

  if (sourceMode === 'upload') {
    return uploadedSnapshot || uploadPendingTopology;
  }

  return liveEnabled && apiBaseUrl ? liveLockedTopology : liveLockedTopology;
}

function matchesNamespaceFilter(node: TopologyNode, namespace: string) {
  if (namespace === 'all') {
    return true;
  }

  if (node.kind === 'Namespace') {
    return node.name === namespace;
  }

  if (!node.namespace) {
    return node.kind === 'Cluster' || node.kind === 'Node';
  }

  return node.namespace === namespace;
}

function matchesNodeFilter(node: TopologyNode, nodeName: string) {
  if (nodeName === 'all') {
    return true;
  }

  if (node.kind === 'Cluster' || node.kind === 'Namespace') {
    return true;
  }

  if (node.kind === 'Node') {
    return node.name === nodeName;
  }

  return String(node.summary.node || '') === nodeName;
}

export function getNodeColor(node: TopologyNode, colorMode: ColorMode) {
  if (colorMode === 'cluster') {
    return clusterColors[node.clusterId] || colorFromString(node.clusterId);
  }

  if (colorMode === 'namespace') {
    return namespaceColors[node.namespace || 'cluster'] || colorFromString(node.namespace || node.clusterId);
  }

  if (colorMode === 'kind') {
    return kindColors[node.kind] || colorFromString(node.kind);
  }

  if (colorMode === 'node') {
    const nodeName = String(node.summary.node || node.name);
    return nodeColors[nodeName] || colorFromString(nodeName);
  }

  return statusColors[node.status];
}

const stablePalette = ['#007aff', '#34c759', '#ff9500', '#ff2d55', '#5856d6', '#af52de', '#64d2ff', '#30d158'];

const clusterColors: Record<string, string> = {
  'local-native': '#007aff',
  'aks-prod': '#5856d6',
  colima: '#34c759',
};

export function getEdgeColor(edge: TopologyEdge) {
  return edgeColors[edge.type] || '#94a3b8';
}

function unique<T extends ResourceKind | ResourceStatus | string>(values: T[]) {
  return Array.from(new Set(values)).sort();
}

const statusColors: Record<ResourceStatus, string> = {
  healthy: '#34c759',
  warning: '#ff9500',
  error: '#ff3b30',
  unknown: '#8e8e93',
};

const namespaceColors: Record<string, string> = {
  cluster: '#8e8e93',
  platform: '#007aff',
  checkout: '#5856d6',
};

const kindColors: Partial<Record<ResourceKind, string>> = {
  Cluster: '#8e8e93',
  Namespace: '#007aff',
  Node: '#34c759',
  Deployment: '#0a84ff',
  StatefulSet: '#5856d6',
  Job: '#ff9f0a',
  CronJob: '#bf5af2',
  HorizontalPodAutoscaler: '#64d2ff',
  Pod: '#30d158',
  ServiceAccount: '#636366',
  Service: '#ff9500',
  Ingress: '#ff2d55',
  Gateway: '#ff375f',
  HTTPRoute: '#ff9f0a',
  GRPCRoute: '#ffcc00',
  TLSRoute: '#ff6b22',
  TCPRoute: '#bf5af2',
  NetworkPolicy: '#00c7be',
  ConfigMap: '#bf5af2',
  Secret: '#ff3b30',
  PersistentVolumeClaim: '#5e5ce6',
  PersistentVolume: '#5e5ce6',
  StorageClass: '#64d2ff',
  CustomResourceDefinition: '#ffcc00',
};

const nodeColors: Record<string, string> = {
  'worker-a': '#007aff',
  'worker-b': '#34c759',
  'worker-c': '#ff9500',
  'aks-node-a': '#5856d6',
  'aks-node-b': '#af52de',
};

const edgeColors: Record<string, string> = {
  owns: '#8e8e93',
  selects: '#007aff',
  'service-endpoint': '#007aff',
  'routes-to': '#ff2d55',
  mounts: '#5e5ce6',
  'env-from': '#bf5af2',
  'scheduled-on': '#34c759',
  'binds-storage': '#5856d6',
  'uses-service-account': '#636366',
  'targets-scale': '#64d2ff',
  'applies-to': '#00c7be',
  'attaches-to': '#ff9f0a',
  'allows-ingress': '#00c7be',
  'allows-egress': '#5ac8fa',
};

function colorFromString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return stablePalette[hash % stablePalette.length];
}

function searchableRecord(value: Record<string, unknown>) {
  return Object.entries(value)
    .map(([key, recordValue]) => `${key}:${String(recordValue)}`)
    .join(' ')
    .toLowerCase();
}
