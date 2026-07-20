import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inferCustomResourceReferences,
  type CustomResourceDefinitionRecord,
} from './customResourceReferences.ts';

const namespacedDefinition: CustomResourceDefinitionRecord = {
  name: 'widgets.example.io',
  group: 'example.io',
  kind: 'Widget',
  versions: ['v1'],
  scope: 'Namespaced',
};

test('custom resource references infer explicit native reference shapes and safe source paths', () => {
  const references = inferCustomResourceReferences(
    {
      secretRef: { name: 'app-secret' },
      configMapRefs: [{ name: 'app-config' }],
      identity: { serviceAccountName: 'runtime' },
      backendRef: { apiVersion: 'v1', kind: 'Service', namespace: 'shared', name: 'backend' },
      ignoredRef: { name: 'unknown' },
      unrelatedName: 'not-a-reference',
    },
    'apps',
    namespacedDefinition,
    [namespacedDefinition],
  );

  assert.deepEqual(references, [
    { kind: 'Secret', namespace: 'apps', name: 'app-secret', sourceField: 'spec.secretRef' },
    { kind: 'ConfigMap', namespace: 'apps', name: 'app-config', sourceField: 'spec.configMapRefs[0]' },
    { kind: 'ServiceAccount', namespace: 'apps', name: 'runtime', sourceField: 'spec.identity.serviceAccountName' },
    { kind: 'Service', namespace: 'shared', name: 'backend', sourceField: 'spec.backendRef' },
  ]);
});

test('custom resource references resolve namespaced and cluster-scoped custom targets', () => {
  const clusterDefinition: CustomResourceDefinitionRecord = {
    name: 'globalwidgets.example.io',
    group: 'example.io',
    kind: 'GlobalWidget',
    versions: ['v1alpha1'],
    scope: 'Cluster',
  };
  const references = inferCustomResourceReferences(
    {
      widgetRef: { apiVersion: 'example.io/v1', kind: 'Widget', name: 'child' },
      globalRef: { apiVersion: 'example.io/v1alpha1', kind: 'GlobalWidget', namespace: 'ignored', name: 'shared' },
      nodeRef: { kind: 'Node', name: 'worker-a' },
    },
    'apps',
    namespacedDefinition,
    [namespacedDefinition, clusterDefinition],
  );

  assert.deepEqual(references, [
    { kind: 'CustomResource', namespace: 'apps', name: 'Widget:child', sourceField: 'spec.widgetRef' },
    { kind: 'CustomResource', namespace: '', name: 'GlobalWidget:shared', sourceField: 'spec.globalRef' },
    { kind: 'Node', namespace: '', name: 'worker-a', sourceField: 'spec.nodeRef' },
  ]);
});

test('custom resource reference traversal is cycle, depth, path, and result bounded', () => {
  const spec: Record<string, unknown> = {};
  const longKey = 'x'.repeat(300);
  spec[longKey] = { configMapRef: { name: 'bounded-path' } };
  spec.secretRefs = Array.from({ length: 100 }, (_, index) => ({ name: `secret-${index}` }));
  spec.self = spec;

  let deep: Record<string, unknown> = spec;
  for (let index = 0; index < 40; index += 1) {
    const next: Record<string, unknown> = {};
    deep.child = next;
    deep = next;
  }
  deep.secretName = 'too-deep';

  const references = inferCustomResourceReferences(spec, 'apps', namespacedDefinition, [namespacedDefinition]);

  assert.equal(references.length, 80);
  assert.equal(references.some((reference) => reference.name === 'bounded-path'), true);
  assert.equal(references.some((reference) => reference.name === 'too-deep'), false);
  assert.equal(references.every((reference) => reference.sourceField.length <= 512), true);
});
