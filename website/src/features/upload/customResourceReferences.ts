import type { ResourceKind } from '../../types/topology.ts';
import { normalizeUploadResourceKind } from './uploadResourceKinds.ts';

export interface CustomResourceDefinitionRecord {
  name: string;
  group: string;
  kind: string;
  versions: string[];
  scope: string;
}

export interface CustomResourceReference {
  kind: ResourceKind;
  namespace: string;
  name: string;
  sourceField: string;
}

const maxReferences = 80;
const maxTraversalDepth = 32;
const maxVisitedValues = 5_000;
const maxPathLength = 512;
const maxPathSegmentLength = 120;
const clusterScopedKinds = new Set<ResourceKind>([
  'Cluster',
  'Namespace',
  'Node',
  'PersistentVolume',
  'StorageClass',
  'CustomResourceDefinition',
]);

interface TraversalState {
  references: CustomResourceReference[];
  seen: WeakSet<object>;
  visitedValues: number;
}

export function inferCustomResourceReferences(
  spec: unknown,
  defaultNamespace: string,
  sourceDefinition: CustomResourceDefinitionRecord,
  customResourceDefinitions: CustomResourceDefinitionRecord[],
) {
  const state: TraversalState = {
    references: [],
    seen: new WeakSet(),
    visitedValues: 0,
  };
  collectCustomResourceReferences(
    spec,
    'spec',
    defaultNamespace,
    sourceDefinition,
    customResourceDefinitions,
    state,
    0,
  );
  return state.references;
}

function collectCustomResourceReferences(
  value: unknown,
  path: string,
  defaultNamespace: string,
  sourceDefinition: CustomResourceDefinitionRecord,
  customResourceDefinitions: CustomResourceDefinitionRecord[],
  state: TraversalState,
  depth: number,
) {
  if (
    state.references.length >= maxReferences
    || state.visitedValues >= maxVisitedValues
    || depth > maxTraversalDepth
    || value == null
  ) {
    return;
  }
  state.visitedValues += 1;

  if (typeof value === 'object') {
    if (state.seen.has(value)) {
      return;
    }
    state.seen.add(value);
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (state.references.length >= maxReferences || state.visitedValues >= maxVisitedValues) {
        break;
      }
      collectCustomResourceReferences(
        value[index],
        appendIndex(path, index),
        defaultNamespace,
        sourceDefinition,
        customResourceDefinitions,
        state,
        depth + 1,
      );
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (state.references.length >= maxReferences || state.visitedValues >= maxVisitedValues) {
      break;
    }
    const childPath = appendPath(path, key);
    const referenceKind = customResourceReferenceKindFromKey(key);
    if (isRecord(child) && isReferenceFieldName(key)) {
      const reference = customResourceReferenceFromObject(
        child,
        referenceKind,
        childPath,
        defaultNamespace,
        sourceDefinition,
        customResourceDefinitions,
      );
      if (reference) {
        state.references.push(reference);
      }
    }
    if (Array.isArray(child) && isReferenceFieldName(key)) {
      for (let index = 0; index < child.length; index += 1) {
        if (state.references.length >= maxReferences) {
          break;
        }
        const item = child[index];
        if (!isRecord(item)) {
          continue;
        }
        const reference = customResourceReferenceFromObject(
          item,
          referenceKind,
          appendIndex(childPath, index),
          defaultNamespace,
          sourceDefinition,
          customResourceDefinitions,
        );
        if (reference) {
          state.references.push(reference);
        }
      }
    }
    const nameKind = customResourceReferenceKindFromNameKey(key);
    if (nameKind && typeof child === 'string' && child.trim() && state.references.length < maxReferences) {
      state.references.push({
        kind: nameKind,
        namespace: targetNamespaceForKind(nameKind, stringValue(value.namespace) || defaultNamespace, sourceDefinition),
        name: child.trim(),
        sourceField: childPath,
      });
    }
    collectCustomResourceReferences(
      child,
      childPath,
      defaultNamespace,
      sourceDefinition,
      customResourceDefinitions,
      state,
      depth + 1,
    );
  }
}

function customResourceReferenceFromObject(
  value: Record<string, unknown>,
  fallbackKind: ResourceKind | undefined,
  sourceField: string,
  defaultNamespace: string,
  sourceDefinition: CustomResourceDefinitionRecord,
  customResourceDefinitions: CustomResourceDefinitionRecord[],
): CustomResourceReference | undefined {
  const name = stringValue(value.name);
  if (!name) {
    return undefined;
  }
  const apiVersion = stringValue(value.apiVersion);
  const kindName = stringValue(value.kind);
  const customDefinition = kindName && apiVersion
    ? customResourceDefinitionForReference(apiVersion, kindName, customResourceDefinitions)
    : undefined;
  const nativeKind = normalizeUploadResourceKind(kindName);
  const kind = customDefinition ? 'CustomResource' : nativeKind || fallbackKind;
  if (!kind) {
    return undefined;
  }
  const namespace = targetNamespaceForKind(
    kind,
    stringValue(value.namespace) || defaultNamespace,
    customDefinition || sourceDefinition,
  );
  return {
    kind,
    namespace,
    name: kind === 'CustomResource' ? `${kindName || customDefinition?.kind || 'CustomResource'}:${name}` : name,
    sourceField,
  };
}

function isReferenceFieldName(key: string) {
  return /(Ref|Refs|Reference|References)$/.test(key);
}

function customResourceReferenceKindFromKey(key: string): ResourceKind | undefined {
  switch (key.toLowerCase()) {
    case 'secretref':
    case 'secretrefs':
      return 'Secret';
    case 'configmapref':
    case 'configmaprefs':
      return 'ConfigMap';
    case 'serviceaccountref':
    case 'serviceaccountrefs':
      return 'ServiceAccount';
    case 'serviceref':
    case 'servicerefs':
    case 'backendref':
    case 'backendrefs':
      return 'Service';
    default:
      return undefined;
  }
}

function customResourceReferenceKindFromNameKey(key: string): ResourceKind | undefined {
  switch (key.toLowerCase()) {
    case 'secretname':
      return 'Secret';
    case 'configmapname':
      return 'ConfigMap';
    case 'serviceaccountname':
      return 'ServiceAccount';
    case 'servicename':
      return 'Service';
    default:
      return undefined;
  }
}

function customResourceDefinitionForReference(
  apiVersion: string,
  kind: string,
  definitions: CustomResourceDefinitionRecord[],
) {
  const { group, version } = apiVersionParts(apiVersion);
  if (!group || !version) {
    return undefined;
  }
  return definitions.find(
    (definition) => definition.group === group
      && definition.kind === kind
      && definition.versions.includes(version),
  );
}

function targetNamespaceForKind(
  kind: ResourceKind,
  namespace: string,
  customResourceDefinition?: CustomResourceDefinitionRecord,
) {
  if (kind === 'CustomResource' && customResourceDefinition?.scope === 'Cluster') {
    return '';
  }
  return clusterScopedKinds.has(kind) ? '' : namespace;
}

function apiVersionParts(apiVersion: string) {
  const parts = apiVersion.split('/');
  if (parts.length === 1) {
    return { group: '', version: parts[0] || '' };
  }
  return {
    group: parts.slice(0, -1).join('/'),
    version: parts[parts.length - 1] || '',
  };
}

function appendPath(path: string, key: string) {
  const segment = key
    .replace(/[\u0000-\u001f\u007f]/g, '?')
    .slice(0, maxPathSegmentLength);
  return `${path}.${segment}`.slice(0, maxPathLength);
}

function appendIndex(path: string, index: number) {
  return `${path}[${index}]`.slice(0, maxPathLength);
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
