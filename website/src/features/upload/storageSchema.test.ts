import assert from 'node:assert/strict';
import test from 'node:test';
import type { KubeObject } from './kubernetesObject.ts';
import {
  uploadStorageReferences,
  uploadStorageSpecIsValid,
  uploadStorageStatus,
  uploadStorageSummary,
} from './storageSchema.ts';
import { parseKubernetesFiles } from './parseKubernetesFiles.ts';

test('upload storage summaries keep bounded capacity, access, policy, and binding metadata', () => {
  const pvc = validPVC();
  assert.equal(uploadStorageSpecIsValid('PersistentVolumeClaim', pvc), true);
  assert.equal(uploadStorageStatus('PersistentVolumeClaim', pvc), 'healthy');
  assert.deepEqual(uploadStorageSummary('PersistentVolumeClaim', pvc), {
    phase: 'Bound',
    requestedStorage: '10Gi',
    capacityStorage: '10Gi',
    accessModes: 'ReadWriteOnce',
    statusAccessModes: 'ReadWriteOnce',
    volumeMode: 'Filesystem',
    volume: 'orders-pv',
    storageClass: 'local-fast',
    requestResourceCount: 1,
    capacityResourceCount: 1,
  });
  assert.deepEqual(uploadStorageReferences('PersistentVolumeClaim', pvc), [
    { kind: 'PersistentVolume', name: 'orders-pv' },
    { kind: 'StorageClass', name: 'local-fast' },
  ]);

  const pv = validPV();
  assert.equal(uploadStorageStatus('PersistentVolume', pv), 'healthy');
  assert.equal(uploadStorageSummary('PersistentVolume', pv).reclaimPolicy, 'Delete');
  assert.deepEqual(uploadStorageReferences('PersistentVolume', pv), [{ kind: 'StorageClass', name: 'local-fast' }]);

  const storageClass = validStorageClass();
  assert.equal(uploadStorageStatus('StorageClass', storageClass), 'healthy');
  assert.deepEqual(uploadStorageSummary('StorageClass', storageClass), {
    provisioner: 'example.csi.io',
    reclaimPolicy: 'Delete',
    volumeBindingMode: 'WaitForFirstConsumer',
    allowVolumeExpansion: true,
  });
});

test('upload storage schema rejects malformed remote values and suppresses references', () => {
  const oversizedResources = { storage: '10Gi', ...Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`example.com/resource-${index}`, '1'])) };
  const malformed: Array<['PersistentVolumeClaim' | 'PersistentVolume' | 'StorageClass', KubeObject, string, number]> = [
    ['PersistentVolumeClaim', withPVC({ resources: { requests: { storage: '10Gi?token=fixture' } } }), 'requestedStorage', 0],
    ['PersistentVolumeClaim', withPVC({ volumeName: 'orders-pv?credential=fixture' }), 'volume', 0],
    ['PersistentVolume', withPV({ accessModes: ['ReadWriteOnce', 'ReadWriteOnce'] }), 'accessModes', 0],
    ['PersistentVolume', { ...validPV(), status: { phase: 'token=fixture' } }, 'phase', 1],
    ['StorageClass', { ...validStorageClass(), provisioner: 'example.csi.io?token=fixture' } as KubeObject, 'provisioner', 0],
    ['PersistentVolumeClaim', withPVC({ resources: { requests: oversizedResources } }), 'requestResourceCount', 0],
    ['PersistentVolume', withPV({ accessModes: ['ReadWriteOnce', 'ReadOnlyMany', 'ReadWriteMany', 'ReadWriteOncePod', 'ReadWriteOnce'] }), 'accessModes', 0],
    ['StorageClass', { ...validStorageClass(), volumeBindingMode: 'token=fixture' } as KubeObject, 'volumeBindingMode', 0],
  ];
  malformed.forEach(([kind, object, summaryKey, referenceCount], index) => {
    assert.equal(uploadStorageStatus(kind, object), 'warning', `status ${index}`);
    assert.equal(uploadStorageSummary(kind, object)[summaryKey], 'invalid', `summary ${index}`);
    assert.equal(uploadStorageReferences(kind, object).length, referenceCount, `references ${index}`);
    assert.doesNotMatch(JSON.stringify(uploadStorageSummary(kind, object)), /fixture|\?token/, `leak ${index}`);
  });
});

test('upload topology keeps safe storage summaries and drops raw CSI or parameter values', async () => {
  const manifest = `
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-fast
provisioner: example.csi.io
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
parameters:
  secretName: must-not-survive
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: orders-pv
spec:
  capacity:
    storage: 10Gi
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Delete
  storageClassName: local-fast
  volumeMode: Filesystem
  csi:
    driver: example.csi.io
    volumeHandle: must-not-survive
    nodeStageSecretRef:
      name: must-not-survive
status:
  phase: Bound
  message: must-not-survive
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: orders-data
  namespace: checkout
spec:
  accessModes: [ReadWriteOnce]
  volumeMode: Filesystem
  storageClassName: local-fast
  volumeName: orders-pv
  resources:
    requests:
      storage: 10Gi
status:
  phase: Bound
  accessModes: [ReadWriteOnce]
  capacity:
    storage: 10Gi
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: invalid-data
  namespace: checkout
spec:
  storageClassName: local-fast?credential=fixture
  resources:
    requests:
      storage: 10Gi
`;
  const file = { name: 'storage.yaml', text: async () => manifest } as File;
  const result = await parseKubernetesFiles([file], { clusterId: 'upload', clusterName: 'Upload' });
  const validPVCNode = result.snapshot.nodes.find((node) => node.kind === 'PersistentVolumeClaim' && node.name === 'orders-data');
  const invalidPVCNode = result.snapshot.nodes.find((node) => node.kind === 'PersistentVolumeClaim' && node.name === 'invalid-data');
  assert.equal(validPVCNode?.status, 'healthy');
  assert.equal(validPVCNode?.summary.requestedStorage, '10Gi');
  assert.equal(invalidPVCNode?.status, 'warning');
  assert.equal(invalidPVCNode?.summary.storageClass, 'invalid');
  assert.equal(result.snapshot.edges.filter((edge) => edge.source === validPVCNode?.id && edge.type === 'binds-storage').length, 2);
  assert.equal(result.snapshot.edges.some((edge) => edge.source === invalidPVCNode?.id), false);
  assert.doesNotMatch(JSON.stringify(result.snapshot), /fixture|must-not-survive|volumeHandle|nodeStageSecretRef|parameters/);
});

function validPVC(): KubeObject {
  return {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: { name: 'orders-data', namespace: 'checkout' },
    spec: {
      accessModes: ['ReadWriteOnce'],
      volumeMode: 'Filesystem',
      storageClassName: 'local-fast',
      volumeName: 'orders-pv',
      resources: { requests: { storage: '10Gi' } },
    },
    status: { phase: 'Bound', accessModes: ['ReadWriteOnce'], capacity: { storage: '10Gi' } },
  };
}

function validPV(): KubeObject {
  return {
    apiVersion: 'v1',
    kind: 'PersistentVolume',
    metadata: { name: 'orders-pv' },
    spec: {
      capacity: { storage: '10Gi' },
      accessModes: ['ReadWriteOnce'],
      persistentVolumeReclaimPolicy: 'Delete',
      storageClassName: 'local-fast',
      volumeMode: 'Filesystem',
    },
    status: { phase: 'Bound' },
  };
}

function validStorageClass(): KubeObject {
  return {
    apiVersion: 'storage.k8s.io/v1',
    kind: 'StorageClass',
    metadata: { name: 'local-fast' },
    provisioner: 'example.csi.io',
    reclaimPolicy: 'Delete',
    volumeBindingMode: 'WaitForFirstConsumer',
    allowVolumeExpansion: true,
  } as KubeObject;
}

function withPVC(spec: Record<string, unknown>): KubeObject {
  const pvc = validPVC();
  return { ...pvc, spec: { ...pvc.spec, ...spec } };
}

function withPV(spec: Record<string, unknown>): KubeObject {
  const pv = validPV();
  return { ...pv, spec: { ...pv.spec, ...spec } };
}
