import type { ResourceStatus, SummaryValue } from '../../types/topology';
import { isRecord, readAt, type KubeObject } from './kubernetesObject.ts';

const maxIngressRules = 256;
const maxIngressPathsPerRule = 256;
const maxIngressBackendResults = 512;
const maxIngressTLSConfigs = 64;
const maxIngressTLSHostsPerConfig = 64;
const maxIngressTLSHostResults = 256;
const maxIngressLoadBalancerPoints = 64;
const maxIngressLoadBalancerPorts = 32;

interface ParsedIngressSpec {
  ingressClassName: string;
  hosts: string[];
  rules: number;
  serviceNames: string[];
  defaultBackend: 'unset' | 'Service' | 'Resource';
  tls: number;
  tlsHosts: number;
  tlsSecrets: number;
}

interface ParsedIngressStatus {
  addresses: number;
  ips: number;
  hostnames: number;
  ports: number;
  portErrors: number;
}

export function uploadIngressSpecIsValid(object: KubeObject) {
  return parseIngressSpec(object) !== null;
}

export function uploadIngressServiceNames(object: KubeObject) {
  return parseIngressSpec(object)?.serviceNames ?? [];
}

export function uploadIngressStatus(object: KubeObject): ResourceStatus {
  return parseIngressSpec(object) && parseIngressStatus(object) ? 'healthy' : 'warning';
}

export function uploadIngressSummary(object: KubeObject): Record<string, SummaryValue> {
  const spec = parseIngressSpec(object);
  const status = parseIngressStatus(object);
  const statusSummary = status
    ? {
        loadBalancerAddresses: status.addresses,
        loadBalancerIPs: status.ips,
        loadBalancerHostnames: status.hostnames,
        loadBalancerPorts: status.ports,
        loadBalancerPortErrors: status.portErrors,
      }
    : {
        loadBalancerAddresses: 'invalid',
        loadBalancerIPs: 'invalid',
        loadBalancerHostnames: 'invalid',
        loadBalancerPorts: 'invalid',
        loadBalancerPortErrors: 'invalid',
      };
  if (!spec) {
    return {
      class: 'invalid',
      hosts: 'invalid',
      rules: 'invalid',
      backends: 'invalid',
      defaultBackend: 'invalid',
      tls: 'invalid',
      tlsHosts: 'invalid',
      tlsSecrets: 'invalid',
      ...statusSummary,
    };
  }
  return {
    class: spec.ingressClassName || 'default',
    hosts: limitedSummary(spec.hosts, 8, ''),
    rules: spec.rules,
    backends: spec.serviceNames.length,
    defaultBackend: spec.defaultBackend,
    tls: spec.tls,
    tlsHosts: spec.tlsHosts,
    tlsSecrets: spec.tlsSecrets,
    ...statusSummary,
  };
}

function parseIngressSpec(object: KubeObject): ParsedIngressSpec | null {
  const spec = object.spec;
  if (!isRecord(spec)) {
    return null;
  }
  const ingressClassName = optionalString(spec.ingressClassName);
  const rules = recordArray(spec.rules, maxIngressRules);
  const tls = recordArray(spec.tls, maxIngressTLSConfigs);
  const defaultBackend = spec.defaultBackend == null ? null : parseIngressBackend(spec.defaultBackend);
  const invalidClass = ingressClassName === null || Boolean(ingressClassName && !validReferenceName(ingressClassName));
  const invalidDefaultBackend = spec.defaultBackend != null && !defaultBackend;
  if (invalidClass || !rules || !tls || invalidDefaultBackend || (rules.length === 0 && !defaultBackend)) {
    return null;
  }

  const hosts: string[] = [];
  const serviceNames: string[] = [];
  let backendCount = defaultBackend ? 1 : 0;
  if (defaultBackend?.kind === 'Service') {
    serviceNames.push(defaultBackend.name);
  }
  for (const rule of rules) {
    const host = optionalString(rule.host);
    const http = rule.http;
    if (host === null || Boolean(host && !validHostname(host)) || !isRecord(http)) {
      return null;
    }
    const paths = recordArray(http.paths, maxIngressPathsPerRule, false);
    if (!paths) {
      return null;
    }
    if (host) {
      hosts.push(host);
    }
    for (const path of paths) {
      const parsedBackend = parseIngressBackend(path.backend);
      if (!validIngressPath(path.path, path.pathType) || !parsedBackend) {
        return null;
      }
      backendCount += 1;
      if (backendCount > maxIngressBackendResults) {
        return null;
      }
      if (parsedBackend.kind === 'Service') {
        serviceNames.push(parsedBackend.name);
      }
    }
  }

  let tlsHostCount = 0;
  let tlsSecretCount = 0;
  for (const config of tls) {
    const tlsHosts = stringArray(config.hosts, maxIngressTLSHostsPerConfig);
    const secretName = optionalString(config.secretName);
    const invalidSecret = secretName === null || Boolean(secretName && !validReferenceName(secretName));
    if (!tlsHosts || invalidSecret || tlsHosts.some((host) => !validHostname(host))) {
      return null;
    }
    tlsHostCount += tlsHosts.length;
    if (tlsHostCount > maxIngressTLSHostResults) {
      return null;
    }
    if (secretName) {
      tlsSecretCount += 1;
    }
  }

  return {
    ingressClassName,
    hosts: uniqueStrings(hosts),
    rules: rules.length,
    serviceNames: uniqueStrings(serviceNames),
    defaultBackend: defaultBackend?.kind ?? 'unset',
    tls: tls.length,
    tlsHosts: tlsHostCount,
    tlsSecrets: tlsSecretCount,
  };
}

function parseIngressBackend(value: unknown): { kind: 'Service' | 'Resource'; name: string } | null {
  if (!isRecord(value)) {
    return null;
  }
  const service = value.service;
  const resource = value.resource;
  if ((service == null) === (resource == null)) {
    return null;
  }
  if (isRecord(service)) {
    const name = service.name;
    const port = service.port;
    if (typeof name !== 'string' || !validReferenceName(name) || !isRecord(port)) {
      return null;
    }
    const portName = port.name;
    const portNumber = port.number;
    const validName = typeof portName === 'string' && validIANAServiceName(portName) && portNumber == null;
    const validNumber = validPortNumber(portNumber) && portName == null;
    return validName || validNumber ? { kind: 'Service', name } : null;
  }
  if (isRecord(resource)) {
    const apiGroup = resource.apiGroup;
    const kind = resource.kind;
    const name = resource.name;
    const validAPIGroup = apiGroup == null || (typeof apiGroup === 'string' && (apiGroup === '' || validDNSSubdomain(apiGroup)));
    if (validAPIGroup && typeof kind === 'string' && validKind(kind) && typeof name === 'string' && validReferenceName(name)) {
      return { kind: 'Resource', name };
    }
  }
  return null;
}

function parseIngressStatus(object: KubeObject): ParsedIngressStatus | null {
  const loadBalancer = readAt(object, ['status', 'loadBalancer']);
  if (loadBalancer == null) {
    return { addresses: 0, ips: 0, hostnames: 0, ports: 0, portErrors: 0 };
  }
  if (!isRecord(loadBalancer)) {
    return null;
  }
  const points = recordArray(loadBalancer.ingress, maxIngressLoadBalancerPoints);
  if (!points) {
    return null;
  }
  let ips = 0;
  let hostnames = 0;
  let ports = 0;
  let portErrors = 0;
  for (const point of points) {
    const ip = optionalString(point.ip);
    const hostname = optionalString(point.hostname);
    const pointPorts = recordArray(point.ports, maxIngressLoadBalancerPorts);
    if (ip === null || hostname === null || !pointPorts || Boolean(ip) === Boolean(hostname)) {
      return null;
    }
    if (ip) {
      if (!canonicalIPAddress(ip)) {
        return null;
      }
      ips += 1;
    } else {
      if (!validDNSSubdomain(hostname)) {
        return null;
      }
      hostnames += 1;
    }
    for (const port of pointPorts) {
      const validProtocol = port.protocol === 'TCP' || port.protocol === 'UDP' || port.protocol === 'SCTP';
      const validError = port.error == null || typeof port.error === 'string';
      if (!validPortNumber(port.port) || !validProtocol || !validError) {
        return null;
      }
      if (port.error) {
        portErrors += 1;
      }
    }
    ports += pointPorts.length;
  }
  return { addresses: points.length, ips, hostnames, ports, portErrors };
}

function validIngressPath(path: unknown, pathType: unknown) {
  if (pathType !== 'Exact' && pathType !== 'Prefix' && pathType !== 'ImplementationSpecific') {
    return false;
  }
  return (path === '' && pathType === 'ImplementationSpecific') || (typeof path === 'string' && path.startsWith('/') && path.length <= 2048);
}

function canonicalIPAddress(value: string) {
  if (/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) {
    return value.split('.').every((part) => Number(part) <= 255);
  }
  if (!value.includes(':') || value !== value.toLowerCase()) {
    return false;
  }
  try {
    return new URL(`http://[${value}]/`).hostname === `[${value}]`;
  } catch {
    return false;
  }
}

function validHostname(value: string) {
  return value.startsWith('*.') ? validDNSSubdomain(value.slice(2)) : validDNSSubdomain(value);
}

function validReferenceName(value: string) {
  return validDNSSubdomain(value);
}

function validKind(value: string) {
  return value.length > 0 && value.length <= 63 && /^[A-Za-z][A-Za-z0-9]*$/.test(value);
}

function validIANAServiceName(value: string) {
  return value.length <= 15 && /[a-z]/.test(value) && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value);
}

function validPortNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function validDNSSubdomain(value: string) {
  return value.length > 0 && value.length <= 253 && value === value.toLowerCase() && value.split('.').every((part) => part.length <= 63 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(part));
}

function optionalString(value: unknown): string | null {
  return value == null ? '' : typeof value === 'string' ? value : null;
}

function recordArray(value: unknown, limit: number, allowEmpty = true): Record<string, unknown>[] | null {
  if (value == null) {
    return allowEmpty ? [] : null;
  }
  return Array.isArray(value) && value.length <= limit && (allowEmpty || value.length > 0) && value.every(isRecord) ? value : null;
}

function stringArray(value: unknown, limit: number): string[] | null {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) && value.length <= limit && value.every((item): item is string => typeof item === 'string') ? value : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function limitedSummary(values: string[], limit: number, fallback: string) {
  if (values.length === 0) {
    return fallback;
  }
  return values.length <= limit ? values.join(', ') : `${values.slice(0, limit).join(', ')} +${values.length - limit}`;
}
