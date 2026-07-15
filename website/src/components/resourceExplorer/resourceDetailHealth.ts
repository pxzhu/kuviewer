import type { ResourceExplorerItem } from '../../types/resourceExplorer';
import type { DetailOverviewItem, DetailSectionTone, EventSeverity, HealthSignal } from './resourceDetailTypes';

export function sectionCount(values: Record<string, unknown>) {
  return `${visibleValueCount(values)}`;
}

export function visibleValueCount(values: Record<string, unknown>) {
  return Object.entries(values).filter(([, value]) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)).length;
}

export function resourceDetailOverviewItems({
  annotations,
  canFetchLogs,
  effectiveLogContainer,
  eventSeverityCounts,
  eventSummary,
  healthSignals,
  logSummary,
  labels,
  metadataPreview,
  relationCount,
  resource,
}: {
  annotations: Record<string, string>;
  canFetchLogs: boolean;
  effectiveLogContainer: string;
  eventSeverityCounts: Record<EventSeverity, number>;
  eventSummary: string;
  healthSignals: HealthSignal[];
  logSummary: string;
  labels: Record<string, string>;
  metadataPreview: Record<string, unknown>;
  relationCount: number;
  resource: ResourceExplorerItem;
}): DetailOverviewItem[] {
  const namespace = resource.namespace || (resource.kind === 'Namespace' ? resource.name : 'cluster-scoped');
  const age = overviewScalar(metadataPreview.age, 'unknown');
  const uid = overviewScalar(metadataPreview.uid, 'unknown');
  const owners = overviewList(metadataPreview.owners, 'none');
  const labelCount = visibleValueCount(labels);
  const annotationCount = visibleValueCount(annotations);
  const logContext = canFetchLogs ? `Logs ${effectiveLogContainer ? `${effectiveLogContainer} · ` : ''}${logSummary}` : 'Logs n/a';
  const eventSignal = eventSeverityCounts.warning > 0 ? `${eventSeverityCounts.warning} warning` : `Events ${eventSummary}`;
  const primaryHealthSignal = healthSignals[0] ?? fallbackHealthSignal(resource);
  const healthTone = primaryHealthSignal.tone === 'error' ? 'error' : primaryHealthSignal.tone === 'warning' || eventSeverityCounts.warning > 0 ? 'warning' : relationCount > 0 ? 'accent' : 'default';
  return [
    {
      label: 'Scope',
      value: namespace,
      helper: `${resource.clusterId} · ${resource.kind}`,
      tone: 'accent',
    },
    {
      label: 'Age / UID',
      value: age,
      helper: `UID ${uid}`,
    },
    {
      label: 'Owner / Tags',
      value: owners,
      helper: `${labelCount} labels · ${annotationCount} annotations`,
    },
    {
      label: 'Signals',
      value: primaryHealthSignal.value,
      helper: `${primaryHealthSignal.helper} · ${relationCount} rel · ${eventSignal} · ${logContext}`,
      tone: healthTone,
    },
  ];
}

export function detailOverviewToneClassName(tone: DetailOverviewItem['tone']) {
  if (tone === 'accent') {
    return 'border-[rgba(0,122,255,0.16)] bg-[rgba(0,122,255,0.055)]';
  }
  if (tone === 'warning') {
    return 'border-[rgba(255,149,0,0.18)] bg-[rgba(255,149,0,0.07)]';
  }
  if (tone === 'error') {
    return 'border-[rgba(255,59,48,0.18)] bg-[rgba(255,59,48,0.07)]';
  }
  return 'border-[rgba(60,60,67,0.1)] bg-white/70';
}

export function detailSectionToneClassName(active: boolean, tone: DetailSectionTone) {
  if (tone === 'error') {
    return active
      ? 'border-[rgba(255,59,48,0.34)] bg-white/72 ring-2 ring-[rgba(255,59,48,0.12)]'
      : 'border-[rgba(255,59,48,0.22)] bg-[rgba(255,59,48,0.035)]';
  }
  if (tone === 'warning') {
    return active
      ? 'border-[rgba(255,149,0,0.34)] bg-white/72 ring-2 ring-[rgba(255,149,0,0.12)]'
      : 'border-[rgba(255,149,0,0.22)] bg-[rgba(255,149,0,0.035)]';
  }
  return active ? 'border-[rgba(0,122,255,0.34)] bg-white/72 ring-2 ring-[rgba(0,122,255,0.12)]' : 'border-[rgba(60,60,67,0.12)] bg-white/72';
}

export function resourceHealthSignals(resource: ResourceExplorerItem, statusPreview: Record<string, unknown>, summaryPreview: Record<string, unknown>): HealthSignal[] {
  const facts = { ...summaryPreview, ...statusPreview };
  const signals: HealthSignal[] = [];
  const addSignal = (signal: HealthSignal) => {
    if (!signals.some((existing) => existing.label === signal.label && existing.value === signal.value)) {
      signals.push(signal);
    }
  };
  const statusTone = healthToneFromStatus(resource.status);
  const addGenericHealth = () => {
    addSignal({
      label: 'Health',
      value: statusTitle(resource.status),
      helper: `${resource.kind} status`,
      tone: statusTone,
    });
  };

  if (resource.kind === 'Pod') {
    const phase = factScalar(facts, 'phase', resource.status === 'healthy' ? 'Running' : 'unknown');
    const ready = ratioFromValue(firstFact(facts, ['ready']));
    const restarts = numberFromValue(firstFact(facts, ['restarts']));
    const node = factScalar(facts, 'node', 'unassigned');
    if (resource.status === 'error') {
      addSignal({ label: 'Health', value: `Pod ${phase}`, helper: 'pod phase/status indicates failure', tone: 'error' });
    } else if (ready && ready.ready < ready.total) {
      addSignal({ label: 'Health', value: 'Pod not ready', helper: `${ready.ready}/${ready.total} containers ready`, tone: 'warning' });
    } else if (phase !== 'Running' && phase !== 'Succeeded' && phase !== 'unknown') {
      addSignal({ label: 'Health', value: `Pod ${phase}`, helper: 'phase is not Running', tone: resource.status === 'healthy' ? 'default' : 'warning' });
    } else {
      addSignal({ label: 'Health', value: phase === 'Succeeded' ? 'Pod completed' : 'Pod ready', helper: ready ? `${ready.ready}/${ready.total} containers ready` : `phase ${phase}`, tone: resource.status === 'healthy' ? 'healthy' : statusTone });
    }
    if (restarts > 0) {
      addSignal({ label: 'Restarts', value: `${restarts}`, helper: 'container restart count', tone: restarts >= 3 || resource.status !== 'healthy' ? 'warning' : 'default' });
    }
    if (node !== 'unassigned') {
      addSignal({ label: 'Node', value: node, helper: 'scheduled node', tone: 'accent' });
    }
    addConditionSignal(addSignal, facts);
  } else if (['Deployment', 'ReplicaSet', 'StatefulSet', 'DaemonSet', 'HorizontalPodAutoscaler'].includes(resource.kind)) {
    const replicas = ratioFromValue(firstFact(facts, ['replicas', 'ready']));
    if (replicas) {
      addSignal({
        label: 'Replicas',
        value: `${replicas.ready}/${replicas.total}`,
        helper: replicas.ready < replicas.total ? 'ready replicas below desired' : 'ready replicas match desired',
        tone: replicas.ready < replicas.total ? 'warning' : 'healthy',
      });
    } else {
      addGenericHealth();
    }
    const target = factScalar(facts, 'target', '');
    if (target) {
      addSignal({ label: 'Target', value: target, helper: 'scale target', tone: 'accent' });
    }
    const range = factScalar(facts, 'range', '');
    if (range) {
      addSignal({ label: 'Range', value: range, helper: 'configured replica range', tone: 'default' });
    }
  } else if (resource.kind === 'Service') {
    const endpoints = ratioFromValue(firstFact(facts, ['readyEndpoints', 'endpoints']));
    if (endpoints) {
      const emptyEndpoints = endpoints.total === 0 || endpoints.ready === 0;
      addSignal({
        label: 'Endpoints',
        value: `${endpoints.ready}/${endpoints.total}`,
        helper: emptyEndpoints ? 'no ready endpoints' : endpoints.ready < endpoints.total ? 'some endpoints are not ready' : 'ready endpoints match total',
        tone: emptyEndpoints ? (resource.status === 'error' ? 'error' : 'warning') : endpoints.ready < endpoints.total ? 'warning' : 'healthy',
      });
    } else if (resource.status === 'unknown') {
      addSignal({ label: 'Endpoints', value: 'unknown', helper: 'selector or endpoints unavailable', tone: 'default' });
    } else {
      addGenericHealth();
    }
    const serviceType = factScalar(facts, 'type', '');
    if (serviceType) {
      addSignal({ label: 'Type', value: serviceType, helper: 'service type', tone: 'accent' });
    }
  } else if (['PersistentVolumeClaim', 'PersistentVolume'].includes(resource.kind)) {
    const phase = factScalar(facts, 'phase', resource.status === 'healthy' ? 'Bound' : 'unknown');
    addSignal({
      label: 'Storage',
      value: phase === 'unknown' ? statusTitle(resource.status) : phase,
      helper: storageHealthHelper(facts),
      tone: resource.status === 'error' ? 'error' : resource.status === 'warning' || (phase !== 'Bound' && phase !== 'Available' && phase !== 'unknown') ? 'warning' : resource.status === 'healthy' ? 'healthy' : 'default',
    });
    const storageClass = factScalar(facts, 'storageClass', '');
    if (storageClass) {
      addSignal({ label: 'Class', value: storageClass, helper: 'storage class', tone: 'default' });
    }
  } else if (resource.kind === 'Job') {
    const failed = numberFromValue(firstFact(facts, ['failed']));
    const succeeded = numberFromValue(firstFact(facts, ['succeeded']));
    const completions = numberFromValue(firstFact(facts, ['completions']));
    if (failed > 0) {
      addSignal({ label: 'Job', value: 'Failed', helper: `${failed} failed attempts`, tone: 'error' });
    } else if (completions > 0) {
      addSignal({ label: 'Job', value: `${succeeded}/${completions}`, helper: 'succeeded completions', tone: succeeded >= completions ? 'healthy' : 'warning' });
    } else {
      addGenericHealth();
    }
  } else if (resource.kind === 'CronJob') {
    addSignal({ label: 'Schedule', value: factScalar(facts, 'schedule', 'unknown'), helper: `${factScalar(facts, 'active', '0')} active jobs`, tone: resource.status === 'healthy' ? 'healthy' : statusTone });
  } else if (['Ingress', 'Gateway', 'HTTPRoute', 'GRPCRoute', 'TLSRoute', 'TCPRoute'].includes(resource.kind)) {
    addSignal({ label: 'Routing', value: routeSignalValue(facts), helper: routeSignalHelper(facts), tone: resource.status === 'healthy' ? 'healthy' : statusTone });
  } else if (resource.kind === 'NetworkPolicy') {
    addSignal({ label: 'Policy', value: factScalar(facts, 'policyTypes', 'NetworkPolicy'), helper: networkPolicyHealthHelper(facts), tone: resource.status === 'healthy' ? 'healthy' : statusTone });
  } else if (resource.kind === 'CustomResource') {
    const conditions = factScalar(facts, 'conditions', '');
    addSignal({ label: 'CustomResource', value: conditions || statusTitle(resource.status), helper: customResourceHealthHelper(facts), tone: conditions.includes('False') || conditions.includes('Unknown') ? 'warning' : resource.status === 'healthy' ? 'healthy' : statusTone });
  } else {
    addGenericHealth();
  }

  if (signals.length === 0) {
    addGenericHealth();
  }
  return signals.slice(0, 6);
}

export function fallbackHealthSignal(resource: ResourceExplorerItem): HealthSignal {
  return {
    label: 'Health',
    value: statusTitle(resource.status),
    helper: `${resource.kind} status`,
    tone: healthToneFromStatus(resource.status),
  };
}

export function healthSectionSummary(resource: ResourceExplorerItem, signals: HealthSignal[], statusPreview: Record<string, unknown>) {
  if (resource.status === 'error' || resource.status === 'warning') {
    return resource.status;
  }
  const issue = signals.find((signal) => signal.tone === 'error' || signal.tone === 'warning');
  if (issue) {
    return issue.tone;
  }
  return sectionCount(statusPreview);
}

export function healthSignalSectionTone(resource: ResourceExplorerItem, signals: HealthSignal[]): DetailSectionTone {
  if (resource.status === 'error' || signals.some((signal) => signal.tone === 'error')) {
    return 'error';
  }
  if (resource.status === 'warning' || signals.some((signal) => signal.tone === 'warning')) {
    return 'warning';
  }
  return 'default';
}

export function healthToneFromStatus(status: string): HealthSignal['tone'] {
  if (status === 'error') {
    return 'error';
  }
  if (status === 'warning') {
    return 'warning';
  }
  if (status === 'healthy') {
    return 'healthy';
  }
  return 'default';
}

export function healthSignalToneClassName(tone: HealthSignal['tone']) {
  if (tone === 'healthy') {
    return 'border-[rgba(52,199,89,0.18)] bg-[rgba(52,199,89,0.06)]';
  }
  if (tone === 'accent') {
    return 'border-[rgba(0,122,255,0.16)] bg-[rgba(0,122,255,0.055)]';
  }
  if (tone === 'warning') {
    return 'border-[rgba(255,149,0,0.2)] bg-[rgba(255,149,0,0.075)]';
  }
  if (tone === 'error') {
    return 'border-[rgba(255,59,48,0.2)] bg-[rgba(255,59,48,0.075)]';
  }
  return 'border-[rgba(60,60,67,0.1)] bg-white/70';
}

export function healthSignalBadgeClassName(tone: HealthSignal['tone']) {
  if (tone === 'healthy') {
    return 'rounded-full bg-[rgba(52,199,89,0.12)] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase text-[#248a3d]';
  }
  if (tone === 'accent') {
    return 'rounded-full bg-[rgba(0,122,255,0.1)] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase text-[#0057b8]';
  }
  if (tone === 'warning') {
    return 'rounded-full bg-[rgba(255,149,0,0.12)] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase text-[#9a5a00]';
  }
  if (tone === 'error') {
    return 'rounded-full bg-[rgba(255,59,48,0.12)] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase text-[#b42318]';
  }
  return 'rounded-full bg-[rgba(142,142,147,0.12)] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase text-[#636366]';
}

export function addConditionSignal(addSignal: (signal: HealthSignal) => void, facts: Record<string, unknown>) {
  const conditions = factScalar(facts, 'conditions', '');
  if (!conditions) {
    return;
  }
  addSignal({
    label: 'Conditions',
    value: conditions,
    helper: 'condition summary',
    tone: conditions.includes('False') || conditions.includes('Unknown') ? 'warning' : 'default',
  });
}

export function routeSignalValue(facts: Record<string, unknown>) {
  const hosts = factScalar(facts, 'hosts', factScalar(facts, 'host', 'route'));
  return hosts || 'route';
}

export function routeSignalHelper(facts: Record<string, unknown>) {
  const pieces = [
    factScalar(facts, 'listeners', '') ? `${factScalar(facts, 'listeners', '')} listeners` : '',
    factScalar(facts, 'rules', '') ? `${factScalar(facts, 'rules', '')} rules` : '',
    factScalar(facts, 'backends', '') ? `${factScalar(facts, 'backends', '')} backends` : '',
  ].filter(Boolean);
  return pieces.length > 0 ? pieces.join(' · ') : 'routing summary';
}

export function networkPolicyHealthHelper(facts: Record<string, unknown>) {
  const ingress = factScalar(facts, 'ingress', '');
  const egress = factScalar(facts, 'egress', '');
  if (ingress && egress) {
    return 'ingress and egress intent';
  }
  return ingress || egress || 'policy intent summary';
}

export function customResourceHealthHelper(facts: Record<string, unknown>) {
  const specFields = factScalar(facts, 'specFields', '');
  const statusFields = factScalar(facts, 'statusFields', '');
  return [specFields ? `${specFields} spec fields` : '', statusFields ? `${statusFields} status fields` : ''].filter(Boolean).join(' · ') || 'safe custom resource summary';
}

export function storageHealthHelper(facts: Record<string, unknown>) {
  return [factScalar(facts, 'storage', ''), factScalar(facts, 'capacity', ''), factScalar(facts, 'volume', ''), factScalar(facts, 'mode', '')].filter(Boolean).join(' · ') || 'storage summary';
}

export function statusTitle(status: string) {
  if (!status) {
    return 'Unknown';
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function firstFact(values: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = values[key];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

export function factScalar(values: Record<string, unknown>, key: string, fallback: string) {
  return overviewScalar(values[key], fallback);
}

export function numberFromValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function ratioFromValue(value: unknown): { ready: number; total: number } | null {
  if (typeof value === 'boolean') {
    return { ready: value ? 1 : 0, total: 1 };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { ready: value, total: value };
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) {
    return null;
  }
  return { ready: Number(match[1]), total: Number(match[2]) };
}

export function overviewScalar(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (Array.isArray(value)) {
    return overviewList(value, fallback);
  }
  if (typeof value === 'object') {
    return fallback;
  }
  return String(value);
}

export function overviewList(value: unknown, fallback: string): string {
  if (!Array.isArray(value)) {
    return overviewScalar(value, fallback);
  }
  const values = value.flatMap((item) => {
    if (item === undefined || item === null || item === '') {
      return [];
    }
    if (typeof item === 'object') {
      return [];
    }
    return [String(item)];
  });
  if (values.length === 0) {
    return fallback;
  }
  const visibleValues = values.slice(0, 2).join(', ');
  return values.length > 2 ? `${visibleValues} +${values.length - 2}` : visibleValues;
}
