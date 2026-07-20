import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gatewayHosts,
  gatewayRouteBackendServices,
  gatewayRouteParentGateways,
  grpcRouteMethods,
  isGatewayRouteKind,
} from './gatewayRouteReferences.ts';
import type { KubeObject } from './kubernetesObject.ts';

test('gateway route references preserve safe namespace defaults and deduplicate targets', () => {
  const route: KubeObject = {
    spec: {
      parentRefs: [
        { name: 'edge-gateway' },
        { name: 'shared-gateway', namespace: 'infra', group: 'gateway.networking.k8s.io', kind: 'Gateway' },
        { name: 'ignored-service', kind: 'Service' },
      ],
      rules: [
        {
          backendRefs: [
            { name: 'checkout' },
            { name: 'checkout' },
            { name: 'payments', namespace: 'payments' },
            { name: 'ignored-config', kind: 'ConfigMap' },
            { name: 'ignored-external', group: 'example.com', kind: 'Service' },
          ],
        },
      ],
    },
  };

  assert.deepEqual(gatewayRouteParentGateways(route, 'edge'), [
    { name: 'edge-gateway', namespace: 'edge' },
    { name: 'shared-gateway', namespace: 'infra' },
  ]);
  assert.deepEqual(gatewayRouteBackendServices(route, 'edge'), [
    { name: 'checkout', namespace: 'edge' },
    { name: 'payments', namespace: 'payments' },
  ]);
});

test('gRPC methods and Gateway hosts are unique, sorted, and omit malformed values', () => {
  const route: KubeObject = {
    spec: {
      listeners: [
        { hostname: 'z.example.test' },
        { hostname: 'a.example.test' },
        { hostname: 'z.example.test' },
        { hostname: 42 },
      ],
      rules: [
        {
          matches: [
            { method: { service: 'checkout.v1.Checkout', method: 'Create' } },
            { method: { service: 'checkout.v1.Checkout', method: 'Create' } },
            { method: { service: 'checkout.v1.Checkout' } },
            { method: { method: 'Health' } },
            { method: null },
          ],
        },
      ],
    },
  };

  assert.deepEqual(gatewayHosts(route), ['a.example.test', 'z.example.test']);
  assert.deepEqual(grpcRouteMethods(route), ['Health', 'checkout.v1.Checkout', 'checkout.v1.Checkout/Create']);
});

test('gateway route kind classification remains explicit and fail closed', () => {
  assert.equal(isGatewayRouteKind('HTTPRoute'), true);
  assert.equal(isGatewayRouteKind('GRPCRoute'), true);
  assert.equal(isGatewayRouteKind('TLSRoute'), true);
  assert.equal(isGatewayRouteKind('TCPRoute'), true);
  assert.equal(isGatewayRouteKind('Ingress'), false);
});

test('gateway route inference fails closed for malformed reference collections', () => {
  const route: KubeObject = {
    spec: {
      parentRefs: [null, 42, {}, { name: 7 }],
      rules: [{ backendRefs: [null, false, {}, { name: 7 }] }, { matches: [null, 42, {}] }],
    },
  };

  assert.deepEqual(gatewayRouteParentGateways(route, 'edge'), []);
  assert.deepEqual(gatewayRouteBackendServices(route, 'edge'), []);
  assert.deepEqual(grpcRouteMethods(route), []);
});
