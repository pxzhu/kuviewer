import type { ResourceKind } from '../../types/topology';
import {
  asArray,
  readAt,
  stringAt,
  uniqueStrings,
  type KubeObject,
} from './kubernetesObject.ts';

export interface NamespacedResourceReference {
  name: string;
  namespace: string;
}

export function gatewayRouteParentGateways(object: KubeObject, namespace: string): NamespacedResourceReference[] {
  return asArray(readAt(object, ['spec', 'parentRefs']))
    .filter((parentRef) => {
      const kind = stringAt(parentRef, ['kind']);
      const group = stringAt(parentRef, ['group']);
      return (!kind || kind === 'Gateway') && (!group || group === 'gateway.networking.k8s.io');
    })
    .map((parentRef) => ({
      name: stringAt(parentRef, ['name']),
      namespace: stringAt(parentRef, ['namespace']) || namespace,
    }))
    .filter(hasReferenceName);
}

export function gatewayRouteBackendServices(object: KubeObject, namespace: string): NamespacedResourceReference[] {
  const services: NamespacedResourceReference[] = [];
  asArray(readAt(object, ['spec', 'rules'])).forEach((rule) => {
    asArray(readAt(rule, ['backendRefs'])).forEach((backendRef) => {
      const kind = stringAt(backendRef, ['kind']);
      const group = stringAt(backendRef, ['group']);
      const name = stringAt(backendRef, ['name']);
      if (name && (!kind || kind === 'Service') && !group) {
        services.push({ name, namespace: stringAt(backendRef, ['namespace']) || namespace });
      }
    });
  });
  return uniqueReferences(services);
}

export function grpcRouteMethods(object: KubeObject) {
  return uniqueStrings(
    asArray(readAt(object, ['spec', 'rules']))
      .flatMap((rule) =>
        asArray(rule.matches).map((match) => {
          const service = stringAt(match, ['method', 'service']);
          const method = stringAt(match, ['method', 'method']);
          return service && method ? `${service}/${method}` : service || method;
        }),
      )
      .filter(Boolean),
  );
}

export function gatewayHosts(object: KubeObject) {
  return uniqueStrings(
    asArray(readAt(object, ['spec', 'listeners']))
      .map((listener) => stringAt(listener, ['hostname']))
      .filter(Boolean),
  );
}

export function isGatewayRouteKind(kind: ResourceKind) {
  return kind === 'HTTPRoute' || kind === 'GRPCRoute' || kind === 'TLSRoute' || kind === 'TCPRoute';
}

function hasReferenceName(reference: NamespacedResourceReference): reference is NamespacedResourceReference {
  return Boolean(reference.name);
}

function uniqueReferences(values: NamespacedResourceReference[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.namespace}/${value.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
