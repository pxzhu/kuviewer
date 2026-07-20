import type { SummaryValue } from '../../types/topology';
import { isRecord, readAt, type KubeObject } from './kubernetesObject.ts';
import { validSelectorKey, validSelectorValue } from './labelSelector.ts';

const maxServicePorts = 256;
const maxServiceClusterIPs = 2;
const maxServiceSelectorLabels = 64;

type ServiceType = 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName';
type IPFamily = 'IPv4' | 'IPv6';
type IPFamilyPolicy = 'SingleStack' | 'PreferDualStack' | 'RequireDualStack';

interface ParsedServiceSpec {
  type: ServiceType;
  clusterIP: string;
  clusterIPs: string[];
  ipFamilies: IPFamily[];
  ipFamilyPolicy: IPFamilyPolicy;
  externalName: string;
  selector: Record<string, string>;
  ports: ParsedServicePort[];
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
  return { type, clusterIP, clusterIPs, ipFamilies, ipFamilyPolicy, externalName, selector, ports };
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

function optionalStringArray(value: unknown): string[] | null {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string') ? value : null;
}
