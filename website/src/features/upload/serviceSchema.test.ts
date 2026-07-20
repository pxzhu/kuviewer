import assert from 'node:assert/strict';
import test from 'node:test';
import type { KubeObject } from './kubernetesObject.ts';
import {
  uploadServiceSelector,
  uploadServiceSpecIsValid,
  uploadServiceSummary,
  uploadServiceSupportsSelectorInference,
} from './serviceSchema.ts';

test('upload Service schema accepts canonical dual-stack metadata and emits bounded summaries', () => {
  const service = serviceObject({
    type: 'ClusterIP',
    clusterIP: '10.0.0.8',
    clusterIPs: ['10.0.0.8', '2001:db8::8'],
    ipFamilies: ['IPv4', 'IPv6'],
    ipFamilyPolicy: 'RequireDualStack',
    selector: { app: 'api' },
    ports: [
      { name: 'http', protocol: 'TCP', port: 80, targetPort: 'http-web', appProtocol: 'kubernetes.io/h2c' },
      { name: 'dns', protocol: 'UDP', port: 53, targetPort: 5353 },
    ],
  });

  assert.equal(uploadServiceSpecIsValid(service), true);
  assert.equal(uploadServiceSupportsSelectorInference(service), true);
  assert.deepEqual(uploadServiceSelector(service), { app: 'api' });
  assert.deepEqual(uploadServiceSummary(service), {
    type: 'ClusterIP',
    clusterIP: '10.0.0.8',
    clusterIPs: 2,
    ipFamilies: 'IPv4,IPv6',
    ipFamilyPolicy: 'RequireDualStack',
    ports: 2,
    targetPorts: 2,
    nodePorts: 0,
    appProtocols: 1,
    internalTrafficPolicy: 'Cluster',
    externalTrafficPolicy: 'Cluster',
    healthCheckNodePort: 'unset',
    loadBalancerClass: 'unset',
    allocateLoadBalancerNodePorts: 'unset',
    sessionAffinity: 'None',
    sessionAffinityTimeout: 'unset',
    externalIPs: 0,
    externalIPsDeprecated: false,
    loadBalancerSourceRanges: 0,
    trafficDistribution: 'default',
    trafficDistributionDeprecated: false,
    deprecatedLoadBalancerIP: 'unset',
    selector: '1 labels',
  });
});

test('upload Service schema validates traffic policy, load balancer, and session affinity fields', () => {
  const service = serviceObject({
    type: 'LoadBalancer',
    internalTrafficPolicy: 'Local',
    externalTrafficPolicy: 'Local',
    healthCheckNodePort: 30081,
    loadBalancerClass: 'example.com/internal',
    allocateLoadBalancerNodePorts: false,
    sessionAffinity: 'ClientIP',
    sessionAffinityConfig: { clientIP: { timeoutSeconds: 10800 } },
    ports: [{ port: 443 }],
  });
  assert.equal(uploadServiceSpecIsValid(service), true);
  assert.deepEqual(uploadServiceSummary(service), {
    type: 'LoadBalancer',
    clusterIP: 'unset',
    clusterIPs: 0,
    ipFamilies: 'unset',
    ipFamilyPolicy: 'SingleStack',
    ports: 1,
    targetPorts: 0,
    nodePorts: 0,
    appProtocols: 0,
    internalTrafficPolicy: 'Local',
    externalTrafficPolicy: 'Local',
    healthCheckNodePort: 30081,
    loadBalancerClass: 'example.com/internal',
    allocateLoadBalancerNodePorts: false,
    sessionAffinity: 'ClientIP',
    sessionAffinityTimeout: 10800,
    externalIPs: 0,
    externalIPsDeprecated: false,
    loadBalancerSourceRanges: 0,
    trafficDistribution: 'default',
    trafficDistributionDeprecated: false,
    deprecatedLoadBalancerIP: 'unset',
    selector: 'none',
  });

  const invalidSpecs = [
    { type: 'ClusterIP', loadBalancerClass: 'internal' },
    { type: 'ClusterIP', allocateLoadBalancerNodePorts: false },
    { type: 'ClusterIP', healthCheckNodePort: 30081 },
    { type: 'LoadBalancer', externalTrafficPolicy: 'Cluster', healthCheckNodePort: 30081 },
    { type: 'LoadBalancer', externalTrafficPolicy: 'Local', healthCheckNodePort: 30081, ports: [{ port: 443, nodePort: 30081 }] },
    { type: 'LoadBalancer', loadBalancerClass: 'bad key' },
    { internalTrafficPolicy: 'Nearest' },
    { sessionAffinity: 'Cookie' },
    { sessionAffinity: 'None', sessionAffinityConfig: {} },
    { sessionAffinity: 'ClientIP', sessionAffinityConfig: { clientIP: { timeoutSeconds: 0 } } },
    { sessionAffinity: 'ClientIP', sessionAffinityConfig: { clientIP: { timeoutSeconds: 86401 } } },
  ];
  invalidSpecs.forEach((spec) => assert.equal(uploadServiceSpecIsValid(serviceObject(spec)), false));
});

test('upload Service schema summarizes external exposure without retaining address values', () => {
  const service = serviceObject({
    type: 'LoadBalancer',
    externalIPs: ['192.0.2.20', '2001:db8::20'],
    loadBalancerSourceRanges: ['192.0.2.0/24', '2001:db8::/64'],
    trafficDistribution: 'PreferSameNode',
    loadBalancerIP: '198.51.100.40',
  });
  assert.equal(uploadServiceSpecIsValid(service), true);
  const summary = uploadServiceSummary(service);
  assert.equal(summary.externalIPs, 2);
  assert.equal(summary.externalIPsDeprecated, true);
  assert.equal(summary.loadBalancerSourceRanges, 2);
  assert.equal(summary.trafficDistribution, 'PreferSameNode');
  assert.equal(summary.trafficDistributionDeprecated, false);
  assert.equal(summary.deprecatedLoadBalancerIP, 'configured');
  assert.doesNotMatch(JSON.stringify(summary), /192\.0\.2\.20|2001:db8::20|198\.51\.100\.40/);

  const deprecatedAlias = uploadServiceSummary(serviceObject({ trafficDistribution: 'PreferClose' }));
  assert.equal(deprecatedAlias.trafficDistribution, 'PreferClose');
  assert.equal(deprecatedAlias.trafficDistributionDeprecated, true);

  const invalidSpecs = [
    { externalIPs: ['192.0.2.20', '192.0.2.20'] },
    { externalIPs: ['192.00.2.20'] },
    { externalIPs: Array.from({ length: 17 }, (_, index) => `192.0.2.${index + 1}`) },
    { type: 'ClusterIP', loadBalancerSourceRanges: ['192.0.2.0/24'] },
    { type: 'LoadBalancer', loadBalancerSourceRanges: ['not-a-cidr'] },
    { type: 'LoadBalancer', loadBalancerSourceRanges: ['192.0.2.0/24', '192.0.2.0/24'] },
    { type: 'LoadBalancer', loadBalancerSourceRanges: Array.from({ length: 65 }, (_, index) => `192.0.${index}.0/24`) },
    { trafficDistribution: 'Spread' },
    { type: 'ExternalName', externalName: 'api.example.com', trafficDistribution: 'PreferSameZone' },
    { type: 'ClusterIP', loadBalancerIP: '198.51.100.40' },
    { type: 'LoadBalancer', loadBalancerIP: 'credential=remote-value' },
  ];
  invalidSpecs.forEach((spec) => assert.equal(uploadServiceSpecIsValid(serviceObject(spec)), false));
});

test('upload Service schema allows API-defaulted NodePort fields but validates explicit values', () => {
  assert.equal(uploadServiceSpecIsValid(serviceObject({ type: 'NodePort', ports: [{ port: 80 }] })), true);
  assert.equal(uploadServiceSpecIsValid(serviceObject({ type: 'NodePort', ports: [{ port: 80, nodePort: 30080 }] })), true);
  assert.equal(uploadServiceSpecIsValid(serviceObject({ type: 'ClusterIP', ports: [{ port: 80, nodePort: 30080 }] })), false);
  assert.equal(uploadServiceSpecIsValid(serviceObject({ type: 'NodePort', ports: [{ port: 80, nodePort: 65536 }] })), false);
  assert.equal(uploadServiceSpecIsValid(serviceObject({ ports: [{ port: 80, targetPort: 'http-web' }] })), true);
  assert.equal(uploadServiceSpecIsValid(serviceObject({ ports: [{ port: 80, targetPort: 'UPPER' }] })), false);
});

test('upload Service schema rejects inconsistent IP and port fields without echoing raw values', () => {
  const malformed = serviceObject({
    type: 'Injected',
    clusterIP: 'token=remote-value',
    clusterIPs: ['credential=remote-value'],
    ipFamilies: ['UnsafeFamily'],
    ipFamilyPolicy: 'InjectedPolicy',
    internalTrafficPolicy: 'InjectedInternal',
    externalTrafficPolicy: 'InjectedExternal',
    sessionAffinity: 'InjectedAffinity',
    healthCheckNodePort: -1,
    loadBalancerClass: 'credential.example.com/private',
    externalIPs: ['credential=remote-value'],
    loadBalancerSourceRanges: ['credential=remote-value'],
    trafficDistribution: 'InjectedDistribution',
    loadBalancerIP: 'credential=remote-value',
    selector: { 'bad key': 'value' },
    ports: [{ port: -1, targetPort: { name: 'remote-value' }, nodePort: -1, appProtocol: 'bad key' }],
  });
  assert.equal(uploadServiceSpecIsValid(malformed), false);
  assert.equal(uploadServiceSupportsSelectorInference(malformed), false);
  assert.equal(uploadServiceSelector(malformed), null);
  const encoded = JSON.stringify(uploadServiceSummary(malformed));
  assert.doesNotMatch(encoded, /remote-value|UnsafeFamily|InjectedPolicy|InjectedInternal|InjectedExternal|InjectedAffinity|credential\.example\.com/);
  assert.deepEqual(uploadServiceSummary(malformed), {
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
  });
});

test('upload Service schema fails closed for dual-stack, duplicate port, and oversized selector input', () => {
  const fixtures: KubeObject[] = [
    serviceObject({ clusterIP: '10.0.0.8', clusterIPs: ['10.0.0.9'], ipFamilies: ['IPv4'] }),
    serviceObject({ clusterIP: '10.0.0.8', clusterIPs: ['10.0.0.8', '10.0.0.9'], ipFamilies: ['IPv4', 'IPv4'], ipFamilyPolicy: 'PreferDualStack' }),
    serviceObject({ clusterIP: '10.0.0.8', clusterIPs: ['10.0.0.8', '2001:0db8::8'], ipFamilies: ['IPv4', 'IPv6'], ipFamilyPolicy: 'PreferDualStack' }),
    serviceObject({ ports: [{ name: 'http', port: 80 }, { name: 'http-alt', protocol: 'TCP', port: 80 }] }),
    serviceObject({ ports: Array.from({ length: 257 }, (_, index) => ({ name: `port-${index}`, port: 80 + index })) }),
    serviceObject({ selector: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key-${index}`, 'value'])) }),
  ];
  fixtures.forEach((fixture) => assert.equal(uploadServiceSpecIsValid(fixture), false));
});

test('upload ExternalName Service never infers Pod selector relations', () => {
  const service = serviceObject({
    type: 'ExternalName',
    externalName: 'api.example.com',
    sessionAffinity: 'None',
    selector: { app: 'api' },
  });
  assert.equal(uploadServiceSpecIsValid(service), true);
  assert.equal(uploadServiceSupportsSelectorInference(service), false);
  assert.equal(uploadServiceSummary(service).externalName, 'api.example.com');
  assert.equal(uploadServiceSummary(service).ipFamilyPolicy, 'unset');
  assert.equal(uploadServiceSummary(service).sessionAffinity, 'unset');
  assert.equal(uploadServiceSummary(service).internalTrafficPolicy, 'unset');
});

function serviceObject(spec: Record<string, unknown>): KubeObject {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: 'api', namespace: 'app' },
    spec,
  };
}
