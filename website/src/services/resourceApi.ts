import { getStoredAdminToken } from '../features/auth/adminToken';
import type { ResourceEvents, ResourceExplorerItem, ResourceExplorerList, ResourceLogs } from '../types/resourceExplorer';
import type { SummaryValue, TopologySnapshot } from '../types/topology';
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

export async function fetchResourceLogs(resource: Pick<ResourceExplorerItem, 'kind' | 'namespace' | 'name'>, container?: string, signal?: AbortSignal): Promise<ResourceLogs> {
  const baseUrl = getTopologyApiBaseUrl().replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('api_base_url_not_configured');
  }
  const query = container ? `?container=${encodeURIComponent(container)}` : '';

  const response = await fetch(`${baseUrl}/api/resources/${encodePath(resource.kind)}/${encodePath(resource.namespace || '-')}/${encodePath(resource.name)}/logs${query}`, {
    headers: { Authorization: `Bearer ${getStoredAdminToken()}` },
    signal,
  });
  if (!response.ok) {
    throw new Error(`resource_logs_request_failed:${response.status}`);
  }
  return response.json() as Promise<ResourceLogs>;
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
      labels: node.labels ?? {},
      annotations: safeAnnotations(node.annotations),
      summary: safeSummary(node.kind, node.summary),
      preview: safePreview(node),
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

function safePreview(node: TopologySnapshot['nodes'][number]) {
  const safeNodeAnnotations = safeAnnotations(node.annotations);
  const summary = safeSummary(node.kind, node.summary);
  const preview: Record<string, unknown> = {
    metadata: {
      kind: node.kind,
      name: node.name,
      namespace: node.namespace || '',
      cluster: node.clusterId,
      uid: shortUid(node.uid),
      age: node.age || '',
      owners: node.owners ?? [],
      labels: Object.keys(node.labels ?? {}).length,
      safeAnnotations: Object.keys(safeNodeAnnotations).length,
      hiddenAnnotations: hiddenAnnotationCount(node.annotations),
    },
    status: {
      status: node.status,
      ...summary,
    },
    summary,
    safeYaml: safeYamlPreview(node, safeNodeAnnotations, summary),
  };
  if (node.kind === 'Secret') {
    preview.secretValues = 'hidden';
  }
  return preview;
}

function safeSummary(kind: string, summary: Record<string, SummaryValue>) {
  if (kind !== 'Secret') {
    return summary;
  }

  return Object.fromEntries(
    Object.entries(summary).filter(([key]) => {
      const lowerKey = key.toLowerCase();
      return lowerKey !== 'data' && lowerKey !== 'stringdata' && !sensitiveField(lowerKey);
    }),
  );
}

function safeAnnotations(values?: Record<string, string>) {
  if (!values) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, sensitiveField(key) || sensitiveField(value) ? 'redacted' : value]),
  );
}

function hiddenAnnotationCount(values?: Record<string, string>) {
  if (!values) {
    return 0;
  }
  return Object.entries(values).filter(([key, value]) => value === 'redacted' || sensitiveField(key) || sensitiveField(value)).length;
}

function sensitiveField(value: string) {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('token') ||
    normalized.includes('password') ||
    normalized.includes('secret') ||
    normalized.includes('credential') ||
    normalized.includes('apikey') ||
    normalized.includes('api-key') ||
    normalized.includes('accesskey') ||
    normalized.includes('access-key') ||
    normalized.includes('private-key') ||
    normalized.includes('client-key')
  );
}

function safeYamlPreview(node: TopologySnapshot['nodes'][number], annotations: Record<string, string>, summary: Record<string, SummaryValue>) {
  const lines = [
    'apiVersion: kuviewer.io/v1',
    `kind: ${yamlScalar(node.kind)}`,
    'metadata:',
    `  name: ${yamlScalar(node.name)}`,
  ];
  if (node.namespace) {
    lines.push(`  namespace: ${yamlScalar(node.namespace)}`);
  }
  lines.push(`  cluster: ${yamlScalar(node.clusterId)}`);
  if (node.uid) {
    lines.push(`  uid: ${yamlScalar(shortUid(node.uid))}`);
  }
  if (node.age) {
    lines.push(`  age: ${yamlScalar(node.age)}`);
  }
  appendStringMapYaml(lines, '  labels', node.labels ?? {});
  appendStringMapYaml(lines, '  annotations', annotations);
  appendStringArrayYaml(lines, '  owners', node.owners ?? []);
  lines.push('status:');
  lines.push(`  state: ${yamlScalar(node.status)}`);
  appendSummaryYaml(lines, 'summary', summary);
  if (node.kind === 'Secret') {
    lines.push('secretValues: hidden');
  }
  return lines.join('\n');
}

function appendStringMapYaml(lines: string[], key: string, values: Record<string, string>) {
  const entries = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    lines.push(`${key}: {}`);
    return;
  }
  lines.push(`${key}:`);
  entries.forEach(([entryKey, entryValue]) => {
    lines.push(`    ${yamlKey(entryKey)}: ${sensitiveField(entryKey) || sensitiveField(entryValue) ? 'redacted' : yamlScalar(entryValue)}`);
  });
}

function appendStringArrayYaml(lines: string[], key: string, values: string[]) {
  if (values.length === 0) {
    lines.push(`${key}: []`);
    return;
  }
  lines.push(`${key}:`);
  values.forEach((value) => lines.push(`    - ${yamlScalar(value)}`));
}

function appendSummaryYaml(lines: string[], key: string, values: Record<string, SummaryValue>) {
  const entries = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    lines.push(`${key}: {}`);
    return;
  }
  lines.push(`${key}:`);
  entries.forEach(([entryKey, entryValue]) => {
    if (sensitiveField(entryKey)) {
      lines.push(`  ${yamlKey(entryKey)}: redacted`);
      return;
    }
    if (Array.isArray(entryValue)) {
      if (entryValue.length === 0) {
        lines.push(`  ${yamlKey(entryKey)}: []`);
        return;
      }
      lines.push(`  ${yamlKey(entryKey)}:`);
      entryValue.forEach((item) => lines.push(`    - ${safeYamlScalar(item)}`));
      return;
    }
    lines.push(`  ${yamlKey(entryKey)}: ${safeYamlScalar(entryValue)}`);
  });
}

function safeYamlScalar(value: SummaryValue) {
  return typeof value === 'string' && sensitiveField(value) ? 'redacted' : yamlScalar(value);
}

function yamlScalar(value: unknown) {
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  const text = String(value ?? '');
  if (!text) {
    return "''";
  }
  if (yamlBareScalar(text)) {
    return text;
  }
  return `'${text.replace(/'/g, "''")}'`;
}

function yamlBareScalar(value: string) {
  return value !== 'true' && value !== 'false' && value !== 'null' && /^[A-Za-z0-9_./:-]+$/.test(value);
}

function yamlKey(value: string) {
  return yamlBareScalar(value) ? value : yamlScalar(value);
}

function shortUid(uid?: string) {
  if (!uid) {
    return '';
  }
  return uid.length <= 12 ? uid : uid.slice(0, 12);
}

function encodePath(value: string) {
  return encodeURIComponent(value);
}
