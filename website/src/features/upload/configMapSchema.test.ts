import assert from 'node:assert/strict';
import test from 'node:test';
import type { KubeObject } from './kubernetesObject.ts';
import { sanitizeUploadConfigMap, uploadConfigMapStatus, uploadConfigMapSummary } from './configMapSchema.ts';
import { parseKubernetesFiles } from './parseKubernetesFiles.ts';

test('upload ConfigMap summary exposes only bounded key counts', () => {
  const configMap = validConfigMap();
  assert.equal(uploadConfigMapStatus(configMap), 'healthy');
  assert.deepEqual(uploadConfigMapSummary(configMap), {
    keys: 3,
    dataKeys: 2,
    binaryKeys: 1,
    immutable: true,
  });

  const sanitized = sanitizeUploadConfigMap(configMap);
  assert.doesNotMatch(JSON.stringify(sanitized), /must-not-survive|enabled|cHJpdmF0ZQ/);
  assert.equal(sanitized.data, undefined);
  assert.equal(sanitized.binaryData, undefined);
  assert.deepEqual(uploadConfigMapSummary(sanitized), uploadConfigMapSummary(configMap));
});

test('upload ConfigMap schema rejects malformed and oversized key maps', () => {
  const oversized = Object.fromEntries(Array.from({ length: 4097 }, (_, index) => [`key-${index}`, 'value']));
  const malformed: KubeObject[] = [
    { ...validConfigMap(), data: { '.': 'fixture' } },
    { ...validConfigMap(), data: { '../token': 'fixture' } },
    { ...validConfigMap(), data: { shared: 'one' }, binaryData: { shared: 'dHdv' } },
    { ...validConfigMap(), data: { valid: 42 } },
    { ...validConfigMap(), immutable: 'true' } as KubeObject,
    { ...validConfigMap(), data: oversized },
  ];
  malformed.forEach((configMap, index) => {
    assert.equal(uploadConfigMapStatus(configMap), 'warning', `status ${index}`);
    assert.equal(uploadConfigMapSummary(configMap).keys, 'invalid', `summary ${index}`);
    assert.doesNotMatch(JSON.stringify(uploadConfigMapSummary(configMap)), /fixture|must-not-survive/, `leak ${index}`);
  });
});

test('upload topology retains ConfigMap diagnostics without raw values', async () => {
  const manifest = `
apiVersion: v1
kind: ConfigMap
metadata:
  name: valid-config
  namespace: checkout
immutable: true
data:
  APP_MODE: must-not-survive
binaryData:
  logo.bin: cHJpdmF0ZS1rZXk=
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: invalid-config
  namespace: checkout
data:
  ../credential: must-not-survive
`;
  const file = { name: 'configmaps.yaml', text: async () => manifest } as File;
  const result = await parseKubernetesFiles([file], { clusterId: 'upload', clusterName: 'Upload' });
  const valid = result.snapshot.nodes.find((node) => node.kind === 'ConfigMap' && node.name === 'valid-config');
  const invalid = result.snapshot.nodes.find((node) => node.kind === 'ConfigMap' && node.name === 'invalid-config');
  assert.equal(valid?.status, 'healthy');
  assert.equal(valid?.summary.keys, 2);
  assert.equal(valid?.summary.binaryKeys, 1);
  assert.equal(invalid?.status, 'warning');
  assert.equal(invalid?.summary.keys, 'invalid');
  assert.doesNotMatch(JSON.stringify(result.snapshot), /must-not-survive|cHJpdmF0ZS1rZXk/);
});

function validConfigMap(): KubeObject {
  return {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: 'app-config', namespace: 'app' },
    data: { 'app.properties': 'must-not-survive', FEATURE_FLAG: 'enabled' },
    binaryData: { 'logo.bin': 'cHJpdmF0ZQ==' },
    immutable: true,
  };
}
