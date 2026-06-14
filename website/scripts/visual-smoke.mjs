import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.KUVIEWER_VISUAL_URL || 'http://127.0.0.1:4174/kuviewer/';
const adminToken = process.env.KUVIEWER_ADMIN_TOKEN || 'kuviewer-admin';
const visualMode = process.env.KUVIEWER_VISUAL_MODE || 'upload';
const outputDir = process.env.KUVIEWER_VISUAL_OUTPUT || path.join(process.cwd(), 'artifacts', 'visual-smoke');
const uploadManifestPath = path.join(outputDir, 'visual-upload.yaml');

const viewports = [
  { name: 'desktop', viewport: { width: 1440, height: 980 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
];

await mkdir(outputDir, { recursive: true });
await writeFile(uploadManifestPath, getSampleManifest(), 'utf8');

for (const target of viewports) {
  await runViewport(target.name, target.viewport);
}

async function runViewport(name, viewport) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport });
  await context.addInitScript((token) => {
    window.localStorage.removeItem('kuviewer_admin_token');
    window.sessionStorage.setItem('kuviewer_admin_token', token);
  }, adminToken);
  const page = await context.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Kuviewer' })).toBeVisible({ timeout: 10_000 });
    await selectVisualMode(page, visualMode);
    await expect(page.getByRole('heading', { name: '토폴로지 맵' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/401|unauthorized/i)).toHaveCount(0);

    await page.waitForFunction(() => {
      const text = document.body.innerText.match(/(\d+) 노드 · (\d+) 엣지/);
      return text && Number(text[1]) > 0 && Number(text[2]) > 0;
    }, undefined, { timeout: 15_000 });
    const graphCount = await page.locator('text=/\\d+ 노드 · \\d+ 엣지/').first().innerText({ timeout: 10_000 });
    const match = graphCount.match(/(\d+) 노드 · (\d+) 엣지/);
    if (!match || Number(match[1]) < 1 || Number(match[2]) < 1) {
      throw new Error(`unexpected graph count: ${graphCount}`);
    }

    await verifyNodeDrag(page, name);

    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    if (overflow.documentWidth > overflow.viewportWidth + 4) {
      throw new Error(`page overflows horizontally: ${overflow.documentWidth} > ${overflow.viewportWidth}`);
    }

    await page.screenshot({ path: path.join(outputDir, `${name}-topology.png`), fullPage: true });
    await page.getByRole('button', { name: /트래픽 흐름/ }).click();
    await expect(page.getByRole('heading', { name: '트래픽 흐름' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/현재 필터에 맞는 트래픽 흐름이 없습니다/)).toHaveCount(0);
    await page.screenshot({ path: path.join(outputDir, `${name}-flow.png`), fullPage: true });
  } finally {
    await browser.close();
  }
}

async function selectVisualMode(page, mode) {
  if (mode === 'upload') {
    await page.getByTestId('source-mode-upload').click();
    await page.setInputFiles('[data-testid="upload-files"]', uploadManifestPath);
    return;
  }

  if (mode === 'mock') {
    await page.getByTestId('source-mode-mock').click();
    return;
  }

  await page.getByTestId('source-mode-live').click();
  const unlockButton = page.getByTestId('unlock-live');
  if (await unlockButton.isVisible().catch(() => false)) {
    await page.getByTestId('live-token-input').fill(adminToken);
    await unlockButton.click();
  }
}

async function verifyNodeDrag(page, viewportName) {
  await page.locator('.ku-react-flow').scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await page.locator('[data-testid^="topology-node-"]').first().waitFor({ state: 'visible', timeout: 10_000 });
  const { node, box: selectedBox } = await findClickableResourceNode(page);
  const beforeTransform = await node.evaluate((element) => element.getAttribute('style') || '');
  let before = selectedBox;
  if (!before) {
    throw new Error(`node bounding box unavailable for ${viewportName}`);
  }

  const viewport = page.viewportSize();
  if (viewport && (before.y < 72 || before.y + before.height > viewport.height - 12)) {
    await page.mouse.wheel(0, before.y + before.height / 2 - viewport.height / 2);
    await page.waitForTimeout(140);
    before = await node.boundingBox();
  }

  if (!before || (viewport && (before.y < 0 || before.y > viewport.height))) {
    throw new Error(`node is outside viewport for ${viewportName}`);
  }

  const centerX = before.x + before.width / 2;
  const centerY = before.y + before.height / 2;
  const deltaX = viewport && centerX > viewport.width * 0.58 ? -120 : 120;
  const deltaY = viewport && centerY > viewport.height * 0.64 ? -110 : 120;

  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + deltaX, centerY + deltaY, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(180);

  const afterTransform = await node.evaluate((element) => element.getAttribute('style') || '');
  const after = await node.boundingBox();
  const movedOnScreen = after && (Math.abs(after.x - before.x) >= 3 || Math.abs(after.y - before.y) >= 3);
  if (beforeTransform === afterTransform && !movedOnScreen) {
    throw new Error(`node drag did not move enough for ${viewportName}`);
  }
}

async function findClickableResourceNode(page) {
  const viewport = page.viewportSize();
  const nodes = page.locator('.react-flow__node-resource');
  const count = Math.min(await nodes.count(), 80);

  for (let index = 0; index < count; index += 1) {
    const node = nodes.nth(index);
    const box = await node.boundingBox();
    if (!box || !viewport) {
      continue;
    }

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    if (centerX < 8 || centerX > viewport.width - 8 || centerY < 96 || centerY > viewport.height - 16) {
      continue;
    }

    const hitResourceNode = await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.react-flow__node-resource')), [centerX, centerY]);
    if (hitResourceNode) {
      return { node, box };
    }
  }

  const fallback = nodes.first();
  await fallback.waitFor({ state: 'visible', timeout: 10_000 });
  const fallbackBox = await fallback.boundingBox();
  if (!fallbackBox) {
    throw new Error('clickable resource node unavailable');
  }
  return { node: fallback, box: fallbackBox };
}

function getSampleManifest() {
  return `apiVersion: v1
kind: Namespace
metadata:
  name: checkout
---
apiVersion: v1
kind: Namespace
metadata:
  name: observability
---
apiVersion: v1
kind: Node
metadata:
  name: worker-a
  labels:
    kubernetes.io/hostname: worker-a
status:
  conditions:
    - type: Ready
      status: "True"
---
apiVersion: v1
kind: Node
metadata:
  name: worker-b
  labels:
    kubernetes.io/hostname: worker-b
status:
  conditions:
    - type: Ready
      status: "True"
---
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-fast
provisioner: kubernetes.io/no-provisioner
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: orders-pv
spec:
  storageClassName: local-fast
  capacity:
    storage: 10Gi
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: checkout-config
  namespace: checkout
data:
  PAYMENT_URL: http://payments.checkout.svc.cluster.local
---
apiVersion: v1
kind: Secret
metadata:
  name: checkout-secret
  namespace: checkout
type: Opaque
data:
  token: cmVkYWN0ZWQ=
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: orders-data
  namespace: checkout
spec:
  storageClassName: local-fast
  volumeName: orders-pv
  resources:
    requests:
      storage: 10Gi
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: checkout-sa
  namespace: checkout
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-api
  namespace: checkout
spec:
  replicas: 2
  selector:
    matchLabels:
      app: checkout-api
---
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: checkout-api-76d9c
  namespace: checkout
  ownerReferences:
    - apiVersion: apps/v1
      kind: Deployment
      name: checkout-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: checkout-api
---
apiVersion: v1
kind: Pod
metadata:
  name: checkout-api-76d9c-a
  namespace: checkout
  labels:
    app: checkout-api
  ownerReferences:
    - apiVersion: apps/v1
      kind: ReplicaSet
      name: checkout-api-76d9c
spec:
  nodeName: worker-a
  serviceAccountName: checkout-sa
  containers:
    - name: app
      image: checkout:1.0.0
      envFrom:
        - configMapRef:
            name: checkout-config
        - secretRef:
            name: checkout-secret
      volumeMounts:
        - name: orders
          mountPath: /data
  volumes:
    - name: orders
      persistentVolumeClaim:
        claimName: orders-data
status:
  phase: Running
---
apiVersion: v1
kind: Pod
metadata:
  name: checkout-api-76d9c-b
  namespace: checkout
  labels:
    app: checkout-api
  ownerReferences:
    - apiVersion: apps/v1
      kind: ReplicaSet
      name: checkout-api-76d9c
spec:
  nodeName: worker-b
  serviceAccountName: checkout-sa
  containers:
    - name: app
      image: checkout:1.0.0
status:
  phase: Running
---
apiVersion: v1
kind: Service
metadata:
  name: checkout-api
  namespace: checkout
spec:
  type: ClusterIP
  selector:
    app: checkout-api
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: checkout-api
  namespace: checkout
spec:
  minReplicas: 2
  maxReplicas: 6
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: checkout-api
status:
  currentReplicas: 2
  desiredReplicas: 2
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: checkout-api-ingress
  namespace: checkout
spec:
  podSelector:
    matchLabels:
      app: checkout-api
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: kuviewer-api
      ports:
        - protocol: TCP
          port: 80
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: checkout-db
      ports:
        - protocol: TCP
          port: 5432
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: checkout-reconcile
  namespace: checkout
spec:
  schedule: "*/15 * * * *"
---
apiVersion: batch/v1
kind: Job
metadata:
  name: checkout-reconcile-286
  namespace: checkout
  ownerReferences:
    - apiVersion: batch/v1
      kind: CronJob
      name: checkout-reconcile
spec:
  completions: 1
status:
  succeeded: 1
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: checkout
  namespace: checkout
spec:
  rules:
    - host: checkout.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: checkout-api
                port:
                  number: 80
---
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: checkout-gateway
  namespace: checkout
spec:
  gatewayClassName: example
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      hostname: checkout.local
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: checkout-route
  namespace: checkout
spec:
  parentRefs:
    - name: checkout-gateway
  hostnames:
    - checkout.local
  rules:
    - backendRefs:
        - name: checkout-api
          port: 80
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-agent
  namespace: observability
spec:
  selector:
    matchLabels:
      app: node-agent
---
apiVersion: v1
kind: Pod
metadata:
  name: node-agent-worker-a
  namespace: observability
  labels:
    app: node-agent
spec:
  nodeName: worker-a
  containers:
    - name: agent
      image: agent:1.0.0
status:
  phase: Running
---
apiVersion: v1
kind: Service
metadata:
  name: node-agent
  namespace: observability
spec:
  selector:
    app: node-agent
  ports:
    - port: 9090
`;
}

console.log(`visual smoke passed: ${baseUrl} (${visualMode})`);
console.log(`screenshots: ${outputDir}`);
