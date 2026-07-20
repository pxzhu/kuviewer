import type { ResourceKind, ResourceStatus, SummaryValue } from '../../types/topology';
import { isRecord, type KubeObject } from './kubernetesObject.ts';

export interface NamespacedResourceReference {
  name: string;
  namespace: string;
}

const gatewayAPIGroup = 'gateway.networking.k8s.io';
const maxListeners = 64;
const maxAddresses = 16;
const maxConditions = 8;
const maxHostnames = 16;
const maxParentRefs = 32;
const maxRules = 16;
const maxBackendRefs = 16;
const maxReferenceResults = 256;
const maxMatches = 64;
const maxStatusParents = 32;

interface ParsedAddress {
  kind: 'ip' | 'hostname' | 'named' | 'custom';
  deprecated: boolean;
}

interface ParsedGateway {
  className: string;
  listeners: number;
  hosts: string[];
  requestedAddresses: ParsedAddress[];
}

interface ParsedGatewayStatus {
  assignedAddresses: ParsedAddress[];
  conditions: ParsedCondition[];
  listenerStatuses: number;
  attachedRoutes: number;
}

interface ParsedCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
}

interface ParsedRoute {
  hosts: string[];
  rules: number;
  parents: NamespacedResourceReference[];
  backends: NamespacedResourceReference[];
  methods: string[];
}

interface ParsedRouteStatus {
  parents: number;
  conditions: ParsedCondition[];
}

export function uploadGatewaySpecIsValid(object: KubeObject) {
  return parseGateway(object) !== null;
}

export function uploadGatewayStatus(object: KubeObject): ResourceStatus {
  const spec = parseGateway(object);
  const status = parseGatewayStatus(object);
  return spec && status && !hasUnreadyCondition(status.conditions) ? 'healthy' : 'warning';
}

export function uploadGatewaySummary(object: KubeObject): Record<string, SummaryValue> {
  const spec = parseGateway(object);
  const status = parseGatewayStatus(object);
  const statusSummary = status
    ? {
        assignedAddresses: status.assignedAddresses.length,
        assignedAddressTypes: addressTypeSummary(status.assignedAddresses),
        conditions: conditionSummary(status.conditions),
        listenerStatuses: status.listenerStatuses,
        attachedRoutes: status.attachedRoutes,
      }
    : {
        assignedAddresses: 'invalid',
        assignedAddressTypes: 'invalid',
        conditions: 'invalid',
        listenerStatuses: 'invalid',
        attachedRoutes: 'invalid',
      };
  if (!spec) {
    return {
      class: 'invalid',
      listeners: 'invalid',
      hosts: 'invalid',
      requestedAddresses: 'invalid',
      requestedAddressTypes: 'invalid',
      deprecatedAddresses: 'invalid',
      ...statusSummary,
    };
  }
  return {
    class: spec.className,
    listeners: spec.listeners,
    hosts: limitedSummary(spec.hosts, 8, '-'),
    requestedAddresses: spec.requestedAddresses.length,
    requestedAddressTypes: addressTypeSummary(spec.requestedAddresses),
    deprecatedAddresses: spec.requestedAddresses.filter((address) => address.deprecated).length,
    ...statusSummary,
  };
}

export function uploadGatewayRouteSpecIsValid(kind: ResourceKind, object: KubeObject) {
  return isGatewayRouteKind(kind) && parseRoute(kind, object) !== null;
}

export function uploadGatewayRouteStatus(kind: ResourceKind, object: KubeObject): ResourceStatus {
  const spec = isGatewayRouteKind(kind) ? parseRoute(kind, object) : null;
  const status = parseRouteStatus(object);
  return spec && status && !hasUnreadyCondition(status.conditions) ? 'healthy' : 'warning';
}

export function uploadGatewayRouteSummary(kind: ResourceKind, object: KubeObject): Record<string, SummaryValue> {
  const spec = isGatewayRouteKind(kind) ? parseRoute(kind, object) : null;
  const status = parseRouteStatus(object);
  const statusSummary = status
    ? {
        statusParents: status.parents,
        acceptedParents: trueConditionCount(status.conditions, 'Accepted'),
        resolvedParents: trueConditionCount(status.conditions, 'ResolvedRefs'),
        statusConditions: status.conditions.length,
      }
    : { statusParents: 'invalid', acceptedParents: 'invalid', resolvedParents: 'invalid', statusConditions: 'invalid' };
  if (!spec) {
    return { hosts: 'invalid', rules: 'invalid', parents: 'invalid', backends: 'invalid', methods: 'invalid', ...statusSummary };
  }
  return {
    ...(kind !== 'TCPRoute' ? { hosts: limitedSummary(spec.hosts, 8, '-') } : {}),
    rules: spec.rules,
    parents: spec.parents.length,
    backends: spec.backends.length,
    ...(kind === 'GRPCRoute' ? { methods: limitedSummary(spec.methods, 8, '-') } : {}),
    ...statusSummary,
  };
}

export function gatewayRouteParentGateways(object: KubeObject, namespace: string): NamespacedResourceReference[] {
  const kind = normalizedRouteKind(object.kind);
  return kind ? parseRoute(kind, object, namespace)?.parents ?? [] : [];
}

export function gatewayRouteBackendServices(object: KubeObject, namespace: string): NamespacedResourceReference[] {
  const kind = normalizedRouteKind(object.kind);
  return kind ? parseRoute(kind, object, namespace)?.backends ?? [] : [];
}

export function grpcRouteMethods(object: KubeObject) {
  return parseRoute('GRPCRoute', object)?.methods ?? [];
}

export function gatewayHosts(object: KubeObject) {
  return parseGateway(object)?.hosts ?? [];
}

export function isGatewayRouteKind(kind: ResourceKind): kind is Extract<ResourceKind, 'HTTPRoute' | 'GRPCRoute' | 'TLSRoute' | 'TCPRoute'> {
  return kind === 'HTTPRoute' || kind === 'GRPCRoute' || kind === 'TLSRoute' || kind === 'TCPRoute';
}

function parseGateway(object: KubeObject): ParsedGateway | null {
  const spec = object.spec;
  if (!isRecord(spec) || typeof spec.gatewayClassName !== 'string' || !validReferenceName(spec.gatewayClassName)) {
    return null;
  }
  const listeners = recordArray(spec.listeners, maxListeners, false);
  const addresses = parseAddresses(spec.addresses, true);
  if (!listeners || !addresses) {
    return null;
  }
  const names = new Set<string>();
  const hosts: string[] = [];
  for (const listener of listeners) {
    const name = listener.name;
    const hostname = optionalString(listener.hostname);
    if (typeof name !== 'string' || !validSectionName(name) || names.has(name) || !validProtocol(listener.protocol) || !validPort(listener.port) || hostname === null || Boolean(hostname && !validHostname(hostname))) {
      return null;
    }
    names.add(name);
    if (hostname) {
      hosts.push(hostname);
    }
  }
  return { className: spec.gatewayClassName, listeners: listeners.length, hosts: uniqueStrings(hosts), requestedAddresses: addresses };
}

function parseGatewayStatus(object: KubeObject): ParsedGatewayStatus | null {
  if (object.status == null) {
    return { assignedAddresses: [], conditions: [], listenerStatuses: 0, attachedRoutes: 0 };
  }
  if (!isRecord(object.status)) {
    return null;
  }
  const addresses = parseAddresses(object.status.addresses, true);
  const conditions = parseConditions(object.status.conditions, maxConditions);
  const listeners = recordArray(object.status.listeners, maxListeners);
  if (!addresses || !conditions || !listeners) {
    return null;
  }
  const names = new Set<string>();
  let attachedRoutes = 0;
  for (const listener of listeners) {
    const listenerConditions = parseConditions(listener.conditions, maxConditions);
    if (typeof listener.name !== 'string' || !validSectionName(listener.name) || names.has(listener.name) || !safeCount(listener.attachedRoutes) || !listenerConditions) {
      return null;
    }
    names.add(listener.name);
    attachedRoutes += listener.attachedRoutes as number;
    if (attachedRoutes > 1_000_000) {
      return null;
    }
  }
  return { assignedAddresses: addresses, conditions, listenerStatuses: listeners.length, attachedRoutes };
}

function parseRoute(kind: Extract<ResourceKind, 'HTTPRoute' | 'GRPCRoute' | 'TLSRoute' | 'TCPRoute'>, object: KubeObject, namespaceOverride?: string): ParsedRoute | null {
  const spec = object.spec;
  const namespace = namespaceOverride ?? object.metadata?.namespace ?? '';
  if (!isRecord(spec) || !validNamespace(namespace)) {
    return null;
  }
  const hostnames = stringArray(spec.hostnames, maxHostnames);
  const parentRefs = recordArray(spec.parentRefs, maxParentRefs);
  const rules = recordArray(spec.rules, maxRules);
  if (!hostnames || !parentRefs || !rules || ((kind === 'TLSRoute' || kind === 'TCPRoute') && rules.length === 0) || (kind === 'TCPRoute' && hostnames.length > 0) || hostnames.some((hostname) => !validHostname(hostname))) {
    return null;
  }

  const parents: NamespacedResourceReference[] = [];
  for (const reference of parentRefs) {
    const parsed = parseParentReference(reference, namespace);
    if (!parsed) {
      return null;
    }
    if (parsed.inferred) {
      parents.push(parsed.reference);
    }
  }

  const backends: NamespacedResourceReference[] = [];
  const methods: string[] = [];
  let referenceCount = 0;
  for (const rule of rules) {
    const backendRefs = recordArray(rule.backendRefs, maxBackendRefs);
    const matches = recordArray(rule.matches, maxMatches);
    if (!backendRefs || !matches || ((kind === 'TLSRoute' || kind === 'TCPRoute') && backendRefs.length === 0)) {
      return null;
    }
    for (const reference of backendRefs) {
      const parsed = parseBackendReference(reference, namespace);
      if (!parsed || ++referenceCount > maxReferenceResults) {
        return null;
      }
      if (parsed.inferred) {
        backends.push(parsed.reference);
      }
    }
    if (kind === 'GRPCRoute') {
      for (const match of matches) {
        const method = match.method;
        if (method == null) {
          continue;
        }
        if (!isRecord(method)) {
          return null;
        }
        const service = optionalString(method.service);
        const methodName = optionalString(method.method);
        if (service === null || methodName === null || Boolean(service && !validDottedIdentifier(service, 256)) || Boolean(methodName && !validIdentifier(methodName, 128))) {
          return null;
        }
        if (service || methodName) {
          methods.push(service && methodName ? `${service}/${methodName}` : service || methodName);
        }
      }
    }
  }
  return { hosts: uniqueStrings(hostnames), rules: rules.length, parents: uniqueReferences(parents), backends: uniqueReferences(backends), methods: uniqueStrings(methods) };
}

function parseRouteStatus(object: KubeObject): ParsedRouteStatus | null {
  if (object.status == null) {
    return { parents: 0, conditions: [] };
  }
  if (!isRecord(object.status)) {
    return null;
  }
  const parents = recordArray(object.status.parents, maxStatusParents);
  if (!parents) {
    return null;
  }
  const conditions: ParsedCondition[] = [];
  for (const parent of parents) {
    const parsed = parseConditions(parent.conditions, maxConditions);
    if (!parsed) {
      return null;
    }
    conditions.push(...parsed);
  }
  return { parents: parents.length, conditions };
}

function parseParentReference(value: Record<string, unknown>, namespace: string) {
  const identity = parseReferenceIdentity(value, namespace);
  const sectionName = optionalString(value.sectionName);
  if (!identity || sectionName === null || Boolean(sectionName && !validSectionName(sectionName)) || value.port != null) {
    return null;
  }
  const group = optionalString(value.group);
  const kind = optionalString(value.kind);
  if (group === null || kind === null) {
    return null;
  }
  const normalizedGroup = group || gatewayAPIGroup;
  const normalizedKind = kind || 'Gateway';
  if ((normalizedGroup !== gatewayAPIGroup || normalizedKind !== 'Gateway') && (!validDNSSubdomain(normalizedGroup) || !validKind(normalizedKind))) {
    return null;
  }
  return { reference: identity, inferred: normalizedGroup === gatewayAPIGroup && normalizedKind === 'Gateway' };
}

function parseBackendReference(value: Record<string, unknown>, namespace: string) {
  const identity = parseReferenceIdentity(value, namespace);
  const group = optionalString(value.group);
  const kind = optionalString(value.kind);
  if (!identity || group === null || kind === null || value.sectionName != null) {
    return null;
  }
  if (!group && (!kind || kind === 'Service')) {
    return validPort(value.port) ? { reference: identity, inferred: true } : null;
  }
  if (!validDNSSubdomain(group) || !validKind(kind) || (value.port != null && !validPort(value.port))) {
    return null;
  }
  return { reference: identity, inferred: false };
}

function parseReferenceIdentity(value: Record<string, unknown>, namespace: string): NamespacedResourceReference | null {
  const targetNamespace = optionalString(value.namespace);
  return typeof value.name === 'string' && validReferenceName(value.name) && targetNamespace !== null && validNamespace(targetNamespace || namespace)
    ? { name: value.name, namespace: targetNamespace || namespace }
    : null;
}

function parseAddresses(value: unknown, requireValue: boolean): ParsedAddress[] | null {
  const addresses = recordArray(value, maxAddresses);
  if (!addresses) {
    return null;
  }
  const result: ParsedAddress[] = [];
  for (const address of addresses) {
    const type = address.type == null ? 'IPAddress' : address.type;
    const rawValue = address.value;
    if (typeof type !== 'string' || typeof rawValue !== 'string' || (requireValue && rawValue === '')) {
      return null;
    }
    let kind: ParsedAddress['kind'];
    let deprecated = false;
    if (type === 'IPAddress') {
      kind = 'ip';
      if (rawValue && !canonicalIPAddress(rawValue)) return null;
    } else if (type === 'Hostname') {
      kind = 'hostname';
      if (rawValue && !validDNSSubdomain(rawValue)) return null;
    } else if (type === 'NamedAddress') {
      kind = 'named';
      deprecated = true;
      if (rawValue && !validSafeAddressValue(rawValue)) return null;
    } else if (validCustomType(type)) {
      kind = 'custom';
      if (rawValue && !validSafeAddressValue(rawValue)) return null;
    } else {
      return null;
    }
    result.push({ kind, deprecated });
  }
  return result;
}

function parseConditions(value: unknown, limit: number): ParsedCondition[] | null {
  const conditions = recordArray(value, limit);
  if (!conditions) return null;
  const seen = new Set<string>();
  const result: ParsedCondition[] = [];
  for (const condition of conditions) {
    if (typeof condition.type !== 'string' || !validConditionType(condition.type) || (condition.status !== 'True' && condition.status !== 'False' && condition.status !== 'Unknown') || seen.has(condition.type)) {
      return null;
    }
    seen.add(condition.type);
    result.push({ type: condition.type, status: condition.status });
  }
  return result;
}

function hasUnreadyCondition(conditions: ParsedCondition[]) {
  return conditions.some((condition) => ['Accepted', 'Programmed', 'Ready', 'ResolvedRefs'].includes(condition.type) && condition.status !== 'True');
}

function trueConditionCount(conditions: ParsedCondition[], type: string) {
  return conditions.filter((condition) => condition.type === type && condition.status === 'True').length;
}

function conditionSummary(conditions: ParsedCondition[]) {
  return conditions.map((condition) => `${condition.type}=${condition.status}`).sort().join(',') || '-';
}

function addressTypeSummary(addresses: ParsedAddress[]) {
  const counts = { ip: 0, hostname: 0, named: 0, custom: 0 };
  addresses.forEach((address) => { counts[address.kind] += 1; });
  return `ip:${counts.ip},hostname:${counts.hostname},named:${counts.named},custom:${counts.custom}`;
}

function normalizedRouteKind(value: string | undefined): Extract<ResourceKind, 'HTTPRoute' | 'GRPCRoute' | 'TLSRoute' | 'TCPRoute'> | null {
  return value === 'HTTPRoute' || value === 'GRPCRoute' || value === 'TLSRoute' || value === 'TCPRoute' ? value : null;
}

function recordArray(value: unknown, limit: number, allowEmpty = true): Record<string, unknown>[] | null {
  if (value == null) return allowEmpty ? [] : null;
  return Array.isArray(value) && value.length <= limit && (allowEmpty || value.length > 0) && value.every(isRecord) ? value : null;
}

function stringArray(value: unknown, limit: number): string[] | null {
  if (value == null) return [];
  return Array.isArray(value) && value.length <= limit && value.every((item): item is string => typeof item === 'string') ? value : null;
}

function optionalString(value: unknown): string | null {
  return value == null ? '' : typeof value === 'string' ? value : null;
}

function validProtocol(value: unknown) {
  return typeof value === 'string' && (['HTTP', 'HTTPS', 'TLS', 'TCP', 'UDP'].includes(value) || validCustomType(value));
}

function validCustomType(value: string) {
  const parts = value.split('/');
  return value.length <= 253 && parts.length === 2 && validDNSSubdomain(parts[0] || '') && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(parts[1] || '');
}

function validSafeAddressValue(value: string) {
  return value.length <= 253 && /^[\x21-\x7e]+$/.test(value);
}

function validSectionName(value: string) {
  return value.length <= 253 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value);
}

function validConditionType(value: string) {
  return value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value);
}

function validReferenceName(value: string) {
  return validDNSSubdomain(value);
}

function validNamespace(value: string) {
  return value === '' || validDNSSubdomain(value);
}

function validHostname(value: string) {
  return value.startsWith('*.') ? validDNSSubdomain(value.slice(2)) : validDNSSubdomain(value);
}

function validKind(value: string) {
  return value.length <= 63 && /^[A-Za-z][A-Za-z0-9]*$/.test(value);
}

function validPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function safeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000;
}

function validIdentifier(value: string, limit: number) {
  return value.length <= limit && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function validDottedIdentifier(value: string, limit: number) {
  return value.length <= limit && value.split('.').every((part) => validIdentifier(part, limit));
}

function validDNSSubdomain(value: string) {
  return value.length > 0 && value.length <= 253 && value === value.toLowerCase() && value.split('.').every((part) => part.length <= 63 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(part));
}

function canonicalIPAddress(value: string) {
  if (/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) {
    return value.split('.').every((part) => Number(part) <= 255);
  }
  if (!value.includes(':') || value !== value.toLowerCase()) return false;
  try {
    return new URL(`http://[${value}]/`).hostname === `[${value}]`;
  } catch {
    return false;
  }
}

function uniqueReferences(values: NamespacedResourceReference[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.namespace}/${value.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => `${left.namespace}/${left.name}`.localeCompare(`${right.namespace}/${right.name}`));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function limitedSummary(values: string[], limit: number, fallback: string) {
  if (values.length === 0) return fallback;
  return values.length <= limit ? values.join(', ') : `${values.slice(0, limit).join(', ')} +${values.length - limit}`;
}
