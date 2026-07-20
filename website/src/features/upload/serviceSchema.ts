import type { SummaryValue } from '../../types/topology';
import { isRecord, readAt, type KubeObject } from './kubernetesObject.ts';
import { validSelectorKey, validSelectorValue } from './labelSelector.ts';

const maxServicePorts = 256;
const maxServiceClusterIPs = 2;
const maxServiceExternalIPs = 16;
const maxServiceSourceRanges = 64;
const maxServiceSelectorLabels = 64;
const maxSessionAffinitySeconds = 86400;

type ServiceType = 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName';
type IPFamily = 'IPv4' | 'IPv6';
type IPFamilyPolicy = 'SingleStack' | 'PreferDualStack' | 'RequireDualStack';
type TrafficPolicy = 'Cluster' | 'Local';
type SessionAffinity = 'None' | 'ClientIP';
type TrafficDistribution = 'default' | 'PreferSameZone' | 'PreferSameNode' | 'PreferClose';

interface ParsedServiceSpec {
  type: ServiceType;
  clusterIP: string;
  clusterIPs: string[];
  ipFamilies: IPFamily[];
  ipFamilyPolicy: IPFamilyPolicy;
  externalName: string;
  selector: Record<string, string>;
  ports: ParsedServicePort[];
  internalTrafficPolicy: TrafficPolicy;
  externalTrafficPolicy: TrafficPolicy;
  healthCheckNodePort: number;
  loadBalancerClass: string;
  allocateLoadBalancerNodePorts: boolean | null;
  sessionAffinity: SessionAffinity;
  sessionAffinityTimeout: number | null;
  externalIPs: string[];
  loadBalancerSourceRanges: string[];
  trafficDistribution: TrafficDistribution;
  deprecatedLoadBalancerIPConfigured: boolean;
}

interface ParsedServicePort {
  targetPortSet: boolean;
  nodePortSet: boolean;
  appProtocolSet: boolean;
}

export function uploadServiceSpecIsValid(object: KubeObject) {
  return parseServiceSpec(object) !== null;
}

export function uploadServiceSupportsSelectorInference(object: KubeObject) {
  const spec = parseServiceSpec(object);
  return spec !== null && spec.type !== 'ExternalName' && Object.keys(spec.selector).length > 0;
}

export function uploadServiceSelector(object: KubeObject) {
  return parseServiceSpec(object)?.selector ?? null;
}

export function uploadServiceSummary(object: KubeObject): Record<string, SummaryValue> {
  const spec = parseServiceSpec(object);
  if (!spec) {
    return {
      type: 'invalid',
      clusterIP: 'invalid',
      clusterIPs: 'invalid',
      ipFamilies: 'invalid',
      ipFamilyPolicy: 'invalid',
      ports: 'invalid',
      targetPorts: 'invalid',
      nodePorts: 'invalid',
      appProtocols: 'invalid',
      internalTrafficPolicy: 'invalid',
      externalTrafficPolicy: 'invalid',
      healthCheckNodePort: 'invalid',
      loadBalancerClass: 'invalid',
      allocateLoadBalancerNodePorts: 'invalid',
      sessionAffinity: 'invalid',
      sessionAffinityTimeout: 'invalid',
      externalIPs: 'invalid',
      externalIPsDeprecated: 'invalid',
      loadBalancerSourceRanges: 'invalid',
      trafficDistribution: 'invalid',
      trafficDistributionDeprecated: 'invalid',
      deprecatedLoadBalancerIP: 'invalid',
      selector: 'invalid',
    };
  }
  const summary: Record<string, SummaryValue> = {
    type: spec.type,
    clusterIP: spec.clusterIP || 'unset',
    clusterIPs: spec.clusterIPs.length,
    ipFamilies: spec.ipFamilies.join(',') || 'unset',
    ipFamilyPolicy: spec.type === 'ExternalName' ? 'unset' : spec.ipFamilyPolicy,
    ports: spec.ports.length,
    targetPorts: spec.ports.filter((port) => port.targetPortSet).length,
    nodePorts: spec.ports.filter((port) => port.nodePortSet).length,
    appProtocols: spec.ports.filter((port) => port.appProtocolSet).length,
    internalTrafficPolicy: spec.type === 'ExternalName' ? 'unset' : spec.internalTrafficPolicy,
    externalTrafficPolicy: spec.type === 'ExternalName' ? 'unset' : spec.externalTrafficPolicy,
    healthCheckNodePort: spec.healthCheckNodePort || 'unset',
    loadBalancerClass: spec.type !== 'LoadBalancer' ? 'unset' : spec.loadBalancerClass || 'default',
    allocateLoadBalancerNodePorts: spec.type !== 'LoadBalancer' ? 'unset' : spec.allocateLoadBalancerNodePorts ?? true,
    sessionAffinity: spec.type === 'ExternalName' ? 'unset' : spec.sessionAffinity,
    sessionAffinityTimeout: spec.sessionAffinity === 'ClientIP' ? spec.sessionAffinityTimeout ?? 10800 : 'unset',
    externalIPs: spec.externalIPs.length,
    externalIPsDeprecated: spec.externalIPs.length > 0,
    loadBalancerSourceRanges: spec.loadBalancerSourceRanges.length,
    trafficDistribution: spec.type === 'ExternalName' ? 'unset' : spec.trafficDistribution,
    trafficDistributionDeprecated: spec.type !== 'ExternalName' && spec.trafficDistribution === 'PreferClose',
    deprecatedLoadBalancerIP: spec.type === 'LoadBalancer' && spec.deprecatedLoadBalancerIPConfigured ? 'configured' : 'unset',
    selector: Object.keys(spec.selector).length > 0 ? `${Object.keys(spec.selector).length} labels` : 'none',
  };
  if (spec.type === 'ExternalName') {
    summary.externalName = spec.externalName;
  }
  return summary;
}

function parseServiceSpec(object: KubeObject): ParsedServiceSpec | null {
  const spec = readAt(object, ['spec']);
  if (!isRecord(spec)) {
    return null;
  }
  const type = parseServiceType(spec.type);
  const clusterIP = optionalString(spec.clusterIP);
  const clusterIPs = optionalStringArray(spec.clusterIPs);
  const ipFamilies = parseIPFamilies(spec.ipFamilies);
  const ipFamilyPolicy = parseIPFamilyPolicy(spec.ipFamilyPolicy);
  const externalName = optionalString(spec.externalName);
  const selector = parseServiceSelector(spec.selector);
  if (!type || clusterIP === null || clusterIPs === null || ipFamilies === null || !ipFamilyPolicy || externalName === null || selector === null) {
    return null;
  }
  if (!validServiceIPConfiguration(type, clusterIP, clusterIPs, ipFamilies, ipFamilyPolicy, spec.ipFamilyPolicy)) {
    return null;
  }
  if (type === 'ExternalName' ? !validDNSSubdomain(externalName) : externalName !== '') {
    return null;
  }
  const ports = parseServicePorts(type, spec.ports);
  if (!ports) {
    return null;
  }
  const traffic = parseServiceTrafficConfiguration(type, spec);
  const session = parseServiceSessionAffinity(type, spec);
  const exposure = parseServiceExposureConfiguration(type, spec);
  if (!traffic || !session || !exposure) {
    return null;
  }
  return { type, clusterIP, clusterIPs, ipFamilies, ipFamilyPolicy, externalName, selector, ports, ...traffic, ...session, ...exposure };
}

function parseServiceExposureConfiguration(type: ServiceType, spec: Record<string, unknown>) {
  const externalIPs = parseCanonicalIPList(spec.externalIPs, maxServiceExternalIPs);
  const loadBalancerSourceRanges = parseCanonicalCIDRList(spec.loadBalancerSourceRanges, maxServiceSourceRanges);
  const trafficDistribution = parseTrafficDistribution(spec.trafficDistribution);
  const deprecatedLoadBalancerIPConfigured = parseDeprecatedLoadBalancerIP(spec.loadBalancerIP);
  if (!externalIPs || !loadBalancerSourceRanges || !trafficDistribution || deprecatedLoadBalancerIPConfigured === null) {
    return null;
  }
  if (type === 'ExternalName') {
    return loadBalancerSourceRanges.length === 0 && trafficDistribution === 'default' && !deprecatedLoadBalancerIPConfigured
      ? { externalIPs, loadBalancerSourceRanges, trafficDistribution, deprecatedLoadBalancerIPConfigured }
      : null;
  }
  if (type !== 'LoadBalancer' && (loadBalancerSourceRanges.length > 0 || deprecatedLoadBalancerIPConfigured)) {
    return null;
  }
  return { externalIPs, loadBalancerSourceRanges, trafficDistribution, deprecatedLoadBalancerIPConfigured };
}

function parseCanonicalIPList(value: unknown, limit: number): string[] | null {
  const values = optionalStringArray(value);
  if (!values || values.length > limit) {
    return null;
  }
  const seen = new Set<string>();
  for (const address of values) {
    if (!addressFamily(address) || seen.has(address)) {
      return null;
    }
    seen.add(address);
  }
  return values;
}

function parseCanonicalCIDRList(value: unknown, limit: number): string[] | null {
  const values = optionalStringArray(value);
  if (!values || values.length > limit) {
    return null;
  }
  const seen = new Set<string>();
  for (const cidr of values) {
    if (!validCanonicalCIDR(cidr) || seen.has(cidr)) {
      return null;
    }
    seen.add(cidr);
  }
  return values;
}

function validCanonicalCIDR(value: string) {
  const separator = value.lastIndexOf('/');
  if (separator <= 0 || separator === value.length - 1 || value.indexOf('/') !== separator) {
    return false;
  }
  const address = value.slice(0, separator);
  const prefixText = value.slice(separator + 1);
  const family = addressFamily(address);
  if (!family || !/^(?:0|[1-9]\d{0,2})$/.test(prefixText)) {
    return false;
  }
  const prefix = Number(prefixText);
  return prefix <= (family === 'IPv4' ? 32 : 128);
}

function parseTrafficDistribution(value: unknown): TrafficDistribution | null {
  if (value == null || value === '') {
    return 'default';
  }
  return value === 'PreferSameZone' || value === 'PreferSameNode' || value === 'PreferClose' ? value : null;
}

function parseDeprecatedLoadBalancerIP(value: unknown): boolean | null {
  if (value == null || value === '') {
    return false;
  }
  return typeof value === 'string' && addressFamily(value) ? true : null;
}

function parseServiceTrafficConfiguration(type: ServiceType, spec: Record<string, unknown>) {
  const internalTrafficPolicy = parseTrafficPolicy(spec.internalTrafficPolicy);
  const externalTrafficPolicy = parseTrafficPolicy(spec.externalTrafficPolicy);
  const healthCheckNodePort = optionalPortNumber(spec.healthCheckNodePort);
  const loadBalancerClass = optionalString(spec.loadBalancerClass);
  const allocateLoadBalancerNodePorts = optionalBoolean(spec.allocateLoadBalancerNodePorts);
  if (!internalTrafficPolicy || !externalTrafficPolicy || healthCheckNodePort === null || loadBalancerClass === null || allocateLoadBalancerNodePorts === undefined) {
    return null;
  }
  if (type === 'ExternalName') {
    return isUnsetStringField(spec.internalTrafficPolicy) && isUnsetStringField(spec.externalTrafficPolicy) && healthCheckNodePort === 0 && loadBalancerClass === '' && allocateLoadBalancerNodePorts === null
      ? { internalTrafficPolicy, externalTrafficPolicy, healthCheckNodePort, loadBalancerClass, allocateLoadBalancerNodePorts }
      : null;
  }
  if (type !== 'LoadBalancer' && (loadBalancerClass !== '' || allocateLoadBalancerNodePorts !== null)) {
    return null;
  }
  if (loadBalancerClass !== '' && !validSelectorKey(loadBalancerClass)) {
    return null;
  }
  if (healthCheckNodePort > 0 && (type !== 'LoadBalancer' || externalTrafficPolicy !== 'Local')) {
    return null;
  }
  if (healthCheckNodePort > 0 && serviceHealthCheckNodePortConflicts(spec.ports, healthCheckNodePort)) {
    return null;
  }
  return { internalTrafficPolicy, externalTrafficPolicy, healthCheckNodePort, loadBalancerClass, allocateLoadBalancerNodePorts };
}

function serviceHealthCheckNodePortConflicts(value: unknown, healthCheckNodePort: number) {
  return Array.isArray(value) && value.some((port) => isRecord(port)
    && (port.protocol == null || port.protocol === '' || port.protocol === 'TCP')
    && port.nodePort === healthCheckNodePort);
}

function parseServiceSessionAffinity(type: ServiceType, spec: Record<string, unknown>) {
  const sessionAffinity = parseSessionAffinity(spec.sessionAffinity);
  if (!sessionAffinity) {
    return null;
  }
  if (type === 'ExternalName') {
    return (isUnsetStringField(spec.sessionAffinity) || spec.sessionAffinity === 'None') && spec.sessionAffinityConfig == null
      ? { sessionAffinity, sessionAffinityTimeout: null }
      : null;
  }
  if (sessionAffinity === 'None') {
    return spec.sessionAffinityConfig == null ? { sessionAffinity, sessionAffinityTimeout: null } : null;
  }
  const config = spec.sessionAffinityConfig;
  if (config == null) {
    return { sessionAffinity, sessionAffinityTimeout: null };
  }
  if (!isRecord(config) || (config.clientIP != null && !isRecord(config.clientIP))) {
    return null;
  }
  const timeout = isRecord(config.clientIP) ? config.clientIP.timeoutSeconds : undefined;
  if (timeout == null) {
    return { sessionAffinity, sessionAffinityTimeout: null };
  }
  return typeof timeout === 'number' && Number.isInteger(timeout) && timeout > 0 && timeout <= maxSessionAffinitySeconds
    ? { sessionAffinity, sessionAffinityTimeout: timeout }
    : null;
}

function parseTrafficPolicy(value: unknown): TrafficPolicy | null {
  if (value == null || value === '') {
    return 'Cluster';
  }
  return value === 'Cluster' || value === 'Local' ? value : null;
}

function parseSessionAffinity(value: unknown): SessionAffinity | null {
  if (value == null || value === '') {
    return 'None';
  }
  return value === 'None' || value === 'ClientIP' ? value : null;
}

function parseServiceType(value: unknown): ServiceType | null {
  if (value == null || value === '') {
    return 'ClusterIP';
  }
  return value === 'ClusterIP' || value === 'NodePort' || value === 'LoadBalancer' || value === 'ExternalName'
    ? value
    : null;
}

function parseIPFamilyPolicy(value: unknown): IPFamilyPolicy | null {
  if (value == null || value === '') {
    return 'SingleStack';
  }
  return value === 'SingleStack' || value === 'PreferDualStack' || value === 'RequireDualStack'
    ? value
    : null;
}

function parseIPFamilies(value: unknown): IPFamily[] | null {
  const values = optionalStringArray(value);
  if (!values || values.length > maxServiceClusterIPs) {
    return null;
  }
  const families: IPFamily[] = [];
  for (const family of values) {
    if ((family !== 'IPv4' && family !== 'IPv6') || families.includes(family)) {
      return null;
    }
    families.push(family);
  }
  return families;
}

function validServiceIPConfiguration(
  type: ServiceType,
  clusterIP: string,
  clusterIPs: string[],
  ipFamilies: IPFamily[],
  policy: IPFamilyPolicy,
  rawPolicy: unknown,
) {
  if (type === 'ExternalName') {
    return clusterIP === '' && clusterIPs.length === 0 && ipFamilies.length === 0 && (rawPolicy == null || rawPolicy === '');
  }
  if (!validClusterIP(type, clusterIP) || clusterIPs.length > maxServiceClusterIPs) {
    return false;
  }
  if (clusterIPs.length > 0 && (clusterIP === '' || clusterIPs[0] !== clusterIP)) {
    return false;
  }
  if (clusterIP === 'None') {
    if (clusterIPs.length > 0 && (clusterIPs.length !== 1 || clusterIPs[0] !== 'None')) {
      return false;
    }
  } else if (!validClusterIPList(clusterIPs)) {
    return false;
  }
  if (!ipFamiliesMatch(clusterIP, clusterIPs, ipFamilies)) {
    return false;
  }
  if (policy === 'SingleStack' && (clusterIPs.length > 1 || ipFamilies.length > 1)) {
    return false;
  }
  if (policy === 'RequireDualStack' && (clusterIPs.length > 0 || ipFamilies.length > 0)) {
    return clusterIP === 'None'
      ? clusterIPs.length === 1 && ipFamilies.length === 2
      : clusterIPs.length === 2 && ipFamilies.length === 2;
  }
  return true;
}

function validClusterIP(type: ServiceType, value: string) {
  if (type === 'ExternalName') {
    return value === '';
  }
  if (value === '') {
    return true;
  }
  if (value === 'None') {
    return type === 'ClusterIP';
  }
  return addressFamily(value) !== null;
}

function validClusterIPList(values: string[]) {
  const addresses = new Set<string>();
  const families = new Set<IPFamily>();
  for (const value of values) {
    const family = addressFamily(value);
    if (!family || addresses.has(value) || families.has(family)) {
      return false;
    }
    addresses.add(value);
    families.add(family);
  }
  return true;
}

function ipFamiliesMatch(clusterIP: string, clusterIPs: string[], families: IPFamily[]) {
  if (clusterIP === 'None' || families.length === 0) {
    return true;
  }
  const addresses = clusterIPs.length > 0 ? clusterIPs : clusterIP ? [clusterIP] : [];
  if (addresses.length === 0) {
    return true;
  }
  return addresses.length === families.length && addresses.every((value, index) => addressFamily(value) === families[index]);
}

function addressFamily(value: string): IPFamily | null {
  if (/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) {
    return value.split('.').every((part) => Number(part) <= 255) ? 'IPv4' : null;
  }
  if (!value.includes(':') || value !== value.toLowerCase()) {
    return null;
  }
  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    return hostname === `[${value}]` ? 'IPv6' : null;
  } catch {
    return null;
  }
}

function parseServiceSelector(value: unknown): Record<string, string> | null {
  if (value == null) {
    return {};
  }
  if (!isRecord(value)) {
    return null;
  }
  const entries = Object.entries(value);
  if (entries.length > maxServiceSelectorLabels) {
    return null;
  }
  const selector: Record<string, string> = {};
  for (const [key, labelValue] of entries) {
    if (!validSelectorKey(key) || !validSelectorValue(labelValue)) {
      return null;
    }
    selector[key] = labelValue;
  }
  return selector;
}

function parseServicePorts(type: ServiceType, value: unknown): ParsedServicePort[] | null {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > maxServicePorts || !value.every(isRecord)) {
    return null;
  }
  const names = new Set<string>();
  const ports = new Set<string>();
  const nodePorts = new Set<string>();
  const parsed: ParsedServicePort[] = [];
  for (const port of value) {
    const portNumber = port.port;
    const protocol = port.protocol == null || port.protocol === '' ? 'TCP' : port.protocol;
    const name = optionalString(port.name);
    const targetPort = parseTargetPort(port.targetPort);
    const nodePort = parseNodePort(type, port.nodePort);
    const appProtocol = optionalString(port.appProtocol);
    if (!validPortNumber(portNumber) || (protocol !== 'TCP' && protocol !== 'UDP' && protocol !== 'SCTP') || name === null || !targetPort || !nodePort || appProtocol === null || !validAppProtocol(appProtocol)) {
      return null;
    }
    if ((value.length > 1 && name === '') || (name !== '' && (!validDNSLabel(name) || names.has(name)))) {
      return null;
    }
    const portKey = `${protocol}/${portNumber}`;
    const nodePortKey = `${protocol}/${nodePort.value}`;
    if (ports.has(portKey) || nodePort.set && nodePorts.has(nodePortKey)) {
      return null;
    }
    if (name) {
      names.add(name);
    }
    ports.add(portKey);
    if (nodePort.set) {
      nodePorts.add(nodePortKey);
    }
    parsed.push({ targetPortSet: targetPort.set, nodePortSet: nodePort.set, appProtocolSet: appProtocol !== '' });
  }
  return parsed;
}

function parseTargetPort(value: unknown): { set: boolean } | null {
  if (value === undefined) {
    return { set: false };
  }
  if (validPortNumber(value)) {
    return { set: true };
  }
  return typeof value === 'string' && validIANAServiceName(value) ? { set: true } : null;
}

function parseNodePort(type: ServiceType, value: unknown): { set: boolean; value: number } | null {
  if (value == null || value === 0) {
    return { set: false, value: 0 };
  }
  if (!validPortNumber(value) || type === 'ClusterIP' || type === 'ExternalName') {
    return null;
  }
  return { set: true, value };
}

function validPortNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function optionalPortNumber(value: unknown): number | null {
  if (value == null || value === 0) {
    return 0;
  }
  return validPortNumber(value) ? value : null;
}

function optionalBoolean(value: unknown): boolean | null | undefined {
  if (value == null) {
    return null;
  }
  return typeof value === 'boolean' ? value : undefined;
}

function validIANAServiceName(value: string) {
  return value.length <= 15 && /[a-z]/.test(value) && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value);
}

function validAppProtocol(value: string) {
  return value === '' || validSelectorKey(value);
}

function validDNSLabel(value: string) {
  return value.length <= 63 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(value);
}

function validDNSSubdomain(value: string) {
  return value.length > 0 && value.length <= 253 && value.split('.').every(validDNSLabel);
}

function optionalString(value: unknown): string | null {
  return value == null ? '' : typeof value === 'string' ? value : null;
}

function isUnsetStringField(value: unknown) {
  return value == null || value === '';
}

function optionalStringArray(value: unknown): string[] | null {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string') ? value : null;
}
