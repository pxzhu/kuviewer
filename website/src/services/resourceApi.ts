import { getStoredAdminToken } from '../features/auth/adminToken';
import type { ResourceEvents, ResourceExplorerItem, ResourceExplorerList } from '../types/resourceExplorer';
import type { TopologySnapshot } from '../types/topology';
import { getTopologyApiBaseUrl } from './topologyApi';

export async function fetchResources(signal?: AbortSignal): Promise<ResourceExplorerList> {
  const baseUrl = getTopologyApiBaseUrl().replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('api_base_url_not_configured');
  }

  const response = await fetch(`${baseUrl}/api/resources`, {
    headers: { Authorization: `Bearer ${getStoredAdminToken()}` },
    signal,
  });
  if (!response.ok) {
    throw new Error(`resources_request_failed:${response.status}`);
  }
  return response.json() as Promise<ResourceExplorerList>;
}

export async function fetchResourceEvents(resource: Pick<ResourceExplorerItem, 'kind' | 'namespace' | 'name'>, signal?: AbortSignal): Promise<ResourceEvents> {
  const baseUrl = getTopologyApiBaseUrl().replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('api_base_url_not_configured');
  }

  const response = await fetch(`${baseUrl}/api/resources/${encodePath(resource.kind)}/${encodePath(resource.namespace || '-')}/${encodePath(resource.name)}/events`, {
    headers: { Authorization: `Bearer ${getStoredAdminToken()}` },
    signal,
  });
  if (!response.ok) {
    throw new Error(`resource_events_request_failed:${response.status}`);
  }
  return response.json() as Promise<ResourceEvents>;
}

export function resourcesFromSnapshot(snapshot: TopologySnapshot): ResourceExplorerList {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  return {
    items: snapshot.nodes.map((node) => ({
      id: node.id,
      clusterId: node.clusterId,
      kind: node.kind,
      namespace: node.namespace,
      name: node.name,
      status: node.status,
      labels: node.labels,
      annotations: {},
      summary: safeSummary(node.kind, node.summary),
      preview: {
        kind: node.kind,
        name: node.name,
        namespace: node.namespace || '',
        status: node.status,
        labels: node.labels,
        summary: safeSummary(node.kind, node.summary),
        ...(node.kind === 'Secret' ? { secretValues: 'hidden' } : {}),
      },
      related: snapshot.edges.flatMap((edge) => {
        const outgoing = edge.source === node.id;
        const incoming = edge.target === node.id;
        if (!outgoing && !incoming) {
          return [];
        }
        const relatedNode = nodeById.get(outgoing ? edge.target : edge.source);
        if (!relatedNode) {
          return [];
        }
        return [
          {
            nodeId: relatedNode.id,
            kind: relatedNode.kind,
            namespace: relatedNode.namespace,
            name: relatedNode.name,
            edgeType: edge.type,
            direction: outgoing ? 'outgoing' as const : 'incoming' as const,
            sourceField: edge.sourceField,
          },
        ];
      }),
    })),
  };
}

function safeSummary(kind: string, summary: Record<string, string | number | boolean>) {
  if (kind !== 'Secret') {
    return summary;
  }

  return Object.fromEntries(
    Object.entries(summary).filter(([key]) => {
      const lowerKey = key.toLowerCase();
      return lowerKey !== 'data' && lowerKey !== 'stringdata' && !lowerKey.includes('token') && !lowerKey.includes('password') && !lowerKey.includes('key');
    }),
  );
}

function encodePath(value: string) {
  return encodeURIComponent(value);
}
