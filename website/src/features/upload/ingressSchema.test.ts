import assert from 'node:assert/strict';
import test from 'node:test';
import {
  uploadIngressServiceNames,
  uploadIngressSpecIsValid,
  uploadIngressStatus,
  uploadIngressSummary,
} from './ingressSchema.ts';
import type { KubeObject } from './kubernetesObject.ts';
import { parseKubernetesFiles } from './parseKubernetesFiles.ts';

test('upload Ingress schema validates backends and summarizes TLS without exposing load balancer addresses', () => {
  const ingress = ingressObject({
    ingressClassName: 'nginx',
    defaultBackend: { service: { name: 'fallback', port: { name: 'http' } } },
    rules: [{
      host: 'api.example.com',
      http: { paths: [
        { path: '/', pathType: 'Prefix', backend: { service: { name: 'api', port: { number: 80 } } } },
        { path: '/assets', pathType: 'Prefix', backend: { resource: { apiGroup: 'storage.example.com', kind: 'Bucket', name: 'assets' } } },
      ] },
    }],
    tls: [{ hosts: ['api.example.com', '*.example.com'], secretName: 'public-tls' }],
  }, {
    loadBalancer: { ingress: [
      { ip: '192.0.2.40', ports: [{ port: 443, protocol: 'TCP', error: 'ProviderError' }] },
      { hostname: 'public-lb.example.com' },
    ] },
  });

  assert.equal(uploadIngressSpecIsValid(ingress), true);
  assert.equal(uploadIngressStatus(ingress), 'healthy');
  assert.deepEqual(uploadIngressServiceNames(ingress), ['api', 'fallback']);
  const summary = uploadIngressSummary(ingress);
  assert.deepEqual(summary, {
    class: 'nginx',
    hosts: 'api.example.com',
    rules: 1,
    backends: 2,
    defaultBackend: 'Service',
    tls: 1,
    tlsHosts: 2,
    tlsSecrets: 1,
    loadBalancerAddresses: 2,
    loadBalancerIPs: 1,
    loadBalancerHostnames: 1,
    loadBalancerPorts: 1,
    loadBalancerPortErrors: 1,
  });
  assert.doesNotMatch(JSON.stringify(summary), /192\.0\.2\.40|public-lb\.example\.com|public-tls/);
});

test('upload Ingress schema rejects malformed or oversized specs and suppresses service references', () => {
  const invalidSpecs = [
    {},
    { ingressClassName: 'Bad Class', defaultBackend: serviceBackend() },
    { defaultBackend: { ...serviceBackend(), resource: { kind: 'Bucket', name: 'assets' } } },
    { defaultBackend: { service: { name: 'api', port: {} } } },
    { rules: [{ host: 'api.example.com', http: { paths: [{ path: '/', backend: serviceBackend() }] } }] },
    { rules: [{ host: 'TOKEN.EXAMPLE.COM', http: { paths: [validPath()] } }] },
    { defaultBackend: { resource: { apiGroup: 'bad group', kind: 'Bucket', name: 'assets' } } },
    { defaultBackend: serviceBackend(), tls: [{ hosts: ['TOKEN.EXAMPLE.COM'], secretName: 'public-tls' }] },
    { defaultBackend: serviceBackend(), tls: [{ hosts: ['api.example.com'], secretName: 'bad name' }] },
    { defaultBackend: serviceBackend(), tls: Array.from({ length: 65 }, () => ({})) },
    { defaultBackend: serviceBackend(), rules: Array.from({ length: 257 }, () => ({ host: 'api.example.com', http: { paths: [validPath()] } })) },
  ];

  invalidSpecs.forEach((spec, index) => {
    const ingress = ingressObject(spec);
    assert.equal(uploadIngressSpecIsValid(ingress), false, `fixture ${index}`);
    assert.deepEqual(uploadIngressServiceNames(ingress), [], `fixture ${index}`);
    assert.equal(uploadIngressStatus(ingress), 'warning', `fixture ${index}`);
    const encoded = JSON.stringify(uploadIngressSummary(ingress));
    assert.doesNotMatch(encoded, /TOKEN|bad group|bad name/);
  });
});

test('upload Ingress status rejects malformed addresses without echoing remote values', () => {
  const invalidStatuses = [
    { loadBalancer: { ingress: [{ ip: '192.00.2.40' }] } },
    { loadBalancer: { ingress: [{ hostname: 'TOKEN.EXAMPLE.COM' }] } },
    { loadBalancer: { ingress: [{ ip: '192.0.2.40', hostname: 'public.example.com' }] } },
    { loadBalancer: { ingress: [{ ip: 'credential=remote-value' }] } },
    { loadBalancer: { ingress: [{ ip: '192.0.2.40', ports: [{ port: 0, protocol: 'TCP' }] }] } },
    { loadBalancer: { ingress: Array.from({ length: 65 }, (_, index) => ({ ip: `192.0.2.${index + 1}` })) } },
  ];

  invalidStatuses.forEach((status, index) => {
    const ingress = ingressObject({ defaultBackend: serviceBackend() }, status);
    assert.equal(uploadIngressStatus(ingress), 'warning', `fixture ${index}`);
    const summary = uploadIngressSummary(ingress);
    assert.equal(summary.loadBalancerAddresses, 'invalid', `fixture ${index}`);
    assert.doesNotMatch(JSON.stringify(summary), /remote-value|TOKEN|192\.00\.2\.40/);
  });
});

test('upload topology keeps malformed Ingress visible but does not infer unsafe backend edges', async () => {
  const manifest = `
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: public
  namespace: edge
spec:
  defaultBackend:
    service:
      name: api
      port:
        number: 80
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: invalid
  namespace: edge
spec:
  rules:
    - host: credential.example.com
      http:
        paths:
          - path: /
            backend:
              service:
                name: secret-backend
                port:
                  number: 80
`;
  const file = { name: 'ingress.yaml', text: async () => manifest } as File;
  const result = await parseKubernetesFiles([file], { clusterId: 'upload', clusterName: 'Upload' });
  const validNode = result.snapshot.nodes.find((node) => node.kind === 'Ingress' && node.name === 'public');
  const invalidNode = result.snapshot.nodes.find((node) => node.kind === 'Ingress' && node.name === 'invalid');
  assert.equal(validNode?.status, 'healthy');
  assert.equal(invalidNode?.status, 'warning');
  assert.equal(invalidNode?.summary.hosts, 'invalid');
  assert.equal(result.snapshot.edges.filter((edge) => edge.type === 'routes-to').length, 1);
  assert.equal(result.snapshot.nodes.some((node) => node.name === 'secret-backend'), false);
  assert.doesNotMatch(JSON.stringify(invalidNode?.summary), /credential\.example\.com|secret-backend/);
});

function ingressObject(spec: Record<string, unknown>, status?: Record<string, unknown>): KubeObject {
  return { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', metadata: { name: 'public', namespace: 'edge' }, spec, status };
}

function serviceBackend() {
  return { service: { name: 'api', port: { number: 80 } } };
}

function validPath() {
  return { path: '/', pathType: 'Prefix', backend: serviceBackend() };
}
