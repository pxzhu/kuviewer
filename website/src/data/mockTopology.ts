import type { EdgeType, ResourceKind, ResourceStatus, SummaryValue, TopologyEdge, TopologyNode, TopologySnapshot } from '../types/topology';

const local = 'local-native';
const aks = 'aks-prod';

export const mockTopology: TopologySnapshot = {
  clusters: [
    {
      id: local,
      name: 'native-dev',
      provider: 'Kubernetes',
      version: 'v1.30.x',
      nodeReady: 3,
      nodeTotal: 3,
      podRunning: 14,
      podWarning: 2,
      namespaces: 3,
    },
    {
      id: aks,
      name: 'aks-prod-east',
      provider: 'AKS',
      version: 'v1.30.x',
      nodeReady: 2,
      nodeTotal: 2,
      podRunning: 9,
      podWarning: 1,
      namespaces: 3,
    },
  ],
  nodes: [
    node(local, 'Cluster', '', 'native-dev', 'healthy', { provider: 'native' }, { version: 'v1.30.x', nodes: 3, namespaces: 3 }),
    node(local, 'Node', '', 'worker-a', 'healthy', { zone: 'a', role: 'system' }, { cpu: '61%', memory: '72%', pods: 7 }),
    node(local, 'Node', '', 'worker-b', 'healthy', { zone: 'b', role: 'app' }, { cpu: '48%', memory: '58%', pods: 6 }),
    node(local, 'Node', '', 'worker-c', 'warning', { zone: 'c', role: 'app' }, { cpu: '82%', memory: '86%', pods: 5 }),
    node(local, 'StorageClass', '', 'local-path', 'healthy', { provisioner: 'rancher.io/local-path' }, { provisioner: 'local-path', mode: 'WaitForFirstConsumer' }),
    node(local, 'PersistentVolume', '', 'pv-checkout-db', 'healthy', { storage: 'local' }, { capacity: '20Gi', reclaim: 'Delete' }),
    node(local, 'CustomResourceDefinition', '', 'widgets.platform.example.com', 'healthy', { group: 'platform.example.com' }, { group: 'platform.example.com', kind: 'Widget', plural: 'widgets', scope: 'Namespaced', servedVersions: 'v1', storageVersion: 'v1' }),
    node(local, 'CustomResource', 'platform', 'Widget:checkout-dashboard', 'healthy', { app: 'checkout' }, { apiVersion: 'platform.example.com/v1', kind: 'Widget', name: 'checkout-dashboard', crd: 'widgets.platform.example.com', group: 'platform.example.com', scope: 'Namespaced', version: 'v1', specFields: 2, statusFields: 1, conditions: 'Ready=True' }),

    node(local, 'Namespace', '', 'platform', 'healthy', { team: 'platform' }, { workloads: 3, services: 2 }),
    node(local, 'ServiceAccount', 'platform', 'kuviewer-api', 'healthy', { app: 'kuviewer' }, { tokens: 'bound' }),
    node(local, 'ConfigMap', 'platform', 'kuviewer-config', 'healthy', { app: 'kuviewer' }, { keys: 5 }),
    node(local, 'Secret', 'platform', 'kuviewer-admin-token', 'unknown', { app: 'kuviewer' }, { type: 'Opaque', values: 'hidden' }),
    node(local, 'Deployment', 'platform', 'kuviewer-api', 'healthy', { app: 'kuviewer', tier: 'api' }, { replicas: '2/2', image: 'kuviewer/api:mock' }),
    node(local, 'ReplicaSet', 'platform', 'kuviewer-api-6d9c4', 'healthy', { app: 'kuviewer', hash: '6d9c4' }, { replicas: '2/2' }),
    node(local, 'Pod', 'platform', 'kuviewer-api-6d9c4-a', 'healthy', { app: 'kuviewer' }, { ready: true, restarts: 0, node: 'worker-a', containerNames: ['api'], initContainers: ['migrate'] }),
    node(local, 'Pod', 'platform', 'kuviewer-api-6d9c4-b', 'healthy', { app: 'kuviewer' }, { ready: true, restarts: 0, node: 'worker-b', containerNames: ['api'] }),
    node(local, 'Service', 'platform', 'kuviewer-api', 'healthy', { app: 'kuviewer' }, { type: 'ClusterIP', port: 8080 }),

    node(local, 'Namespace', '', 'checkout', 'warning', { team: 'commerce' }, { workloads: 5, services: 4 }),
    node(local, 'Ingress', 'checkout', 'checkout-web', 'healthy', { app: 'checkout' }, { host: 'checkout.internal', tls: true }),
    node(local, 'Service', 'checkout', 'checkout-api', 'warning', { app: 'checkout' }, { type: 'ClusterIP', readyEndpoints: '2/3' }),
    node(local, 'Service', 'checkout', 'checkout-canary', 'error', { app: 'checkout-canary' }, { type: 'ClusterIP', readyEndpoints: '0/0' }),
    node(local, 'Service', 'checkout', 'checkout-db', 'healthy', { app: 'checkout-db' }, { type: 'Headless', port: 5432 }),
    node(local, 'Deployment', 'checkout', 'checkout-api', 'warning', { app: 'checkout', tier: 'backend' }, { replicas: '2/3', image: 'checkout/api:mock' }),
    node(local, 'HorizontalPodAutoscaler', 'checkout', 'checkout-api', 'healthy', { app: 'checkout' }, { target: 'Deployment/checkout-api', replicas: '3/3', range: '2-6' }),
    node(local, 'NetworkPolicy', 'checkout', 'checkout-api-ingress', 'healthy', { app: 'checkout' }, { policyTypes: 'Ingress,Egress', selector: 'app,1 expressions', ingress: '1 rule: pod:app,1 expressions; TCP:80', egress: '1 rule: ns:team,1 expressions, pod:app; TCP:5432', ports: 'TCP:80, TCP:5432' }),
    node(local, 'CronJob', 'checkout', 'checkout-reconcile', 'healthy', { app: 'checkout' }, { schedule: '*/15 * * * *', active: 0 }),
    node(local, 'Job', 'checkout', 'checkout-reconcile-286', 'healthy', { app: 'checkout' }, { completions: 1, succeeded: 1, failed: 0 }),
    node(local, 'ReplicaSet', 'checkout', 'checkout-api-7c8f9', 'warning', { app: 'checkout', hash: '7c8f9' }, { replicas: '2/3' }),
    node(local, 'Pod', 'checkout', 'checkout-api-7c8f9-a', 'healthy', { app: 'checkout' }, { ready: true, restarts: 0, node: 'worker-b', containerNames: ['api', 'sidecar'] }),
    node(local, 'Pod', 'checkout', 'checkout-api-7c8f9-b', 'warning', { app: 'checkout' }, { ready: false, restarts: 4, node: 'worker-c', containerNames: ['api', 'sidecar'] }),
    node(local, 'StatefulSet', 'checkout', 'checkout-db', 'healthy', { app: 'checkout-db' }, { replicas: '1/1', storage: '20Gi' }),
    node(local, 'Pod', 'checkout', 'checkout-db-0', 'healthy', { app: 'checkout-db' }, { ready: true, restarts: 0, node: 'worker-c' }),
    node(local, 'PersistentVolumeClaim', 'checkout', 'checkout-db-data', 'healthy', { app: 'checkout-db' }, { capacity: '20Gi', mode: 'ReadWriteOnce' }),
    node(local, 'ConfigMap', 'checkout', 'checkout-config', 'healthy', { app: 'checkout' }, { keys: 6 }),
    node(local, 'Secret', 'checkout', 'checkout-api-secret', 'unknown', { app: 'checkout' }, { type: 'Opaque', values: 'hidden' }),

    node(local, 'Namespace', '', 'observability', 'healthy', { team: 'platform' }, { workloads: 2, services: 1 }),
    node(local, 'DaemonSet', 'observability', 'node-agent', 'healthy', { app: 'node-agent' }, { ready: '3/3' }),
    node(local, 'Pod', 'observability', 'node-agent-a', 'healthy', { app: 'node-agent' }, { ready: true, restarts: 0, node: 'worker-a' }),
    node(local, 'Pod', 'observability', 'node-agent-b', 'healthy', { app: 'node-agent' }, { ready: true, restarts: 0, node: 'worker-b' }),
    node(local, 'ConfigMap', 'observability', 'agent-config', 'healthy', { app: 'node-agent' }, { keys: 3 }),
    node(local, 'Service', 'observability', 'telemetry', 'healthy', { app: 'node-agent' }, { type: 'ClusterIP', port: 4317 }),

    node(aks, 'Cluster', '', 'aks-prod-east', 'healthy', { provider: 'aks', region: 'eastus' }, { version: 'v1.30.x', nodes: 2, namespaces: 3 }),
    node(aks, 'Node', '', 'aks-node-a', 'healthy', { zone: '1', pool: 'system' }, { cpu: '44%', memory: '52%', pods: 6 }),
    node(aks, 'Node', '', 'aks-node-b', 'healthy', { zone: '2', pool: 'user' }, { cpu: '69%', memory: '64%', pods: 5 }),
    node(aks, 'StorageClass', '', 'managed-csi', 'healthy', { provisioner: 'disk.csi.azure.com' }, { sku: 'Premium_LRS', mode: 'WaitForFirstConsumer' }),
    node(aks, 'CustomResourceDefinition', '', 'rollouts.argoproj.io', 'healthy', { group: 'argoproj.io' }, { group: 'argoproj.io', kind: 'Rollout', plural: 'rollouts', scope: 'Namespaced', servedVersions: 'v1alpha1', storageVersion: 'v1alpha1' }),
    node(aks, 'CustomResource', 'edge', 'Rollout:edge-gateway', 'healthy', { app: 'edge-gateway' }, { apiVersion: 'argoproj.io/v1alpha1', kind: 'Rollout', name: 'edge-gateway', crd: 'rollouts.argoproj.io', group: 'argoproj.io', scope: 'Namespaced', version: 'v1alpha1', specFields: 2, statusFields: 1, conditions: 'Reconciled=True' }),

    node(aks, 'Namespace', '', 'edge', 'healthy', { team: 'edge' }, { workloads: 2, services: 2 }),
    node(aks, 'Ingress', 'edge', 'public-edge', 'healthy', { app: 'edge-gateway' }, { host: 'api.example.com', tls: true }),
    node(aks, 'Gateway', 'edge', 'public-gateway', 'healthy', { app: 'edge-gateway' }, { class: 'azure-alb', listeners: 1, hosts: 'api.example.com' }),
    node(aks, 'HTTPRoute', 'edge', 'edge-api', 'healthy', { app: 'edge-gateway' }, { hosts: 'api.example.com', rules: 1, backends: 1 }),
    node(aks, 'GRPCRoute', 'edge', 'edge-grpc', 'healthy', { app: 'edge-gateway' }, { hosts: 'grpc.example.com', rules: 1, backends: 1, methods: 'checkout.v1.Checkout/Get' }),
    node(aks, 'TLSRoute', 'edge', 'edge-tls', 'healthy', { app: 'edge-gateway' }, { hosts: 'tls.example.com', rules: 1, backends: 1 }),
    node(aks, 'TCPRoute', 'edge', 'edge-tcp', 'healthy', { app: 'edge-gateway' }, { rules: 1, backends: 1 }),
    node(aks, 'Service', 'edge', 'edge-gateway', 'healthy', { app: 'edge-gateway' }, { type: 'LoadBalancer', port: 443 }),
    node(aks, 'Deployment', 'edge', 'edge-gateway', 'healthy', { app: 'edge-gateway' }, { replicas: '2/2' }),
    node(aks, 'Pod', 'edge', 'edge-gateway-a', 'healthy', { app: 'edge-gateway' }, { ready: true, restarts: 0, node: 'aks-node-a' }),
    node(aks, 'Pod', 'edge', 'edge-gateway-b', 'healthy', { app: 'edge-gateway' }, { ready: true, restarts: 0, node: 'aks-node-b' }),

    node(aks, 'Namespace', '', 'payments', 'warning', { team: 'payments' }, { workloads: 4, services: 3 }),
    node(aks, 'ServiceAccount', 'payments', 'payments-api', 'healthy', { app: 'payments' }, { tokens: 'bound' }),
    node(aks, 'ConfigMap', 'payments', 'payments-config', 'healthy', { app: 'payments' }, { keys: 8 }),
    node(aks, 'Secret', 'payments', 'payments-secret', 'unknown', { app: 'payments' }, { type: 'Opaque', values: 'hidden' }),
    node(aks, 'Service', 'payments', 'payments-api', 'healthy', { app: 'payments' }, { type: 'ClusterIP', readyEndpoints: '2/2' }),
    node(aks, 'Deployment', 'payments', 'payments-api', 'healthy', { app: 'payments' }, { replicas: '2/2' }),
    node(aks, 'ReplicaSet', 'payments', 'payments-api-9f41d', 'healthy', { app: 'payments', hash: '9f41d' }, { replicas: '2/2' }),
    node(aks, 'Pod', 'payments', 'payments-api-a', 'healthy', { app: 'payments' }, { ready: true, restarts: 0, node: 'aks-node-a' }),
    node(aks, 'Pod', 'payments', 'payments-api-b', 'warning', { app: 'payments' }, { ready: true, restarts: 2, node: 'aks-node-b' }),
    node(aks, 'Service', 'payments', 'payments-db', 'healthy', { app: 'payments-db' }, { type: 'Headless', port: 5432 }),
    node(aks, 'StatefulSet', 'payments', 'payments-db', 'healthy', { app: 'payments-db' }, { replicas: '1/1', storage: '64Gi' }),
    node(aks, 'Pod', 'payments', 'payments-db-0', 'healthy', { app: 'payments-db' }, { ready: true, restarts: 0, node: 'aks-node-b' }),
    node(aks, 'PersistentVolumeClaim', 'payments', 'payments-db-data', 'healthy', { app: 'payments-db' }, { capacity: '64Gi', mode: 'ReadWriteOnce' }),

    node(aks, 'Namespace', '', 'data', 'healthy', { team: 'data' }, { workloads: 1, services: 1 }),
    node(aks, 'Service', 'data', 'redis', 'healthy', { app: 'redis' }, { type: 'ClusterIP', port: 6379 }),
    node(aks, 'StatefulSet', 'data', 'redis', 'healthy', { app: 'redis' }, { replicas: '1/1', storage: '16Gi' }),
    node(aks, 'Pod', 'data', 'redis-0', 'healthy', { app: 'redis' }, { ready: true, restarts: 0, node: 'aks-node-a' }),
    node(aks, 'PersistentVolumeClaim', 'data', 'redis-data', 'healthy', { app: 'redis' }, { capacity: '16Gi', mode: 'ReadWriteOnce' }),
  ],
  edges: [
    owns(local, '', 'Cluster', 'native-dev', '', 'Namespace', 'platform'),
    owns(local, '', 'Cluster', 'native-dev', '', 'Namespace', 'checkout'),
    owns(local, '', 'Cluster', 'native-dev', '', 'Namespace', 'observability'),
    owns(aks, '', 'Cluster', 'aks-prod-east', '', 'Namespace', 'edge'),
    owns(aks, '', 'Cluster', 'aks-prod-east', '', 'Namespace', 'payments'),
    owns(aks, '', 'Cluster', 'aks-prod-east', '', 'Namespace', 'data'),
    ref(local, '', 'CustomResourceDefinition', 'widgets.platform.example.com', 'platform', 'CustomResource', 'Widget:checkout-dashboard', 'owns', 'CustomResourceDefinition.spec.names.kind'),
    ref(local, 'platform', 'CustomResource', 'Widget:checkout-dashboard', 'platform', 'Secret', 'kuviewer-admin-token', 'references', 'spec.secretRef', 'inferred'),
    ref(local, 'platform', 'CustomResource', 'Widget:checkout-dashboard', 'platform', 'Service', 'kuviewer-api', 'references', 'spec.serviceRef', 'inferred'),
    ref(aks, '', 'CustomResourceDefinition', 'rollouts.argoproj.io', 'edge', 'CustomResource', 'Rollout:edge-gateway', 'owns', 'CustomResourceDefinition.spec.names.kind'),
    ref(aks, 'edge', 'CustomResource', 'Rollout:edge-gateway', 'edge', 'Service', 'edge-gateway', 'references', 'spec.serviceName', 'inferred'),

    owns(local, 'platform', 'Deployment', 'kuviewer-api', 'platform', 'ReplicaSet', 'kuviewer-api-6d9c4'),
    owns(local, 'platform', 'ReplicaSet', 'kuviewer-api-6d9c4', 'platform', 'Pod', 'kuviewer-api-6d9c4-a'),
    owns(local, 'platform', 'ReplicaSet', 'kuviewer-api-6d9c4', 'platform', 'Pod', 'kuviewer-api-6d9c4-b'),
    endpoint(local, 'platform', 'Service', 'kuviewer-api', 'platform', 'Pod', 'kuviewer-api-6d9c4-a'),
    endpoint(local, 'platform', 'Service', 'kuviewer-api', 'platform', 'Pod', 'kuviewer-api-6d9c4-b'),
    ref(local, 'platform', 'Pod', 'kuviewer-api-6d9c4-a', 'platform', 'ConfigMap', 'kuviewer-config', 'env-from', 'Pod.spec.containers.envFrom.configMapRef'),
    ref(local, 'platform', 'Pod', 'kuviewer-api-6d9c4-b', 'platform', 'Secret', 'kuviewer-admin-token', 'env-from', 'Pod.spec.containers.envFrom.secretRef'),
    ref(local, 'platform', 'Pod', 'kuviewer-api-6d9c4-a', 'platform', 'ServiceAccount', 'kuviewer-api', 'uses-service-account', 'Pod.spec.serviceAccountName'),
    schedule(local, 'platform', 'kuviewer-api-6d9c4-a', 'worker-a'),
    schedule(local, 'platform', 'kuviewer-api-6d9c4-b', 'worker-b'),

    route(local, 'checkout', 'Ingress', 'checkout-web', 'checkout', 'Service', 'checkout-api'),
    route(local, 'checkout', 'Ingress', 'checkout-web', 'checkout', 'Service', 'checkout-canary'),
    owns(local, 'checkout', 'Deployment', 'checkout-api', 'checkout', 'ReplicaSet', 'checkout-api-7c8f9'),
    owns(local, 'checkout', 'CronJob', 'checkout-reconcile', 'checkout', 'Job', 'checkout-reconcile-286'),
    ref(local, 'checkout', 'HorizontalPodAutoscaler', 'checkout-api', 'checkout', 'Deployment', 'checkout-api', 'targets-scale', 'HorizontalPodAutoscaler.spec.scaleTargetRef'),
    ref(local, 'checkout', 'NetworkPolicy', 'checkout-api-ingress', 'checkout', 'Pod', 'checkout-api-7c8f9-a', 'applies-to', 'NetworkPolicy.spec.podSelector', 'inferred'),
    ref(local, 'checkout', 'NetworkPolicy', 'checkout-api-ingress', 'checkout', 'Pod', 'checkout-api-7c8f9-b', 'applies-to', 'NetworkPolicy.spec.podSelector', 'inferred'),
    ref(local, 'checkout', 'NetworkPolicy', 'checkout-api-ingress', 'platform', 'Pod', 'kuviewer-api-6d9c4-a', 'allows-ingress', 'NetworkPolicy.spec.ingress.from', 'inferred'),
    ref(local, 'checkout', 'NetworkPolicy', 'checkout-api-ingress', 'checkout', 'Pod', 'checkout-db-0', 'allows-egress', 'NetworkPolicy.spec.egress.to', 'inferred'),
    owns(local, 'checkout', 'ReplicaSet', 'checkout-api-7c8f9', 'checkout', 'Pod', 'checkout-api-7c8f9-a'),
    owns(local, 'checkout', 'ReplicaSet', 'checkout-api-7c8f9', 'checkout', 'Pod', 'checkout-api-7c8f9-b'),
    endpoint(local, 'checkout', 'Service', 'checkout-api', 'checkout', 'Pod', 'checkout-api-7c8f9-a'),
    endpoint(local, 'checkout', 'Service', 'checkout-api', 'checkout', 'Pod', 'checkout-api-7c8f9-b'),
    owns(local, 'checkout', 'StatefulSet', 'checkout-db', 'checkout', 'Pod', 'checkout-db-0'),
    endpoint(local, 'checkout', 'Service', 'checkout-db', 'checkout', 'Pod', 'checkout-db-0'),
    ref(local, 'checkout', 'StatefulSet', 'checkout-db', 'checkout', 'PersistentVolumeClaim', 'checkout-db-data', 'binds-storage', 'volumeClaimTemplates'),
    ref(local, 'checkout', 'PersistentVolumeClaim', 'checkout-db-data', '', 'PersistentVolume', 'pv-checkout-db', 'binds-storage', 'PersistentVolumeClaim.spec.volumeName'),
    ref(local, 'checkout', 'PersistentVolumeClaim', 'checkout-db-data', '', 'StorageClass', 'local-path', 'binds-storage', 'PersistentVolumeClaim.spec.storageClassName'),
    ref(local, 'checkout', 'Pod', 'checkout-api-7c8f9-a', 'checkout', 'ConfigMap', 'checkout-config', 'env-from', 'Pod.spec.containers.envFrom.configMapRef'),
    ref(local, 'checkout', 'Pod', 'checkout-api-7c8f9-b', 'checkout', 'Secret', 'checkout-api-secret', 'env-from', 'Pod.spec.containers.envFrom.secretRef'),
    schedule(local, 'checkout', 'checkout-api-7c8f9-a', 'worker-b'),
    schedule(local, 'checkout', 'checkout-api-7c8f9-b', 'worker-c'),
    schedule(local, 'checkout', 'checkout-db-0', 'worker-c'),

    owns(local, 'observability', 'DaemonSet', 'node-agent', 'observability', 'Pod', 'node-agent-a'),
    owns(local, 'observability', 'DaemonSet', 'node-agent', 'observability', 'Pod', 'node-agent-b'),
    endpoint(local, 'observability', 'Service', 'telemetry', 'observability', 'Pod', 'node-agent-a'),
    ref(local, 'observability', 'Pod', 'node-agent-a', 'observability', 'ConfigMap', 'agent-config', 'mounts', 'Pod.spec.volumes.configMap'),
    schedule(local, 'observability', 'node-agent-a', 'worker-a'),
    schedule(local, 'observability', 'node-agent-b', 'worker-b'),

    route(aks, 'edge', 'Ingress', 'public-edge', 'edge', 'Service', 'edge-gateway'),
    ref(aks, 'edge', 'HTTPRoute', 'edge-api', 'edge', 'Gateway', 'public-gateway', 'attaches-to', 'HTTPRoute.spec.parentRefs'),
    ref(aks, 'edge', 'HTTPRoute', 'edge-api', 'edge', 'Service', 'edge-gateway', 'routes-to', 'HTTPRoute.spec.rules.backendRefs'),
    ref(aks, 'edge', 'GRPCRoute', 'edge-grpc', 'edge', 'Gateway', 'public-gateway', 'attaches-to', 'GRPCRoute.spec.parentRefs'),
    ref(aks, 'edge', 'GRPCRoute', 'edge-grpc', 'edge', 'Service', 'edge-gateway', 'routes-to', 'GRPCRoute.spec.rules.backendRefs'),
    ref(aks, 'edge', 'TLSRoute', 'edge-tls', 'edge', 'Gateway', 'public-gateway', 'attaches-to', 'TLSRoute.spec.parentRefs'),
    ref(aks, 'edge', 'TLSRoute', 'edge-tls', 'edge', 'Service', 'edge-gateway', 'routes-to', 'TLSRoute.spec.rules.backendRefs'),
    ref(aks, 'edge', 'TCPRoute', 'edge-tcp', 'edge', 'Gateway', 'public-gateway', 'attaches-to', 'TCPRoute.spec.parentRefs'),
    ref(aks, 'edge', 'TCPRoute', 'edge-tcp', 'edge', 'Service', 'edge-gateway', 'routes-to', 'TCPRoute.spec.rules.backendRefs'),
    endpoint(aks, 'edge', 'Service', 'edge-gateway', 'edge', 'Pod', 'edge-gateway-a'),
    endpoint(aks, 'edge', 'Service', 'edge-gateway', 'edge', 'Pod', 'edge-gateway-b'),
    owns(aks, 'edge', 'Deployment', 'edge-gateway', 'edge', 'Pod', 'edge-gateway-a'),
    owns(aks, 'edge', 'Deployment', 'edge-gateway', 'edge', 'Pod', 'edge-gateway-b'),
    schedule(aks, 'edge', 'edge-gateway-a', 'aks-node-a'),
    schedule(aks, 'edge', 'edge-gateway-b', 'aks-node-b'),

    endpoint(aks, 'payments', 'Service', 'payments-api', 'payments', 'Pod', 'payments-api-a'),
    endpoint(aks, 'payments', 'Service', 'payments-api', 'payments', 'Pod', 'payments-api-b'),
    owns(aks, 'payments', 'Deployment', 'payments-api', 'payments', 'ReplicaSet', 'payments-api-9f41d'),
    owns(aks, 'payments', 'ReplicaSet', 'payments-api-9f41d', 'payments', 'Pod', 'payments-api-a'),
    owns(aks, 'payments', 'ReplicaSet', 'payments-api-9f41d', 'payments', 'Pod', 'payments-api-b'),
    ref(aks, 'payments', 'Pod', 'payments-api-a', 'payments', 'ConfigMap', 'payments-config', 'env-from', 'Pod.spec.containers.envFrom.configMapRef'),
    ref(aks, 'payments', 'Pod', 'payments-api-b', 'payments', 'Secret', 'payments-secret', 'env-from', 'Pod.spec.containers.envFrom.secretRef'),
    ref(aks, 'payments', 'Pod', 'payments-api-a', 'payments', 'ServiceAccount', 'payments-api', 'uses-service-account', 'Pod.spec.serviceAccountName'),
    owns(aks, 'payments', 'StatefulSet', 'payments-db', 'payments', 'Pod', 'payments-db-0'),
    endpoint(aks, 'payments', 'Service', 'payments-db', 'payments', 'Pod', 'payments-db-0'),
    ref(aks, 'payments', 'StatefulSet', 'payments-db', 'payments', 'PersistentVolumeClaim', 'payments-db-data', 'binds-storage', 'volumeClaimTemplates'),
    ref(aks, 'payments', 'PersistentVolumeClaim', 'payments-db-data', '', 'StorageClass', 'managed-csi', 'binds-storage', 'PersistentVolumeClaim.spec.storageClassName'),
    schedule(aks, 'payments', 'payments-api-a', 'aks-node-a'),
    schedule(aks, 'payments', 'payments-api-b', 'aks-node-b'),
    schedule(aks, 'payments', 'payments-db-0', 'aks-node-b'),

    owns(aks, 'data', 'StatefulSet', 'redis', 'data', 'Pod', 'redis-0'),
    endpoint(aks, 'data', 'Service', 'redis', 'data', 'Pod', 'redis-0'),
    ref(aks, 'data', 'StatefulSet', 'redis', 'data', 'PersistentVolumeClaim', 'redis-data', 'binds-storage', 'volumeClaimTemplates'),
    ref(aks, 'data', 'PersistentVolumeClaim', 'redis-data', '', 'StorageClass', 'managed-csi', 'binds-storage', 'PersistentVolumeClaim.spec.storageClassName'),
    schedule(aks, 'data', 'redis-0', 'aks-node-a'),
  ],
};

function node(
  clusterId: string,
  kind: ResourceKind,
  namespace: string,
  name: string,
  status: ResourceStatus,
  labels: Record<string, string>,
  summary: Record<string, SummaryValue>,
): TopologyNode {
  return {
    id: id(clusterId, namespace, kind, name),
    clusterId,
    kind,
    namespace: namespace || undefined,
    name,
    status,
    labels,
    summary,
    x: 0,
    y: 0,
  };
}

function owns(clusterId: string, sourceNamespace: string, sourceKind: ResourceKind, sourceName: string, targetNamespace: string, targetKind: ResourceKind, targetName: string) {
  return ref(clusterId, sourceNamespace, sourceKind, sourceName, targetNamespace, targetKind, targetName, 'owns', 'metadata.ownerReferences');
}

function route(clusterId: string, sourceNamespace: string, sourceKind: ResourceKind, sourceName: string, targetNamespace: string, targetKind: ResourceKind, targetName: string) {
  return ref(clusterId, sourceNamespace, sourceKind, sourceName, targetNamespace, targetKind, targetName, 'routes-to', 'Ingress.spec.rules.http.paths.backend.service');
}

function endpoint(clusterId: string, sourceNamespace: string, sourceKind: ResourceKind, sourceName: string, targetNamespace: string, targetKind: ResourceKind, targetName: string) {
  return ref(clusterId, sourceNamespace, sourceKind, sourceName, targetNamespace, targetKind, targetName, 'service-endpoint', 'EndpointSlice.endpoints.targetRef');
}

function schedule(clusterId: string, podNamespace: string, podName: string, nodeName: string) {
  return ref(clusterId, podNamespace, 'Pod', podName, '', 'Node', nodeName, 'scheduled-on', 'Pod.spec.nodeName');
}

function ref(
  clusterId: string,
  sourceNamespace: string,
  sourceKind: ResourceKind,
  sourceName: string,
  targetNamespace: string,
  targetKind: ResourceKind,
  targetName: string,
  type: EdgeType,
  sourceField: string,
  confidence: TopologyEdge['confidence'] = 'observed',
): TopologyEdge {
  const source = id(clusterId, sourceNamespace, sourceKind, sourceName);
  const target = id(clusterId, targetNamespace, targetKind, targetName);
  return {
    id: `${source}->${target}:${type}:${sourceField}`,
    clusterId,
    source,
    target,
    type,
    confidence,
    sourceField,
  };
}

function id(clusterId: string, namespace: string, kind: ResourceKind, name: string) {
  return namespace ? `${clusterId}:${namespace}:${kind}:${name}` : `${clusterId}:${kind}:${name}`;
}
