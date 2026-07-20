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
    selector: '1 labels',
  });
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
    selector: { 'bad key': 'value' },
    ports: [{ port: -1, targetPort: { name: 'remote-value' }, nodePort: -1, appProtocol: 'bad key' }],
  });
  assert.equal(uploadServiceSpecIsValid(malformed), false);
  assert.equal(uploadServiceSupportsSelectorInference(malformed), false);
  assert.equal(uploadServiceSelector(malformed), null);
  const encoded = JSON.stringify(uploadServiceSummary(malformed));
  assert.doesNotMatch(encoded, /remote-value|UnsafeFamily|InjectedPolicy/);
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
    selector: 'invalid',
  });
});

test('upload Service schema fails closed for dual-stack, duplicate port, and oversized selector input', () => {
  const fixtures: KubeObject[] = [
    serviceObject({ clusterIP: '10.0.0.8', clusterIPs: ['10.0.0.9'], ipFamilies: ['IPv4'] }),
    serviceObject({ clusterIP: '10.0.0.8', clusterIPs: ['10.0.0.8', '10.0.0.9'], ipFamilies: ['IPv4', 'IPv4'], ipFamilyPolicy: 'PreferDualStack' }),
    serviceObject({ clusterIP: '10.0.0.8', clusterIPs: ['10.0.0.8', '2001:0db8::8'], ipFamilies: ['IPv4', 'IPv6'], ipFamilyPolicy: 'PreferDualStack' }),
    serviceObject({ ports: [{ name: 'http', port: 80 }, { name: 'http-alt', protocol: 'TCP', port: 80 }] }),
    serviceObject({ selector: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key-${index}`, 'value'])) }),
  ];
  fixtures.forEach((fixture) => assert.equal(uploadServiceSpecIsValid(fixture), false));
});

test('upload ExternalName Service never infers Pod selector relations', () => {
  const service = serviceObject({
    type: 'ExternalName',
    externalName: 'api.example.com',
    selector: { app: 'api' },
  });
  assert.equal(uploadServiceSpecIsValid(service), true);
  assert.equal(uploadServiceSupportsSelectorInference(service), false);
  assert.equal(uploadServiceSummary(service).externalName, 'api.example.com');
  assert.equal(uploadServiceSummary(service).ipFamilyPolicy, 'unset');
});

function serviceObject(spec: Record<string, unknown>): KubeObject {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: 'api', namespace: 'app' },
    spec,
  };
}
