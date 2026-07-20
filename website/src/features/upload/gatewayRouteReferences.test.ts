import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gatewayHosts,
  gatewayRouteBackendServices,
  gatewayRouteParentGateways,
  grpcRouteMethods,
  isGatewayRouteKind,
  uploadGatewayRouteSpecIsValid,
  uploadGatewayRouteStatus,
  uploadGatewayRouteSummary,
  uploadGatewaySpecIsValid,
  uploadGatewayStatus,
  uploadGatewaySummary,
} from './gatewayRouteReferences.ts';
import type { KubeObject } from './kubernetesObject.ts';
import { parseKubernetesFiles } from './parseKubernetesFiles.ts';

test('gateway summary validates listeners and exposes address markers without values', () => {
  const gateway: KubeObject = {
    kind: 'Gateway',
    spec: {
      gatewayClassName: 'managed-gateway',
      addresses: [
        { type: 'IPAddress', value: '192.0.2.40' },
        { type: 'NamedAddress', value: 'private-pool' },
      ],
      listeners: [
        { name: 'https', protocol: 'HTTPS', port: 443, hostname: 'api.example.test' },
        { name: 'grpc', protocol: 'example.test/GRPC', port: 8443, hostname: 'grpc.example.test' },
      ],
    },
    status: {
      addresses: [{ type: 'Hostname', value: 'assigned.example.test' }],
      conditions: [{ type: 'Programmed', status: 'True', message: 'credential=must-not-leak' }],
      listeners: [{ name: 'https', attachedRoutes: 2, conditions: [{ type: 'Programmed', status: 'True' }] }],
    },
  };

  assert.equal(uploadGatewaySpecIsValid(gateway), true);
  assert.equal(uploadGatewayStatus(gateway), 'healthy');
  assert.deepEqual(gatewayHosts(gateway), ['api.example.test', 'grpc.example.test']);
  assert.deepEqual(uploadGatewaySummary(gateway), {
    class: 'managed-gateway',
    listeners: 2,
    hosts: 'api.example.test, grpc.example.test',
    requestedAddresses: 2,
    requestedAddressTypes: 'ip:1,hostname:0,named:1,custom:0',
    deprecatedAddresses: 1,
    assignedAddresses: 1,
    assignedAddressTypes: 'ip:0,hostname:1,named:0,custom:0',
    conditions: 'Programmed=True',
    listenerStatuses: 1,
    attachedRoutes: 2,
  });
  const encoded = JSON.stringify(uploadGatewaySummary(gateway));
  assert.doesNotMatch(encoded, /192\.0\.2\.40|private-pool|assigned\.example|credential/);
});

test('gateway validation fails closed for malformed listener, address, or status collections', () => {
  const invalidGateways: KubeObject[] = [
    { kind: 'Gateway', spec: { gatewayClassName: 'managed', listeners: [] } },
    { kind: 'Gateway', spec: { gatewayClassName: 'managed', listeners: [{ name: 'UPPER', protocol: 'HTTP', port: 80 }] } },
    { kind: 'Gateway', spec: { gatewayClassName: 'managed', addresses: [{ type: 'IPAddress', value: 'credential=value' }], listeners: [{ name: 'http', protocol: 'HTTP', port: 80 }] } },
    { kind: 'Gateway', spec: { gatewayClassName: 'managed', listeners: [{ name: 'http', protocol: 'HTTP', port: 80 }] }, status: { conditions: [{ type: 'Ready', status: 'Maybe' }] } },
  ];
  invalidGateways.forEach((gateway, index) => {
    const summary = uploadGatewaySummary(gateway);
    assert.equal(uploadGatewayStatus(gateway), 'warning', `fixture ${index}`);
    assert.equal(index === 3 ? summary.conditions : summary.listeners, 'invalid', `fixture ${index}`);
  });
});

test('gateway route references preserve safe namespace defaults and deduplicate targets', () => {
  const route: KubeObject = {
    kind: 'HTTPRoute',
    metadata: { namespace: 'edge' },
    spec: {
      hostnames: ['api.example.test'],
      parentRefs: [
        { name: 'edge-gateway' },
        { name: 'shared-gateway', namespace: 'infra', group: 'gateway.networking.k8s.io', kind: 'Gateway' },
        { name: 'ignored-service', group: 'core.example.test', kind: 'Service' },
      ],
      rules: [{ backendRefs: [
        { name: 'checkout', port: 8080 },
        { name: 'checkout', port: 8080 },
        { name: 'payments', namespace: 'payments', port: 8443 },
        { name: 'ignored-config', group: 'core.example.test', kind: 'ConfigMap' },
      ] }],
    },
  };

  assert.equal(uploadGatewayRouteSpecIsValid('HTTPRoute', route), true);
  assert.deepEqual(gatewayRouteParentGateways(route, 'edge'), [
    { name: 'edge-gateway', namespace: 'edge' },
    { name: 'shared-gateway', namespace: 'infra' },
  ]);
  assert.deepEqual(gatewayRouteBackendServices(route, 'edge'), [
    { name: 'checkout', namespace: 'edge' },
    { name: 'payments', namespace: 'payments' },
  ]);
});

test('gRPC route summary validates methods and safe status conditions', () => {
  const route: KubeObject = {
    kind: 'GRPCRoute',
    metadata: { namespace: 'edge' },
    spec: {
      hostnames: ['grpc.example.test'],
      parentRefs: [{ name: 'public' }],
      rules: [{
        backendRefs: [{ name: 'checkout', port: 8443 }],
        matches: [
          { method: { service: 'checkout.v1.Checkout', method: 'Create' } },
          { method: { service: 'checkout.v1.Checkout' } },
          { method: { method: 'Health' } },
        ],
      }],
    },
    status: { parents: [{ conditions: [{ type: 'Accepted', status: 'True' }, { type: 'ResolvedRefs', status: 'False', message: 'remote detail' }] }] },
  };

  assert.deepEqual(grpcRouteMethods(route), ['Health', 'checkout.v1.Checkout', 'checkout.v1.Checkout/Create']);
  assert.equal(uploadGatewayRouteStatus('GRPCRoute', route), 'warning');
  assert.deepEqual(uploadGatewayRouteSummary('GRPCRoute', route), {
    hosts: 'grpc.example.test', rules: 1, parents: 1, backends: 1,
    methods: 'Health, checkout.v1.Checkout, checkout.v1.Checkout/Create',
    statusParents: 1, acceptedParents: 1, resolvedParents: 0, statusConditions: 2,
  });
  assert.doesNotMatch(JSON.stringify(uploadGatewayRouteSummary('GRPCRoute', route)), /remote detail/);
});

test('gateway route inference fails closed for malformed spec collections', () => {
  const invalidRoutes: KubeObject[] = [
    { kind: 'HTTPRoute', metadata: { namespace: 'edge' }, spec: { parentRefs: [{ name: 'public' }], rules: [{ backendRefs: [{ name: 'api' }] }] } },
    { kind: 'GRPCRoute', metadata: { namespace: 'edge' }, spec: { parentRefs: [{ name: 'public' }], rules: [{ backendRefs: [{ name: 'api', port: 80 }], matches: [{ method: { service: 'bad service' } }] }] } },
    { kind: 'TCPRoute', metadata: { namespace: 'edge' }, spec: { hostnames: ['not-allowed.example.test'], rules: [{ backendRefs: [{ name: 'api', port: 80 }] }] } },
    { kind: 'TLSRoute', metadata: { namespace: 'edge' }, spec: { parentRefs: [null], rules: [{ backendRefs: [{ name: 'api', port: 443 }] }] } },
  ];
  invalidRoutes.forEach((route, index) => {
    const kind = route.kind as 'HTTPRoute' | 'GRPCRoute' | 'TLSRoute' | 'TCPRoute';
    assert.equal(uploadGatewayRouteSpecIsValid(kind, route), false, `fixture ${index}`);
    assert.deepEqual(gatewayRouteParentGateways(route, 'edge'), [], `fixture ${index}`);
    assert.deepEqual(gatewayRouteBackendServices(route, 'edge'), [], `fixture ${index}`);
    assert.equal(uploadGatewayRouteSummary(kind, route).rules, 'invalid', `fixture ${index}`);
  });
});

test('gateway route kind classification remains explicit and fail closed', () => {
  assert.equal(isGatewayRouteKind('HTTPRoute'), true);
  assert.equal(isGatewayRouteKind('GRPCRoute'), true);
  assert.equal(isGatewayRouteKind('TLSRoute'), true);
  assert.equal(isGatewayRouteKind('TCPRoute'), true);
  assert.equal(isGatewayRouteKind('Ingress'), false);
});

test('upload topology keeps malformed routes visible without unsafe placeholder edges', async () => {
  const manifest = `
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: valid
  namespace: edge
spec:
  parentRefs:
    - name: public
  rules:
    - backendRefs:
        - name: api
          port: 80
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: invalid
  namespace: edge
spec:
  parentRefs:
    - name: private
  rules:
    - backendRefs:
        - name: credential-backend
`;
  const file = { name: 'routes.yaml', text: async () => manifest } as File;
  const result = await parseKubernetesFiles([file], { clusterId: 'upload', clusterName: 'Upload' });
  const invalidNode = result.snapshot.nodes.find((node) => node.kind === 'HTTPRoute' && node.name === 'invalid');
  assert.equal(invalidNode?.status, 'warning');
  assert.equal(invalidNode?.summary.backends, 'invalid');
  assert.equal(result.snapshot.edges.filter((edge) => edge.type === 'routes-to').length, 1);
  assert.equal(result.snapshot.nodes.some((node) => node.name === 'credential-backend'), false);
  assert.equal(result.snapshot.nodes.some((node) => node.name === 'private'), false);
  assert.doesNotMatch(JSON.stringify(invalidNode?.summary), /credential-backend|private/);
});
