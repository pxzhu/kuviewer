import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.KUVIEWER_VISUAL_URL || 'http://127.0.0.1:4174/kuviewer/';
const adminToken = process.env.KUVIEWER_ADMIN_TOKEN || 'kuviewer-admin';
const visualMode = process.env.KUVIEWER_VISUAL_MODE || 'upload';
const outputDir = process.env.KUVIEWER_VISUAL_OUTPUT || path.join(process.cwd(), 'artifacts', 'visual-smoke');
const uploadManifestPath = path.join(outputDir, 'visual-upload.yaml');
const conflictPresetPath = path.join(outputDir, 'visual-resource-view-conflict.json');
const wrappedPresetPath = path.join(outputDir, 'visual-resource-view-items-wrapper.json');
const unsafeTopologyPath = path.join(outputDir, 'visual-unsafe-topology.json');

const viewports = [
  { name: 'desktop', viewport: { width: 1440, height: 980 }, isMobile: false, hasTouch: false },
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];

await mkdir(outputDir, { recursive: true });
await writeFile(uploadManifestPath, getSampleManifest(), 'utf8');
await writeFile(conflictPresetPath, JSON.stringify([
  {
    name: 'Visual Conflict',
    group: 'Imported',
    query: 'checkout',
    cluster: 'all',
    namespace: 'all',
    kind: 'Pod',
    status: 'all',
    order: 1,
    updatedAt: 1700000000000,
  },
], null, 2), 'utf8');
await writeFile(wrappedPresetPath, JSON.stringify({
  items: [
    {
      name: 'Visual Wrapped Import',
      group: 'Wrapped',
      query: 'gateway',
      cluster: 'all',
      namespace: 'all',
      kind: 'Service',
      status: 'healthy',
      order: 1,
      updatedAt: 1700000100000,
    },
  ],
}, null, 2), 'utf8');
await writeFile(unsafeTopologyPath, JSON.stringify(getUnsafeTopologyFixture(), null, 2), 'utf8');

for (const target of viewports) {
  await runViewport(target);
}

async function runViewport({ name, viewport, isMobile, hasTouch }) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, isMobile, hasTouch, acceptDownloads: true });
  await context.addInitScript((token) => {
    window.localStorage.removeItem('kuviewer_admin_token');
    window.sessionStorage.setItem('kuviewer_admin_token', token);
  }, adminToken);
  const page = await context.newPage();
  const browserIssues = [];
  const failedResponses = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type()) && !/^Failed to load resource:/i.test(message.text())) {
      browserIssues.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    browserIssues.push(`pageerror: ${error.message}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()}: ${response.url()}`);
    }
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Kuviewer' })).toBeVisible({ timeout: 10_000 });
    await assertLazyChunkState(page, 'ResourceExplorerDetail', false, `${name} initial resource detail`);
    await assertLazyChunkState(page, 'desktopConnectionProfile', false, `${name} initial desktop runtime`);
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

    await assertTopologyRendererIsolation(page, isMobile, name);
    await verifyNodeDrag(page, name);

    await assertNoHorizontalOverflow(page, `${name} topology`);

    await page.screenshot({ path: path.join(outputDir, `${name}-topology.png`), fullPage: true });
    await verifySnapshotComparison(page, visualMode, name);
    await verifyResourceExplorer(page, name);
    await assertLazyChunkState(page, 'ResourceExplorerDetail', true, `${name} resource detail`);
    await assertLazyChunkState(page, 'desktopConnectionProfile', false, `${name} web desktop runtime`);
    await page.getByRole('button', { name: /트래픽 흐름/ }).click();
    await expect(page.getByRole('heading', { name: '트래픽 흐름' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/현재 필터에 맞는 트래픽 흐름이 없습니다/)).toHaveCount(0);
    await page.screenshot({ path: path.join(outputDir, `${name}-flow.png`), fullPage: true });
    await verifyImportedSnapshotRedaction(page);
    assertNoBrowserIssues(browserIssues, failedResponses, name);
  } finally {
    await browser.close();
  }
}

async function assertLazyChunkState(page, chunkName, expectedLoaded, context) {
  const loaded = await page.evaluate((name) => performance.getEntriesByType('resource').some((entry) => entry.name.includes(name)), chunkName);
  if (loaded !== expectedLoaded) {
    throw new Error(`${context}: ${chunkName} expected loaded=${expectedLoaded}, received ${loaded}`);
  }
}

async function assertTopologyRendererIsolation(page, isMobile, context) {
  await assertLazyChunkState(page, 'topologyCanvasLayout', true, `${context} shared topology layout`);
  await assertLazyChunkState(page, 'MobileTopologyCanvas', isMobile, `${context} mobile topology renderer`);
  await assertLazyChunkState(page, 'DesktopTopologyCanvas', !isMobile, `${context} desktop topology renderer`);
}

async function verifyImportedSnapshotRedaction(page) {
  const sensitiveFixtureValue = ['redaction', 'fixture'].join('-');
  await page.setInputFiles('[data-testid="import-topology-json"]', unsafeTopologyPath);
  await page.getByRole('button', { name: /리소스 탐색/ }).click();
  await expect(page.getByRole('heading', { name: '리소스 탐색' })).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('resource-view-query').fill('import-secret');
  await expect(page.getByTestId('resource-result-count')).toContainText('결과 1 /', { timeout: 10_000 });
  await expect(page.getByText(sensitiveFixtureValue, { exact: false })).toHaveCount(0);
  if (!(await page.getByTestId('resource-detail-section-body-annotations').isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /Annotations 펼치기/ }).click();
  }
  await expect(page.getByText('redacted', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('hidden', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
}

function getUnsafeTopologyFixture() {
  const clusterId = 'import-security';
  const clusterNodeId = `${clusterId}::Cluster:import-security`;
  const secretNodeId = `${clusterId}:default:Secret:import-secret`;
  const sensitiveFixtureValue = ['redaction', 'fixture'].join('-');
  return {
    clusters: [{
      id: clusterId,
      name: 'import-security',
      provider: 'Import',
      version: 'test',
      nodeReady: 0,
      nodeTotal: 0,
      podRunning: 0,
      podWarning: 0,
      namespaces: 1,
    }],
    nodes: [
      {
        id: clusterNodeId,
        clusterId,
        kind: 'Cluster',
        name: 'import-security',
        status: 'healthy',
        labels: {},
        summary: { source: 'import' },
        x: 0,
        y: 0,
      },
      {
        id: secretNodeId,
        clusterId,
        kind: 'Secret',
        namespace: 'default',
        name: 'import-secret',
        status: 'unknown',
        labels: { app: 'security-smoke' },
        annotations: { 'example.com/token': sensitiveFixtureValue },
        summary: { type: 'Opaque', keys: 1, values: sensitiveFixtureValue, token: sensitiveFixtureValue },
        x: 0,
        y: 0,
      },
    ],
    edges: [{
      id: `${clusterNodeId}->${secretNodeId}:owns:metadata.namespace`,
      clusterId,
      source: clusterNodeId,
      target: secretNodeId,
      type: 'owns',
      confidence: 'observed',
      sourceField: 'metadata.namespace',
    }],
  };
}

async function verifySnapshotComparison(page, initialMode, viewportName) {
  const sensitiveFixtureValue = ['redaction', 'fixture'].join('-');
  await page.getByRole('button', { name: /스냅샷 비교/ }).click();
  await expect(page.getByTestId('snapshot-compare-panel')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: '비교할 기준이 없습니다' })).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('snapshot-compare-capture').click();
  await expect(page.getByTestId('snapshot-compare-changed-count')).toContainText('0', { timeout: 10_000 });
  await expect(page.getByTestId('snapshot-compare-added-count')).toContainText('0');
  await expect(page.getByTestId('snapshot-compare-removed-count')).toContainText('0');
  await expect(page.getByTestId('snapshot-history-count')).toContainText('1 / 8');
  const firstBaselineId = await page.getByTestId('snapshot-compare-baseline-select').getAttribute('data-selected-value');
  if (!firstBaselineId) {
    throw new Error('snapshot history did not select the first capture as baseline');
  }

  const comparisonMode = initialMode === 'mock' ? 'upload' : 'mock';
  await selectVisualMode(page, comparisonMode);
  await expect(page.getByTestId('snapshot-compare-panel').locator('tbody tr').first()).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('snapshot-compare-capture').click();
  await expect(page.getByTestId('snapshot-history-count')).toContainText('2 / 8');
  const historicalCurrentId = (await readKuSelectOptions(page, 'snapshot-compare-current-select'))
    .find((option) => option.value && option.value !== firstBaselineId && !option.disabled)?.value || '';
  if (!historicalCurrentId) {
    throw new Error('snapshot history did not retain a selectable current capture');
  }
  await selectKuOption(page, 'snapshot-compare-current-select', historicalCurrentId);
  await expect(page.getByTestId('snapshot-compare-current-count')).toContainText('resources');
  await selectKuOption(page, 'snapshot-compare-current-select', '');
  for (let captureIndex = 0; captureIndex < 7; captureIndex += 1) {
    await page.getByTestId('snapshot-compare-capture').click();
  }
  await expect(page.getByTestId('snapshot-history-count')).toContainText('8 / 8');
  if (!(await readKuSelectOptionValues(page, 'snapshot-compare-baseline-select')).includes(firstBaselineId)) {
    throw new Error('snapshot history baseline entry was not retained after reaching the history cap');
  }
  const historyMetadataDownload = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('snapshot-history-metadata-export').click(),
  ]).then(([downloadResult]) => downloadResult);
  const historyMetadataPath = await historyMetadataDownload.path();
  if (!historyMetadataPath || !/^kuviewer-snapshot-history-.+\.json$/.test(historyMetadataDownload.suggestedFilename())) {
    throw new Error(`snapshot history metadata filename/path invalid: ${historyMetadataDownload.suggestedFilename()}`);
  }
  const historyMetadataPayload = JSON.parse(await readFile(historyMetadataPath, 'utf8'));
  if (historyMetadataPayload.kind !== 'kuviewer.snapshotHistoryMetadata' || historyMetadataPayload.count !== 8) {
    throw new Error('snapshot history metadata export shape is invalid');
  }
  if (JSON.stringify(historyMetadataPayload).includes(sensitiveFixtureValue) || historyMetadataPayload.items.some((item) => 'snapshot' in item)) {
    throw new Error('snapshot history metadata export included topology or sensitive payload data');
  }
  await page.getByTestId('snapshot-history-manager').locator('summary').click();
  const firstHistoryRow = page.getByTestId('snapshot-history-row').first();
  await firstHistoryRow.getByTestId('snapshot-history-rename').click();
  await firstHistoryRow.getByTestId('snapshot-history-rename-input').fill('Visual checkpoint');
  await firstHistoryRow.getByTestId('snapshot-history-rename-save').click();
  await expect(firstHistoryRow).toContainText('Visual checkpoint');
  const renamedHistoryId = (await readKuSelectOptions(page, 'snapshot-compare-current-select'))
    .find((option) => option.label.includes('Visual checkpoint'))?.value || '';
  if (!renamedHistoryId) {
    throw new Error('renamed snapshot history entry was not reflected in selectors');
  }
  await selectKuOption(page, 'snapshot-compare-current-select', renamedHistoryId);
  await firstHistoryRow.getByTestId('snapshot-history-delete').click();
  await expect(firstHistoryRow.getByTestId('snapshot-history-delete')).toContainText('삭제 확인');
  await firstHistoryRow.getByTestId('snapshot-history-delete').click();
  await expect(page.getByTestId('snapshot-history-count')).toContainText('7 / 8');
  await expect(page.getByTestId('snapshot-compare-current-select')).toHaveAttribute('data-selected-value', '');
  if ((await readKuSelectOptionValues(page, 'snapshot-compare-current-select')).includes(renamedHistoryId)) {
    throw new Error('deleted snapshot history entry remained selectable');
  }
  await page.getByTestId('snapshot-compare-capture').click();
  await expect(page.getByTestId('snapshot-history-count')).toContainText('8 / 8');
  const latestHistoryRow = page.getByTestId('snapshot-history-row').first();
  await latestHistoryRow.getByTestId('snapshot-history-rename').click();
  await latestHistoryRow.getByTestId('snapshot-history-rename-input').fill('   ');
  await latestHistoryRow.getByTestId('snapshot-history-rename-save').click();
  await expect(latestHistoryRow).toContainText('이름을 입력해 주세요.');
  await latestHistoryRow.getByRole('button', { name: '이름 변경 취소' }).click();
  const snapshotStorageKeys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes('snapshot')));
  if (snapshotStorageKeys.length > 0) {
    throw new Error(`snapshot history leaked into localStorage: ${snapshotStorageKeys.join(',')}`);
  }
  const totalChanges = await page.locator('[data-testid^="snapshot-compare-"][data-testid$="-count"] p:nth-child(2)').evaluateAll((values) =>
    values.slice(2).reduce((total, value) => total + Number(value.textContent || 0), 0),
  );
  if (totalChanges < 1) {
    throw new Error('snapshot comparison did not detect source changes');
  }
  const relationChangeCount = Number(await page.getByTestId('snapshot-compare-relation-count').locator('p').nth(1).innerText());
  const clusterChangeCount = Number(await page.getByTestId('snapshot-compare-cluster-count').locator('p').nth(1).innerText());
  if (relationChangeCount < 1 || clusterChangeCount < 1) {
    throw new Error(`snapshot comparison drill-down counts are incomplete: relations=${relationChangeCount}, clusters=${clusterChangeCount}`);
  }

  const resourceChangeTable = page.getByTestId('snapshot-compare-resource-table');
  const resourceTotal = Number(await resourceChangeTable.getAttribute('data-total-count'));
  const resourceRendered = Number(await resourceChangeTable.getAttribute('data-rendered-count'));
  if (resourceTotal > 80 && (await resourceChangeTable.getAttribute('data-virtualized')) !== 'true') {
    throw new Error(`large resource diff was not virtualized: total=${resourceTotal}`);
  }
  if (resourceTotal > 80 && resourceRendered >= resourceTotal) {
    throw new Error(`resource virtualization rendered every row: rendered=${resourceRendered}, total=${resourceTotal}`);
  }

  await page.getByTestId('snapshot-compare-scope-relations').click();
  const relationTable = page.getByTestId('snapshot-compare-relation-table');
  await expect(relationTable).toHaveAttribute('data-virtualized', 'true');
  const relationTableTotal = Number(await relationTable.getAttribute('data-total-count'));
  const relationTableRendered = Number(await relationTable.getAttribute('data-rendered-count'));
  if (relationTableRendered >= relationTableTotal) {
    throw new Error(`relation virtualization rendered every row: rendered=${relationTableRendered}, total=${relationTableTotal}`);
  }
  await expect(page.getByTestId('snapshot-compare-relation-group-row').first()).toBeVisible({ timeout: 10_000 });
  const firstRelationChange = page.getByTestId('snapshot-compare-relation-row').first();
  await expect(firstRelationChange).toBeVisible({ timeout: 10_000 });
  await expect(firstRelationChange).toContainText(/observed|inferred/);
  await expect(firstRelationChange.locator('button')).toHaveCount(2);
  await relationTable.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);
  const relationScrollTop = await relationTable.evaluate((element) => element.scrollTop);
  if (relationScrollTop <= 0) {
    throw new Error('relation virtualized table did not scroll');
  }
  await page.getByTestId('snapshot-compare-relation-flat').click();
  await expect(page.getByTestId('snapshot-compare-relation-group-row')).toHaveCount(0);
  await expect(relationTable).toHaveAttribute('data-total-count', String(relationChangeCount));
  await page.getByTestId('snapshot-compare-relation-grouped').click();
  await expect(page.getByTestId('snapshot-compare-relation-group-row').first()).toBeVisible({ timeout: 10_000 });

  const selectedRelationTypes = ['allows-ingress', 'applies-to'];
  for (const relationType of selectedRelationTypes) {
    await page.getByTestId(`snapshot-compare-relation-type-${relationType}`).click();
  }
  await expect(page.getByTestId('snapshot-compare-relation-type-filter')).toContainText('2개 선택');
  await expect(page.getByTestId('snapshot-compare-relation-summary')).toContainText('유형 2개');
  const filteredRelationRows = page.getByTestId('snapshot-compare-relation-row');
  const filteredRelationRowCount = await filteredRelationRows.count();
  if (filteredRelationRowCount < 1) {
    throw new Error('relation type multi-filter removed every relation row');
  }
  for (let index = 0; index < filteredRelationRowCount; index += 1) {
    const rowText = await filteredRelationRows.nth(index).innerText();
    if (!selectedRelationTypes.some((relationType) => rowText.includes(relationType))) {
      throw new Error(`relation type multi-filter leaked another type: ${rowText}`);
    }
  }

  const jsonDownload = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('snapshot-compare-export-json').click(),
  ]).then(([downloadResult]) => downloadResult);
  const jsonDownloadPath = await jsonDownload.path();
  if (!jsonDownloadPath || !/^kuviewer-diff-.+-relations-.+\.json$/.test(jsonDownload.suggestedFilename())) {
    throw new Error(`snapshot JSON export filename/path invalid: ${jsonDownload.suggestedFilename()}`);
  }
  const snapshotDiffPayload = JSON.parse(await readFile(jsonDownloadPath, 'utf8'));
  assertSafeSnapshotDiffPayload(snapshotDiffPayload, selectedRelationTypes);
  await page.setInputFiles('[data-testid="snapshot-diff-import-input"]', jsonDownloadPath);
  await expect(page.getByTestId('snapshot-diff-import-preview')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('snapshot-diff-import-preview')).toContainText('검증된 diff 보고서');
  const importedPreviewText = await page.getByTestId('snapshot-diff-import-preview').innerText();
  if (importedPreviewText.includes(sensitiveFixtureValue)) {
    throw new Error('snapshot diff preview exposed a sensitive fixture value');
  }
  const invalidDiffPath = path.join(outputDir, `${viewportName}-invalid-snapshot-diff.json`);
  await writeFile(invalidDiffPath, JSON.stringify({
    ...snapshotDiffPayload,
    filters: { ...snapshotDiffPayload.filters, query: sensitiveFixtureValue },
  }), 'utf8');
  await page.setInputFiles('[data-testid="snapshot-diff-import-input"]', invalidDiffPath);
  await expect(page.getByTestId('snapshot-diff-import-error')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('snapshot-diff-import-preview')).toHaveCount(0);
  const unsupportedDiffPath = path.join(outputDir, `${viewportName}-unsupported-snapshot-diff.json`);
  await writeFile(unsupportedDiffPath, JSON.stringify({ ...snapshotDiffPayload, schemaVersion: 2 }), 'utf8');
  await page.setInputFiles('[data-testid="snapshot-diff-import-input"]', unsupportedDiffPath);
  await expect(page.getByTestId('snapshot-diff-import-error')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('snapshot-diff-import-preview')).toHaveCount(0);
  await page.setInputFiles('[data-testid="snapshot-diff-import-input"]', jsonDownloadPath);
  await expect(page.getByTestId('snapshot-diff-import-preview')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('snapshot-diff-import-error')).toHaveCount(0);
  const comparisonDiffPath = path.join(outputDir, `${viewportName}-comparison-snapshot-diff.json`);
  await writeFile(comparisonDiffPath, JSON.stringify({
    ...snapshotDiffPayload,
    exportedAt: snapshotDiffPayload.exportedAt + 1_000,
    current: {
      ...snapshotDiffPayload.current,
      label: 'visual comparison report',
      resourceCount: snapshotDiffPayload.current.resourceCount + 2,
      relationCount: snapshotDiffPayload.current.relationCount + 1,
    },
    counts: {
      ...snapshotDiffPayload.counts,
      resources: snapshotDiffPayload.counts.resources + 2,
      relations: snapshotDiffPayload.counts.relations + 1,
    },
  }), 'utf8');
  await page.setInputFiles('[data-testid="snapshot-diff-compare-input"]', comparisonDiffPath);
  await expect(page.getByTestId('snapshot-diff-report-comparison')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('snapshot-diff-report-delta-resources')).toContainText('+2');
  await expect(page.getByTestId('snapshot-diff-report-delta-relations')).toContainText('+1');
  await expect(page.getByTestId('snapshot-diff-report-delta-exported')).toContainText('0');
  const reportComparisonText = await page.getByTestId('snapshot-diff-report-comparison').innerText();
  if (reportComparisonText.includes(sensitiveFixtureValue)) {
    throw new Error('snapshot diff report comparison exposed a sensitive fixture value');
  }

  const csvDownload = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('snapshot-compare-export-csv').click(),
  ]).then(([downloadResult]) => downloadResult);
  const csvDownloadPath = await csvDownload.path();
  if (!csvDownloadPath || !/^kuviewer-diff-.+-relations-.+\.csv$/.test(csvDownload.suggestedFilename())) {
    throw new Error(`snapshot CSV export filename/path invalid: ${csvDownload.suggestedFilename()}`);
  }
  const snapshotDiffCsv = await readFile(csvDownloadPath, 'utf8');
  if (!snapshotDiffCsv.startsWith('change,clusterId,relation,sourceKind,sourceNamespace,sourceName,')) {
    throw new Error(`snapshot CSV export header invalid: ${snapshotDiffCsv.slice(0, 120)}`);
  }
  if (/labels|annotations|stringData|adminToken|kubeconfig/i.test(snapshotDiffCsv)) {
    throw new Error('snapshot CSV export included a forbidden field');
  }

  await page.getByTestId('snapshot-compare-relation-type-all').click();
  await expect(page.getByTestId('snapshot-compare-relation-type-filter')).toContainText('전체');

  await page.getByTestId('snapshot-compare-scope-clusters').click();
  await expect(page.getByTestId('snapshot-compare-cluster-row').first()).toBeVisible({ timeout: 10_000 });
  const clusterCsvDownload = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('snapshot-compare-export-csv').click(),
  ]).then(([downloadResult]) => downloadResult);
  const clusterCsvPath = await clusterCsvDownload.path();
  if (!clusterCsvPath) {
    throw new Error('snapshot cluster CSV export path was not available');
  }
  const clusterCsv = await readFile(clusterCsvPath, 'utf8');
  if (!clusterCsv.includes("'=visual upload")) {
    throw new Error('snapshot cluster CSV did not neutralize a formula-leading cluster name');
  }

  await page.getByTestId('snapshot-compare-scope-relations').click();
  await assertNoHorizontalOverflow(page, 'snapshot comparison');
  await page.getByTestId('snapshot-compare-panel').evaluate((panel) => {
    const top = panel.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - 150));
  });
  await page.waitForTimeout(100);
  const screenshotStyle = await page.addStyleTag({
    content: 'html body .ku-app-shell, html body .ku-app-shell * { -webkit-backdrop-filter: none; backdrop-filter: none; }',
  });
  await page.screenshot({ animations: 'disabled', path: path.join(outputDir, `${viewportName}-snapshot-compare.png`) });
  await page.getByTestId('snapshot-compare-relation-table').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({
    animations: 'disabled',
    path: path.join(outputDir, `${viewportName}-snapshot-relations.png`),
  });
  await screenshotStyle.evaluate((element) => element.remove());

  await selectVisualMode(page, initialMode);
  await page.getByLabel('주요 보기').getByRole('button', { name: '토폴로지', exact: true }).click();
  await expect(page.getByRole('heading', { name: '토폴로지 맵' })).toBeVisible({ timeout: 10_000 });
}

function assertSafeSnapshotDiffPayload(payload, selectedRelationTypes) {
  if (payload.schemaVersion !== 1 || payload.kind !== 'kuviewer.snapshotDiff') {
    throw new Error(`snapshot JSON export schema invalid: ${JSON.stringify(payload).slice(0, 240)}`);
  }
  if (payload.filters?.scope !== 'relations' || payload.filters?.changeType !== 'all') {
    throw new Error(`snapshot JSON export filters invalid: ${JSON.stringify(payload.filters)}`);
  }
  if ('query' in (payload.filters || {})) {
    throw new Error('snapshot JSON export persisted the UI search query');
  }
  const exportedRelationTypes = [...(payload.filters?.relationTypes || [])].sort();
  if (exportedRelationTypes.join(',') !== [...selectedRelationTypes].sort().join(',')) {
    throw new Error(`snapshot JSON export relation filters invalid: ${exportedRelationTypes.join(',')}`);
  }
  if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.counts?.exported !== payload.items.length) {
    throw new Error('snapshot JSON export item count invalid');
  }
  if (payload.items.some((item) => !selectedRelationTypes.includes(item.relation))) {
    throw new Error('snapshot JSON export included a relation outside the selected types');
  }
  const forbiddenKeys = new Set(['labels', 'annotations', 'summary', 'data', 'stringData', 'token', 'adminToken', 'kubeconfig']);
  const visit = (value) => {
    if (!value || typeof value !== 'object') {
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) {
        throw new Error(`snapshot JSON export included forbidden key: ${key}`);
      }
      visit(child);
    }
  };
  visit(payload);
}

async function selectVisualMode(page, mode) {
  if (mode === 'upload') {
    await page.getByTestId('source-mode-upload').click();
    await page.getByTestId('upload-cluster-name').fill('=visual upload');
    await page.getByTestId('upload-cluster-id').fill('visual-upload');
    await page.setInputFiles('[data-testid="upload-files"]', uploadManifestPath);
    if (!(await page.getByTestId('upload-warning-panel').isVisible().catch(() => false))) {
      await page.getByTestId('upload-warning-toggle').click();
    }
    await expect(page.getByTestId('upload-warning-panel')).toContainText('지원하지 않는 kind', { timeout: 10_000 });
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
  const mobileMap = page.getByTestId('mobile-topology-map');
  if (await mobileMap.isVisible().catch(() => false)) {
    await mobileMap.scrollIntoViewIfNeeded();
    await expect(page.locator('.ku-react-flow')).toHaveCount(0);
    await page.locator('[data-testid^="mobile-topology-edge-"]').first().waitFor({ state: 'attached', timeout: 10_000 });
    const beforeTransform = await page.getByTestId('mobile-topology-viewport').getAttribute('transform');
    await page.getByTestId('mobile-zoom-in').click();
    const zoomedTransform = await page.getByTestId('mobile-topology-viewport').getAttribute('transform');
    if (beforeTransform === zoomedTransform) {
      throw new Error(`mobile zoom-in did not change transform for ${viewportName}`);
    }
    await page.getByTestId('mobile-zoom-fit').click();
    await page.getByTestId('mobile-zoom-reset').click();
    const firstNode = page.locator('[data-testid^="mobile-topology-node-"]').first();
    await firstNode.waitFor({ state: 'visible', timeout: 10_000 });
    await firstNode.click();
    await expect(page.getByTestId('mobile-topology-list')).toContainText(/edges|엣지/, { timeout: 10_000 });
    return;
  }

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

async function verifyResourceExplorer(page, viewportName) {
  await page.getByRole('button', { name: /리소스 탐색/ }).click();
  await expect(page.getByRole('heading', { name: '리소스 탐색' })).toBeVisible({ timeout: 10_000 });
  await verifyResourceListSorting(page);
  await verifyResourceListColumns(page);
  await verifyResourceActiveFilterChips(page);
  await verifyResourceBulkActions(page);
  await verifyResourceKeyboardMultiSelect(page);
  await verifyResourceViewRename(page);
  await verifyResourceViewFolderPolish(page);
  await verifyResourceViewSearch(page);
  await verifyResourceViewReorder(page);
  await verifyResourceViewImportExportPolish(page);
  await verifyResourceViewBulkManagement(page);
  await verifyResourceViewConflictImport(page);
  await verifyResourceViewTeamSyncPolish(page, viewportName);
  await selectVisualMode(page, visualMode);
  await page.getByRole('button', { name: /리소스 탐색/ }).click();
  await expect(page.getByRole('heading', { name: 'Metadata' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Status' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Safe Preview' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'YAML Preview' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Relations' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Logs' })).toBeVisible({ timeout: 10_000 });
  await verifyResourceDetailSectionControls(page);
  await verifyResourceSafePreviewSearch(page);
  await expect(page.getByText('표시할 이벤트가 없습니다')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Secret value 숨김/)).toBeVisible({ timeout: 10_000 });
}

async function verifyResourceSafePreviewSearch(page) {
  const firstSafeRow = page.getByTestId('resource-key-value-row-safe').first();
  await expect(firstSafeRow).toBeVisible({ timeout: 10_000 });
  const firstSafeKey = await firstSafeRow.locator('span').first().getAttribute('title');
  const query = (firstSafeKey || '').trim().slice(0, 6);
  if (!query) {
    throw new Error('safe preview search fixture has no key text');
  }

  await page.getByTestId('safe-preview-search-input').fill(query);
  await expect(page.getByTestId('safe-preview-search-count')).toContainText(/matches/, { timeout: 10_000 });
  await expect(page.locator('[data-testid="active-key-value-search-match"]').first()).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('safe-preview-search-next').click();
  await expect(page.getByTestId('safe-preview-search-status')).toContainText(/검색 결과/, { timeout: 10_000 });
  await page.getByTestId('safe-preview-search-prev').click();
  await expect(page.getByTestId('safe-preview-search-status')).toContainText(/검색 결과/, { timeout: 10_000 });

  await page.getByTestId('safe-preview-search-input').fill('zz-no-safe-preview-match');
  await expect(page.getByTestId('resource-key-value-empty-safe')).toContainText('일치하는 Safe Preview 항목 없음', { timeout: 10_000 });
  await page.getByTestId('safe-preview-search-clear').click();
  await expect(page.getByTestId('safe-preview-search-count')).toContainText(/items/, { timeout: 10_000 });
  await expect(page.getByTestId('resource-key-value-row-safe').first()).toBeVisible({ timeout: 10_000 });
}

async function verifyResourceDetailSectionControls(page) {
  await expect(page.getByTestId('resource-detail-kind-chip')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-name-chip')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-cluster-chip')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-active-section')).toContainText('현재 Metadata', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-open-section-count')).toContainText('열린 섹션 5 / 9', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-keyboard-hint')).toContainText('J/K 이동', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-navigator')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-navigator-count')).toContainText('5 open', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-nav-item-metadata')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('resource-detail-section-nav-state-yaml')).toContainText('closed', { timeout: 10_000 });
  const statusNavigatorSummary = await page.getByTestId('resource-detail-section-nav-summary-status').textContent({ timeout: 10_000 });
  if (!statusNavigatorSummary?.trim()) {
    throw new Error('resource detail navigator status summary must be visible');
  }
  await expect(page.getByTestId('resource-detail-section-body-metadata')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-body-events')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-body-yaml')).toHaveCount(0);

  await page.getByTestId('resource-detail-section-nav-item-yaml').click();
  await expect(page.getByTestId('resource-detail-active-section')).toContainText('현재 YAML Preview', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-nav-item-yaml')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('resource-detail-section-nav-state-yaml')).toContainText('open', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-body-yaml')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('resource-detail-section-nav-item-metadata').click();
  await expect(page.getByTestId('resource-detail-active-section')).toContainText('현재 Metadata', { timeout: 10_000 });

  await page.getByTestId('resource-detail-collapse-all').click();
  await expect(page.getByTestId('resource-detail-open-section-count')).toContainText('열린 섹션 0 / 9', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-collapse-all')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('resource-detail-section-navigator-count')).toContainText('0 open', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-body-metadata')).toHaveCount(0);
  await expect(page.getByTestId('resource-detail-section-body-events')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Metadata' })).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('resource-detail-expand-all').click();
  await expect(page.getByTestId('resource-detail-open-section-count')).toContainText('열린 섹션 9 / 9', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-expand-all')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('resource-detail-section-navigator-count')).toContainText('9 open', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-body-yaml')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-body-labels')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-body-logs')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('resource-detail-reset-sections').click();
  await expect(page.getByTestId('resource-detail-open-section-count')).toContainText('열린 섹션 5 / 9', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-reset-sections')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('resource-detail-section-navigator-count')).toContainText('5 open', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-body-metadata')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-body-events')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-body-yaml')).toHaveCount(0);
  await expect(page.getByTestId('resource-detail-section-body-labels')).toHaveCount(0);
  await expect(page.getByTestId('resource-detail-section-body-annotations')).toHaveCount(0);
  await expect(page.getByTestId('resource-detail-section-body-logs')).toHaveCount(0);

  await page.getByTestId('resource-detail-panel').focus();
  await page.keyboard.press('j');
  await expect(page.getByTestId('resource-detail-active-section')).toContainText('현재 Status', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-nav-item-status')).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('k');
  await expect(page.getByTestId('resource-detail-active-section')).toContainText('현재 Metadata', { timeout: 10_000 });
  await page.keyboard.press('3');
  await expect(page.getByTestId('resource-detail-active-section')).toContainText('현재 Safe Preview', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-body-safe')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('9');
  await expect(page.getByTestId('resource-detail-active-section')).toContainText('현재 Logs', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-body-logs')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('o');
  await expect(page.getByTestId('resource-detail-section-nav-state-logs')).toContainText('closed', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-body-logs')).toHaveCount(0);
  await page.keyboard.press('o');
  await expect(page.getByTestId('resource-detail-section-nav-state-logs')).toContainText('open', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-body-logs')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('c');
  await expect(page.getByTestId('resource-detail-open-section-count')).toContainText('열린 섹션 0 / 9', { timeout: 10_000 });
  await page.keyboard.press('e');
  await expect(page.getByTestId('resource-detail-open-section-count')).toContainText('열린 섹션 9 / 9', { timeout: 10_000 });
  await page.keyboard.press('r');
  await expect(page.getByTestId('resource-detail-open-section-count')).toContainText('열린 섹션 5 / 9', { timeout: 10_000 });
  await page.keyboard.press('3');
  await expect(page.getByTestId('resource-detail-active-section')).toContainText('현재 Safe Preview', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-safe')).toBeFocused({ timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-section-nav-item-safe')).toHaveAttribute('aria-current', 'true');
  const safePreviewSearchInput = page.getByTestId('safe-preview-search-input');
  await safePreviewSearchInput.focus();
  await expect(safePreviewSearchInput).toBeFocused({ timeout: 10_000 });
  await page.keyboard.press('j');
  await page.keyboard.press('o');
  await page.keyboard.press('e');
  await page.keyboard.press('c');
  await page.keyboard.press('r');
  await page.keyboard.press('1');
  await expect(page.getByTestId('resource-detail-active-section')).toContainText('현재 Safe Preview', { timeout: 10_000 });
  await expect(safePreviewSearchInput).toHaveValue('joecr1');
  await page.getByTestId('safe-preview-search-clear').click();
  await expect(page.getByTestId('resource-key-value-row-safe').first()).toBeVisible({ timeout: 10_000 });

  await verifyResourceDetailEmptyFilterRecovery(page);
}

async function verifyResourceDetailEmptyFilterRecovery(page) {
  await page.getByTestId('resource-view-query').fill('zz-resource-detail-keyboard-empty');
  await expect(page.getByTestId('resource-result-count')).toContainText(/결과 0 \/ 전체 \d+/, { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-panel')).toHaveCount(0);
  await expect(page.getByText('필터와 일치하는 리소스가 없습니다.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('선택된 리소스가 없습니다.')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('resource-active-filter-clear-all').click();
  await expect(page.getByTestId('resource-view-query')).toHaveValue('');
  await expect(page.getByTestId('resource-result-count')).toContainText(/결과 [1-9]\d* \/ 전체 \d+/, { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-panel')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-active-section')).toContainText('현재 Metadata', { timeout: 10_000 });
  await expect(page.getByTestId('resource-detail-open-section-count')).toContainText('열린 섹션 5 / 9', { timeout: 10_000 });
  await assertNoHorizontalOverflow(page, 'resource detail keyboard empty filter recovery');
}

async function verifyResourceViewConflictImport(page) {
  await page.getByTestId('resource-view-name-input').fill('Visual Conflict');
  await page.getByTestId('resource-view-group-input').fill('General');
  await page.getByTestId('resource-view-save').click();
  await page.setInputFiles('[data-testid="resource-view-import-input"]', conflictPresetPath);
  await expect(page.getByTestId('resource-view-conflict-panel')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-view-conflict-panel')).toContainText('충돌 1개');
  await page.getByTestId('resource-view-conflict-apply-incoming').click();
  await expect(page.getByTestId('resource-view-conflict-panel')).toHaveCount(0);
  await expect(page.getByTestId('resource-view-message')).toContainText('충돌 1개', { timeout: 10_000 });
  await expect(page.getByTestId(`resource-view-group-${savedViewDomId('Imported')}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`resource-view-preset-row-${savedViewDomId('Visual Conflict')}`)).toContainText('Imported', { timeout: 10_000 });
}

async function verifyResourceViewTeamSyncPolish(page, viewportName) {
  let savedTeamPayload = null;
  let delayNextResourcePage = true;
  let resolveDelayedResourcePage;
  const delayedResourcePageSettled = new Promise((resolve) => {
    resolveDelayedResourcePage = resolve;
  });
  await page.route('**/api/status', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'api',
        source: 'visual-smoke',
        readOnly: true,
        secrets: 'hidden',
        static: true,
        serverTime: new Date().toISOString(),
      }),
    });
  });
  await page.route('**/api/capabilities', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(getTeamSyncCapabilities()) });
  });
  await page.route('**/api/topology', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(getTeamSyncSnapshot()) });
  });
  await page.route(/\/api\/resources(?:\?.*)?$/, async (route) => {
    const searchParams = new URL(route.request().url()).searchParams;
    const cursor = searchParams.get('cursor') || '';
    const query = searchParams.get('query') || '';
    if (cursor && delayNextResourcePage) {
      delayNextResourcePage = false;
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(getTeamSyncResources(cursor, query)) }).catch(() => {});
      resolveDelayedResourcePage();
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(getTeamSyncResources(cursor, query)) });
  });
  await page.route('**/api/resources/**/events', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [], warning: '' }) });
  });
  await page.route('**/api/resource-views', async (route) => {
    if (route.request().method() === 'PUT') {
      savedTeamPayload = JSON.parse(route.request().postData() || '{"items":[]}');
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          items: savedTeamPayload.items || [],
          metadata: {
            version: 1700000400000,
            updatedAt: 1700000400000,
            count: (savedTeamPayload.items || []).length,
            storage: 'memory',
          },
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            name: 'Visual Team Incoming',
            group: 'Team QA',
            query: 'team-api',
            cluster: 'visual-live',
            namespace: 'default',
            kind: 'Pod',
            status: 'healthy',
            order: 1,
            updatedAt: 1700000200000,
          },
        ],
        metadata: {
          version: 1700000300000,
          updatedAt: 1700000300000,
          count: 1,
          storage: 'file',
        },
      }),
    });
  });

  const liveModeButton = page.getByTestId('source-mode-live');
  if ((await liveModeButton.getAttribute('aria-pressed')) === 'true') {
    await page.getByTestId('source-mode-upload').click();
    await expect(page.getByTestId('source-mode-upload')).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
  }
  await liveModeButton.click();
  await expect(liveModeButton).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
  const unlockButton = page.getByTestId('unlock-live');
  if (await unlockButton.isVisible().catch(() => false)) {
    await page.getByTestId('live-token-input').fill(adminToken);
    await unlockButton.click();
  }
  await expect(page.getByText('실시간 연결됨')).toBeVisible({ timeout: 10_000 });
  await page.getByLabel('주요 보기').getByRole('button', { name: '토폴로지', exact: true }).click();
  await expect(page.getByTestId('connector-capability-matrix')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('connector-capability-refresh').click();
  await expect(page.getByTestId('connector-capability-summary')).toContainText('읽기 1 · 인증/권한 1 · 미설치 1 · 확인 실패 0 · 보호 1');
  await expect(page.getByTestId('connector-capability-required-warning')).toContainText('필수 Core 권한 1개');
  await page.getByTestId('connector-capability-details').locator('summary').click();
  await expect(page.getByTestId('connector-capability-core-pods')).toContainText('RBAC 거부');
  await expect(page.getByTestId('connector-capability-gateway-gateways')).toContainText('미설치');
  await expect(page.getByTestId('connector-capability-policy-secret-values')).toContainText('값 숨김');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({
    animations: 'disabled',
    path: path.join(outputDir, `${viewportName}-connector-capabilities.png`),
    fullPage: true,
  });
  await page.getByRole('button', { name: /리소스 탐색/ }).click();
  await expect(page.getByTestId('resource-view-team-load')).toBeEnabled({ timeout: 10_000 });
  await expect(page.getByTestId('resource-list-load-more')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-result-count')).toContainText('표시 1 / 일치 2 · 전체 2');
  await page.getByTestId('resource-list-load-more').click();
  await page.getByTestId('resource-view-query').fill('team-api');
  await expect(page.getByTestId('resource-result-count')).toContainText('표시 1 / 일치 1 · 전체 2', { timeout: 10_000 });
  await delayedResourcePageSettled;
  await expect(page.getByTestId('resource-result-count')).toContainText('표시 1 / 일치 1 · 전체 2');
  await page.getByTestId('resource-view-query').fill('');
  await expect(page.getByTestId('resource-result-count')).toContainText('표시 1 / 일치 2 · 전체 2', { timeout: 10_000 });
  await expect(page.getByTestId('resource-list-load-more')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('resource-list-load-more').click();
  await expect(page.getByTestId('resource-list-load-more')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('resource-result-count')).toContainText('표시 2 / 일치 2 · 전체 2');
  await page.screenshot({
    animations: 'disabled',
    path: path.join(outputDir, `${viewportName}-resource-pagination.png`),
    fullPage: false,
  });

  await page.getByTestId('resource-view-team-load').click();
  await expect(page.getByTestId('resource-view-team-compare-preview')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-view-team-compare-action')).toContainText('Team load preview');
  await expect(page.getByTestId('resource-view-team-compare-team')).toContainText('Team 1');
  await expect(page.getByTestId('resource-view-team-compare-new')).toContainText('신규 1');
  await expect(page.getByTestId('resource-view-team-compare-folders')).toContainText('Team QA');
  await expect(page.getByTestId('resource-view-team-compare-snapshot')).toContainText('Snapshot v1700000300000');
  await expect(page.getByTestId('resource-view-team-compare-snapshot')).toContainText('1 views');
  await expect(page.getByTestId('resource-view-team-compare-snapshot')).toContainText('file');
  await expect(page.getByTestId(`resource-view-preset-row-${savedViewDomId('Visual Team Incoming')}`)).toHaveCount(0);
  await page.getByTestId('resource-view-team-compare-apply').click();
  await expect(page.getByTestId('resource-view-team-sync-summary')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-view-team-sync-action')).toContainText('Team load');
  await expect(page.getByTestId('resource-view-team-sync-count')).toContainText('1 views');
  await expect(page.getByTestId('resource-view-team-sync-new')).toContainText('신규 1');
  await expect(page.getByTestId('resource-view-team-sync-folders')).toContainText('Team QA');
  await expect(page.getByTestId('resource-view-team-sync-snapshot')).toContainText('Snapshot v1700000300000');
  await expect(page.getByTestId(`resource-view-preset-row-${savedViewDomId('Visual Team Incoming')}`)).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('resource-view-team-save').click();
  await expect(page.getByTestId('resource-view-team-compare-preview')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-view-team-compare-action')).toContainText('Team save preview');
  await expect(page.getByTestId('resource-view-team-compare-local')).toContainText('Local');
  await expect(page.getByTestId('resource-view-team-compare-team')).toContainText('Team 1');
  await expect(page.getByTestId('resource-view-team-compare-team-only')).toHaveCount(0);
  await expect(page.getByTestId('resource-view-team-compare-snapshot')).toContainText('Snapshot v1700000300000');
  await expect(page.getByTestId('resource-view-message')).toContainText('저장 실행 전 한 번 더', { timeout: 10_000 });
  await expect(page.getByTestId('resource-view-team-save')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('resource-view-team-save')).toContainText('팀 저장 확인');

  await page.getByTestId('resource-view-team-compare-save').click();
  await expect(page.getByTestId('resource-view-team-sync-action')).toContainText('Team save', { timeout: 10_000 });
  await expect(page.getByTestId('resource-view-team-sync-folders')).toContainText('Team QA');
  await expect(page.getByTestId('resource-view-team-sync-snapshot')).toContainText('Snapshot v1700000400000');
  await expect(page.getByTestId('resource-view-team-sync-snapshot')).toContainText('memory');
  if (!savedTeamPayload?.items?.some((preset) => preset.name === 'Visual Team Incoming' && preset.group === 'Team QA')) {
    throw new Error(`team save payload did not include synced view: ${JSON.stringify(savedTeamPayload)}`);
  }
}

async function verifyResourceViewRename(page) {
  const sourceName = 'Visual Rename Source';
  const targetName = 'Visual Rename Target';
  const duplicateName = 'Visual Rename Duplicate';
  const sourceId = savedViewDomId(sourceName);
  const targetId = savedViewDomId(targetName);
  const sourceGroup = 'Workloads';
  const movedGroup = 'Platform';

  await page.getByTestId('resource-view-name-input').fill(sourceName);
  await page.getByTestId('resource-view-group-input').fill(sourceGroup);
  await page.getByTestId('resource-view-save').click();
  await expect(page.getByTestId(`resource-view-group-${savedViewDomId(sourceGroup)}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`resource-view-preset-row-${sourceId}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`resource-view-preset-row-${sourceId}`)).toContainText(sourceGroup, { timeout: 10_000 });

  await page.getByTestId(`resource-view-group-toggle-${savedViewDomId(sourceGroup)}`).click();
  await expect(page.getByTestId(`resource-view-preset-row-${sourceId}`)).toHaveCount(0);
  await page.getByTestId(`resource-view-group-toggle-${savedViewDomId(sourceGroup)}`).click();
  await expect(page.getByTestId(`resource-view-preset-row-${sourceId}`)).toBeVisible({ timeout: 10_000 });

  const storedGroupedViews = await page.evaluate(() => JSON.parse(window.localStorage.getItem('kuviewer_resource_view_presets') || '[]'));
  if (!storedGroupedViews.some((preset) => preset.name === 'Visual Rename Source' && preset.group === 'Workloads')) {
    throw new Error(`saved view group was not stored: ${JSON.stringify(storedGroupedViews)}`);
  }

  await page.getByTestId('resource-view-name-input').fill(duplicateName);
  await page.getByTestId('resource-view-group-input').fill('General');
  await page.getByTestId('resource-view-save').click();
  await expect(page.getByTestId(`resource-view-preset-row-${savedViewDomId(duplicateName)}`)).toBeVisible({ timeout: 10_000 });

  await page.getByTestId(`resource-view-rename-start-${sourceId}`).click();
  await page.getByTestId(`resource-view-rename-input-${sourceId}`).fill(targetName);
  await page.getByTestId(`resource-view-rename-save-${sourceId}`).click();
  await expect(page.getByTestId(`resource-view-preset-row-${targetId}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`resource-view-preset-row-${sourceId}`)).toHaveCount(0);
  await expect(page.getByTestId('resource-view-message')).toContainText(targetName, { timeout: 10_000 });
  await expect(page.getByTestId(`resource-view-preset-row-${targetId}`)).toContainText(sourceGroup, { timeout: 10_000 });

  await page.getByTestId(`resource-view-group-input-${targetId}`).fill(movedGroup);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId(`resource-view-group-${savedViewDomId(movedGroup)}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`resource-view-preset-row-${targetId}`)).toContainText(movedGroup, { timeout: 10_000 });

  await page.getByTestId(`resource-view-preset-row-${targetId}`).getByRole('button', { name: '적용' }).click();
  await expect(page.getByTestId(`resource-view-preset-row-${targetId}`)).toContainText('적용됨', { timeout: 10_000 });

  await page.getByTestId(`resource-view-rename-start-${targetId}`).click();
  await page.getByTestId(`resource-view-rename-input-${targetId}`).fill(duplicateName);
  await page.getByTestId(`resource-view-rename-save-${targetId}`).click();
  await expect(page.getByTestId(`resource-view-rename-error-${targetId}`)).toContainText('이미 같은 이름', { timeout: 10_000 });
  await page.getByTestId(`resource-view-rename-cancel-${targetId}`).click();
}

async function verifyResourceViewFolderPolish(page) {
  const targetId = savedViewDomId('Visual Rename Target');
  const duplicateId = savedViewDomId('Visual Rename Duplicate');
  const platformFolderId = savedViewDomId('Platform');

  await expect(page.getByTestId('resource-view-folder-summary')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-view-folder-summary-count')).toContainText('Folders', { timeout: 10_000 });
  await expect(page.getByTestId(`resource-view-folder-chip-${platformFolderId}`)).toContainText('Platform', { timeout: 10_000 });

  await page.getByTestId(`resource-view-folder-chip-${platformFolderId}`).click();
  await expect(page.getByTestId(`resource-view-preset-row-${targetId}`)).toHaveCount(0);
  await expect(page.getByTestId('resource-view-folder-collapsed-count')).toContainText('접힘 1', { timeout: 10_000 });

  await page.getByTestId('resource-view-folder-expand-all').click();
  await expect(page.getByTestId(`resource-view-preset-row-${targetId}`)).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('resource-view-folder-collapse-all').click();
  await expect(page.getByTestId(`resource-view-preset-row-${targetId}`)).toHaveCount(0);
  await expect(page.getByTestId(`resource-view-preset-row-${duplicateId}`)).toHaveCount(0);

  await page.getByTestId('resource-view-folder-expand-all').click();
  await expect(page.getByTestId(`resource-view-preset-row-${targetId}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`resource-view-preset-row-${duplicateId}`)).toBeVisible({ timeout: 10_000 });
}

async function verifyResourceViewSearch(page) {
  const targetId = savedViewDomId('Visual Rename Target');
  const duplicateId = savedViewDomId('Visual Rename Duplicate');

  await page.getByTestId('resource-view-search').fill('Platform');
  await expect(page.getByTestId('resource-view-search-count')).toContainText('1 /', { timeout: 10_000 });
  await expect(page.getByTestId(`resource-view-group-${savedViewDomId('Platform')}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`resource-view-preset-row-${targetId}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`resource-view-preset-row-${duplicateId}`)).toHaveCount(0);

  await page.getByTestId('resource-view-search').fill('no matching saved view');
  await expect(page.getByTestId('resource-view-search-empty')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('resource-view-search-clear').click();
  await expect(page.getByTestId('resource-view-search-count')).toHaveCount(0);
  await expect(page.getByTestId(`resource-view-preset-row-${duplicateId}`)).toBeVisible({ timeout: 10_000 });
}

async function verifyResourceActiveFilterChips(page) {
  const kindSelect = page.getByTestId('resource-filter-kind');
  const availableKinds = await readKuSelectOptionValues(page, 'resource-filter-kind');
  const targetKind = availableKinds.includes('Pod') ? 'Pod' : availableKinds.find((value) => value && value !== 'all');
  if (!targetKind) {
    throw new Error('resource kind filter had no selectable value');
  }

  await page.getByTestId('resource-view-query').fill('checkout');
  await selectKuOption(page, 'resource-filter-kind', targetKind);
  await expect(page.getByTestId('resource-active-filters')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-active-filter-query')).toContainText('Search: checkout', { timeout: 10_000 });
  await expect(page.getByTestId('resource-active-filter-kind')).toContainText(`Kind: ${targetKind}`, { timeout: 10_000 });
  await expect(page.getByTestId('resource-active-filter-count')).toContainText('필터 2', { timeout: 10_000 });
  await expect(page.getByTestId('resource-result-count')).toContainText('결과', { timeout: 10_000 });

  await page.getByTestId('resource-active-filter-query-clear').click();
  await expect(page.getByTestId('resource-view-query')).toHaveValue('');
  await expect(page.getByTestId('resource-active-filter-query')).toHaveCount(0);
  await expect(page.getByTestId('resource-active-filter-kind')).toContainText(`Kind: ${targetKind}`, { timeout: 10_000 });
  await expect(page.getByTestId('resource-active-filter-count')).toContainText('필터 1', { timeout: 10_000 });

  await page.getByTestId('resource-active-filter-clear-all').click();
  await expect(page.getByTestId('resource-view-query')).toHaveValue('');
  await expect(kindSelect).toHaveAttribute('data-selected-value', 'all');
  await expect(page.getByTestId('resource-active-filter-empty')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-active-filter-clear-all')).toHaveCount(0);
  await expect(page.getByTestId('resource-active-filter-count')).toHaveCount(0);
}

async function verifyResourceViewReorder(page) {
  const targetName = 'Visual Rename Target';
  const peerName = 'Visual Reorder Peer';
  const targetId = savedViewDomId(targetName);
  const peerId = savedViewDomId(peerName);

  await page.getByTestId('resource-view-name-input').fill(peerName);
  await page.getByTestId('resource-view-group-input').fill('Platform');
  await page.getByTestId('resource-view-save').click();
  await expect(page.getByTestId(`resource-view-preset-row-${peerId}`)).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => savedViewOrder(page, 'Platform')).toEqual([peerName, targetName]);

  await page.getByTestId(`resource-view-reorder-down-${peerId}`).click();
  await expect.poll(() => savedViewOrder(page, 'Platform')).toEqual([targetName, peerName]);

  await page.getByTestId('resource-view-search').fill('Platform');
  await expect(page.getByTestId('resource-view-reorder-disabled')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`resource-view-reorder-up-${peerId}`)).toBeDisabled();
  await expect(page.getByTestId(`resource-view-drag-handle-${peerId}`)).toBeDisabled();
  await page.getByTestId('resource-view-search-clear').click();

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('resource-view-export').click(),
  ]).then(([downloadResult]) => downloadResult);
  const exportedPath = await download.path();
  if (!exportedPath) {
    throw new Error('saved view export download path was not available');
  }
  const exportedViews = JSON.parse(await readFile(exportedPath, 'utf8'));
  const exportedTarget = exportedViews.find((preset) => preset.name === targetName);
  const exportedPeer = exportedViews.find((preset) => preset.name === peerName);
  if (!exportedTarget || !exportedPeer || !(exportedTarget.order < exportedPeer.order)) {
    throw new Error(`saved view order was not exported: ${JSON.stringify(exportedViews)}`);
  }

  await page.setInputFiles('[data-testid="resource-view-import-input"]', exportedPath);
  await expect(page.getByTestId('resource-view-message')).toContainText('중복', { timeout: 10_000 });
  await expect.poll(() => savedViewOrder(page, 'Platform')).toEqual([targetName, peerName]);
}

async function verifyResourceViewImportExportPolish(page) {
  const wrappedName = 'Visual Wrapped Import';
  const wrappedId = savedViewDomId(wrappedName);
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('resource-view-export').click(),
  ]).then(([downloadResult]) => downloadResult);
  const fileName = download.suggestedFilename();
  if (!/^kuviewer-resource-views-all-.+\.json$/.test(fileName)) {
    throw new Error(`saved view export filename did not include scope/timestamp: ${fileName}`);
  }
  await expect(page.getByTestId('resource-view-transfer-summary')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-view-transfer-action')).toContainText('All export');
  await expect(page.getByTestId('resource-view-transfer-file')).toContainText(fileName);
  await expect(page.getByTestId('resource-view-transfer-folders')).toContainText('Platform');

  await page.setInputFiles('[data-testid="resource-view-import-input"]', wrappedPresetPath);
  await expect(page.getByTestId('resource-view-transfer-action')).toContainText('Import preview', { timeout: 10_000 });
  await expect(page.getByTestId('resource-view-transfer-file')).toContainText('visual-resource-view-items-wrapper.json');
  await expect(page.getByTestId('resource-view-transfer-folders')).toContainText('format { items }');
  await expect(page.getByTestId(`resource-view-preset-row-${wrappedId}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`resource-view-preset-row-${wrappedId}`)).toContainText('Wrapped', { timeout: 10_000 });
}

async function verifyResourceViewBulkManagement(page) {
  const targetName = 'Visual Rename Target';
  const peerName = 'Visual Reorder Peer';
  const targetId = savedViewDomId(targetName);
  const peerId = savedViewDomId(peerName);

  await page.getByTestId('resource-view-search').fill('Platform');
  await page.getByTestId('resource-view-select-visible').click();
  await expect(page.getByTestId('resource-view-bulk-count')).toContainText('선택 2개', { timeout: 10_000 });
  await page.getByTestId('resource-view-search-clear').click();

  await page.getByTestId(`resource-view-group-select-${savedViewDomId('Platform')}`).click();
  await expect(page.getByTestId('resource-view-bulk-toolbar')).toHaveCount(0);

  await page.getByTestId(`resource-view-select-${targetId}`).check();
  await page.getByTestId(`resource-view-select-${peerId}`).check();
  await expect(page.getByTestId('resource-view-bulk-count')).toContainText('선택 2개', { timeout: 10_000 });

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('resource-view-bulk-export').click(),
  ]).then(([downloadResult]) => downloadResult);
  const exportedPath = await download.path();
  if (!exportedPath) {
    throw new Error('saved view bulk export download path was not available');
  }
  const selectedFileName = download.suggestedFilename();
  if (!/^kuviewer-resource-views-selected-.+\.json$/.test(selectedFileName)) {
    throw new Error(`saved view selected export filename did not include scope/timestamp: ${selectedFileName}`);
  }
  const exportedViews = JSON.parse(await readFile(exportedPath, 'utf8'));
  const exportedNames = exportedViews.map((preset) => preset.name).sort();
  if (exportedViews.length !== 2 || exportedNames.join(',') !== [peerName, targetName].sort().join(',')) {
    throw new Error(`saved view bulk export did not include selected presets only: ${JSON.stringify(exportedViews)}`);
  }
  await expect(page.getByTestId('resource-view-transfer-action')).toContainText('Selected export', { timeout: 10_000 });
  await expect(page.getByTestId('resource-view-transfer-file')).toContainText(selectedFileName);

  await page.getByTestId('resource-view-bulk-group-input').fill('Bulk QA');
  await page.getByTestId('resource-view-bulk-move').click();
  await expect(page.getByTestId(`resource-view-group-${savedViewDomId('Bulk QA')}`)).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => savedViewOrder(page, 'Bulk QA')).toEqual([targetName, peerName]);
  await expect(page.getByTestId('resource-view-bulk-count')).toContainText('선택 2개', { timeout: 10_000 });

  await page.getByTestId('resource-view-bulk-delete').click();
  await expect(page.getByTestId('resource-view-message')).toContainText('한 번 더', { timeout: 10_000 });
  await page.getByTestId('resource-view-bulk-delete').click();
  await expect(page.getByTestId(`resource-view-preset-row-${targetId}`)).toHaveCount(0);
  await expect(page.getByTestId(`resource-view-preset-row-${peerId}`)).toHaveCount(0);
  await expect(page.getByTestId('resource-view-bulk-toolbar')).toHaveCount(0);
}

async function savedViewOrder(page, groupName) {
  return page.evaluate((group) => {
    const views = JSON.parse(window.localStorage.getItem('kuviewer_resource_view_presets') || '[]');
    return views
      .filter((preset) => preset.group === group)
      .sort((left, right) => left.order - right.order)
      .map((preset) => preset.name);
  }, groupName);
}

async function verifyResourceListSorting(page) {
  const rows = page.locator('[data-resource-row="true"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  if ((await rows.count()) < 2) {
    return;
  }

  const sortField = page.getByTestId('resource-list-sort-field');
  await sortField.focus();
  await page.keyboard.press('ArrowDown');
  const sortListbox = page.locator('.ku-select-popover [data-slot="list-box"]');
  await expect(sortListbox).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(sortField).toHaveAttribute('data-selected-value', 'name');
  await page.getByTestId('resource-list-sort-desc').click();
  await expect(page.getByTestId('resource-list-sort-desc')).toHaveAttribute('aria-pressed', 'true');
  const descendingNames = await visibleResourceNames(page);
  assertSorted(descendingNames, 'desc');

  await page.getByTestId('resource-list-sort-asc').click();
  await expect(page.getByTestId('resource-list-sort-asc')).toHaveAttribute('aria-pressed', 'true');
  const ascendingNames = await visibleResourceNames(page);
  assertSorted(ascendingNames, 'asc');
}

async function readKuSelectOptionValues(page, testId) {
  return (await readKuSelectOptions(page, testId)).map((option) => option.value);
}

async function readKuSelectOptions(page, testId) {
  const trigger = page.getByTestId(testId);
  await trigger.click();
  const listbox = page.locator('.ku-select-popover [data-slot="list-box"]');
  await expect(listbox).toBeVisible({ timeout: 10_000 });
  const options = await listbox.locator('[data-ku-select-value]').evaluateAll((elements) =>
    elements.map((element) => ({
      disabled: element.matches(':disabled'),
      label: element.textContent?.trim() || '',
      value: element.getAttribute('data-ku-select-value') || '',
    })).filter((option) => option.value),
  );
  await listbox.press('Escape');
  await expect(listbox).toBeHidden({ timeout: 10_000 });
  return options;
}

async function selectKuOption(page, testId, value) {
  const trigger = page.getByTestId(testId);
  await trigger.click();
  const listbox = page.locator('.ku-select-popover [data-slot="list-box"]');
  await expect(listbox).toBeVisible({ timeout: 10_000 });
  await listbox.locator(`[data-ku-select-value="${value}"]`).click();
  await expect(trigger).toHaveAttribute('data-selected-value', value);
}

async function verifyResourceListColumns(page) {
  const summaryToggle = page.getByTestId('resource-list-column-summary');
  await expect(summaryToggle).toBeVisible({ timeout: 10_000 });
  await expect(summaryToggle).toHaveAttribute('aria-pressed', 'true');
  if ((await page.locator('[data-resource-column="summary"]').count()) === 0) {
    throw new Error('summary column is missing by default');
  }

  await summaryToggle.click();
  await expect(summaryToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-resource-column="summary"]')).toHaveCount(0);
  const storedColumns = await page.evaluate(() => JSON.parse(window.localStorage.getItem('kuviewer_resource_list_columns') || '{}'));
  if (storedColumns.summary !== false) {
    throw new Error(`summary column preference did not persist: ${JSON.stringify(storedColumns)}`);
  }

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Kuviewer' })).toBeVisible({ timeout: 10_000 });
  await selectVisualMode(page, visualMode);
  await page.getByRole('button', { name: /리소스 탐색/ }).click();
  await expect(page.getByRole('heading', { name: '리소스 탐색' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('resource-list-column-summary')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-resource-column="summary"]')).toHaveCount(0);

  await page.getByTestId('resource-list-column-summary').click();
  await expect(page.getByTestId('resource-list-column-summary')).toHaveAttribute('aria-pressed', 'true');
  if ((await page.locator('[data-resource-column="summary"]').count()) === 0) {
    throw new Error('summary column did not return after re-enable');
  }
}

async function verifyResourceBulkActions(page) {
  const checkboxes = page.locator('[data-testid^="resource-bulk-checkbox-"]');
  await expect(checkboxes.first()).toBeVisible({ timeout: 10_000 });
  if ((await checkboxes.count()) < 2) {
    return;
  }

  await expect(page.getByTestId('resource-bulk-count')).toContainText('선택 0개');
  await expect(page.getByTestId('resource-bulk-copy-names')).toBeDisabled();
  await expect(page.getByTestId('resource-bulk-export-json')).toBeDisabled();
  await expect(page.getByTestId('resource-bulk-export-csv')).toBeDisabled();

  await checkboxes.nth(0).click();
  await checkboxes.nth(1).click();
  await expect(page.getByTestId('resource-bulk-count')).toContainText('선택 2개', { timeout: 10_000 });
  await expect(page.getByTestId('resource-bulk-copy-names')).toBeEnabled();
  await expect(page.getByTestId('resource-bulk-export-json')).toBeEnabled();
  await expect(page.getByTestId('resource-bulk-export-csv')).toBeEnabled();
  if ((await page.locator('[data-resource-bulk-selected="true"]').count()) < 2) {
    throw new Error('selected resource rows were not marked');
  }

  await page.getByTestId('resource-bulk-clear').click();
  await expect(page.getByTestId('resource-bulk-count')).toContainText('선택 0개', { timeout: 10_000 });
  await expect(page.locator('[data-resource-bulk-selected="true"]')).toHaveCount(0);

  await page.getByTestId('resource-bulk-select-all').click();
  const selectedAfterAll = await page.locator('[data-resource-bulk-selected="true"]').count();
  if (selectedAfterAll < 1) {
    throw new Error('select all did not select resources');
  }
  await page.getByTestId('resource-bulk-clear').click();
}

async function verifyResourceKeyboardMultiSelect(page) {
  const rows = page.locator('[data-resource-row="true"]');
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  const rowCount = await rows.count();
  if (rowCount < 3) {
    return;
  }

  await rows.nth(0).focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('resource-bulk-count')).toContainText('선택 1개', { timeout: 10_000 });

  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('resource-bulk-count')).toContainText('선택 2개', { timeout: 10_000 });

  await page.keyboard.down('Shift');
  await page.keyboard.press('End');
  await page.keyboard.up('Shift');
  const selectedAfterRange = await page.locator('[data-resource-bulk-selected="true"]').count();
  if (selectedAfterRange < 3) {
    throw new Error(`keyboard range selection selected too few rows: ${selectedAfterRange}`);
  }

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('resource-bulk-count')).toContainText('선택 0개', { timeout: 10_000 });
  await expect(page.locator('[data-resource-bulk-selected="true"]')).toHaveCount(0);

  await rows.nth(0).focus();
  await page.keyboard.press('Control+A');
  const selectedAfterShortcut = await page.locator('[data-resource-bulk-selected="true"]').count();
  if (selectedAfterShortcut !== rowCount) {
    throw new Error(`keyboard select all selected ${selectedAfterShortcut} of ${rowCount} rows`);
  }

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('resource-bulk-count')).toContainText('선택 0개', { timeout: 10_000 });
}

async function visibleResourceNames(page) {
  return page.locator('[data-resource-row="true"]').evaluateAll((elements) =>
    elements.map((element) => element.querySelector('p')?.textContent?.trim() || '').filter(Boolean),
  );
}

function savedViewDomId(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'view';
}

function assertNoBrowserIssues(browserIssues, failedResponses, viewportName) {
  const issues = [...browserIssues, ...failedResponses];
  if (issues.length > 0) {
    throw new Error(`unexpected browser warning/error in ${viewportName}: ${issues.slice(0, 5).join(' | ')}`);
  }
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  if (overflow.documentWidth > overflow.viewportWidth + 4) {
    throw new Error(`${label} overflows horizontally: ${overflow.documentWidth} > ${overflow.viewportWidth}`);
  }
}

function getTeamSyncSnapshot() {
  return {
    clusters: [
      {
        id: 'visual-live',
        name: 'Visual Live',
        provider: 'Kubernetes',
        version: 'v1.30',
        nodeReady: 1,
        nodeTotal: 1,
        podRunning: 1,
        podWarning: 0,
        namespaces: 1,
      },
    ],
    nodes: [
      {
        id: 'visual-live:Namespace::default',
        clusterId: 'visual-live',
        kind: 'Namespace',
        namespace: '',
        name: 'default',
        status: 'healthy',
        labels: { team: 'visual' },
        summary: { workloads: 1 },
        x: 260,
        y: 160,
      },
      {
        id: 'visual-live:Pod:default:team-api',
        clusterId: 'visual-live',
        kind: 'Pod',
        namespace: 'default',
        name: 'team-api',
        status: 'healthy',
        labels: { app: 'team-api' },
        summary: { phase: 'Running', ready: '1/1' },
        x: 560,
        y: 160,
      },
    ],
    edges: [
      {
        id: 'visual-live:Namespace::default->visual-live:Pod:default:team-api',
        source: 'visual-live:Namespace::default',
        target: 'visual-live:Pod:default:team-api',
        type: 'contains',
      },
    ],
  };
}

function getTeamSyncCapabilities() {
  return {
    source: 'kubernetes',
    checkedAt: new Date().toISOString(),
    items: [
      { id: 'core/namespaces', group: 'Core', resource: 'Namespaces', required: true, status: 'available', reason: 'read_allowed' },
      { id: 'core/pods', group: 'Core', resource: 'Pods', required: true, status: 'forbidden', reason: 'rbac_denied' },
      { id: 'gateway/gateways', group: 'Gateway API', resource: 'Gateways', required: false, status: 'missing', reason: 'api_not_installed' },
      { id: 'policy/secret-values', group: 'Security', resource: 'Secret values', required: false, status: 'protected', reason: 'secret_values_hidden' },
    ],
  };
}

function getTeamSyncResources(cursor = '', query = '') {
  const items = [
      {
        id: 'visual-live:Namespace::default',
        clusterId: 'visual-live',
        kind: 'Namespace',
        namespace: '',
        name: 'default',
        status: 'healthy',
        labels: { team: 'visual' },
        annotations: {},
        summary: { workloads: 1 },
        preview: { metadata: { kind: 'Namespace', name: 'default', namespace: '', cluster: 'visual-live' }, status: { status: 'healthy' } },
        related: [
          {
            nodeId: 'visual-live:Pod:default:team-api',
            kind: 'Pod',
            namespace: 'default',
            name: 'team-api',
            edgeType: 'contains',
            direction: 'outgoing',
            sourceField: '',
          },
        ],
      },
      {
        id: 'visual-live:Pod:default:team-api',
        clusterId: 'visual-live',
        kind: 'Pod',
        namespace: 'default',
        name: 'team-api',
        status: 'healthy',
        labels: { app: 'team-api' },
        annotations: {},
        summary: { phase: 'Running', ready: '1/1' },
        preview: { metadata: { kind: 'Pod', name: 'team-api', namespace: 'default', cluster: 'visual-live' }, status: { status: 'healthy', phase: 'Running' } },
        related: [
          {
            nodeId: 'visual-live:Namespace::default',
            kind: 'Namespace',
            namespace: '',
            name: 'default',
            edgeType: 'contains',
            direction: 'incoming',
            sourceField: '',
          },
        ],
      },
    ];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = normalizedQuery
    ? items.filter((item) => item.name.toLowerCase().includes(normalizedQuery) || item.kind.toLowerCase().includes(normalizedQuery))
    : items;
  const offset = cursor === 'MQ' ? 1 : 0;
  return {
    items: filteredItems.slice(offset, offset + 1),
    metadata: {
      total: 2,
      filtered: filteredItems.length,
      returned: Math.min(1, Math.max(0, filteredItems.length - offset)),
      limit: 1,
      nextCursor: offset === 0 && filteredItems.length > 1 ? 'MQ' : '',
      facets: {
        clusters: ['visual-live'],
        namespaces: ['default'],
        kinds: ['Namespace', 'Pod'],
        statuses: ['healthy'],
      },
    },
  };
}

function assertSorted(values, direction) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const sorted = [...values].sort((left, right) => collator.compare(left, right));
  if (direction === 'desc') {
    sorted.reverse();
  }
  if (values.join('\u001f') !== sorted.join('\u001f')) {
    throw new Error(`resource list ${direction} sort failed: ${values.join(', ')}`);
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
  labels:
    team: commerce
---
apiVersion: v1
kind: Namespace
metadata:
  name: observability
  labels:
    team: platform
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
  capacity:
    cpu: 8
    memory: 32Gi
    pods: 110
    ephemeral-storage: 100Gi
  allocatable:
    cpu: 7800m
    memory: 30Gi
    pods: 100
    ephemeral-storage: 90Gi
  nodeInfo:
    kubeletVersion: v1.30.4
    containerRuntimeVersion: containerd://1.7.27
    operatingSystem: linux
    architecture: amd64
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
  capacity:
    cpu: 8
    memory: 32Gi
    pods: 110
    ephemeral-storage: 100Gi
  allocatable:
    cpu: 7600m
    memory: 29Gi
    pods: 100
    ephemeral-storage: 88Gi
  nodeInfo:
    kubeletVersion: v1.30.4
    containerRuntimeVersion: containerd://1.7.27
    operatingSystem: linux
    architecture: amd64
---
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-fast
provisioner: kubernetes.io/no-provisioner
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: false
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: orders-pv
spec:
  storageClassName: local-fast
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  volumeMode: Filesystem
  capacity:
    storage: 10Gi
status:
  phase: Bound
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: checkout-config
  namespace: checkout
immutable: true
data:
  PAYMENT_URL: http://payments.checkout.svc.cluster.local
binaryData:
  logo.bin: a3V2aWV3ZXI=
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
  accessModes: [ReadWriteOnce]
  volumeMode: Filesystem
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
  template:
    metadata:
      labels:
        app: checkout-api
    spec:
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
  replicas: 2
  readyReplicas: 2
  availableReplicas: 2
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
  template:
    metadata:
      labels:
        app: checkout-api
    spec:
      containers:
        - name: app
          image: checkout:1.0.0
status:
  replicas: 2
  readyReplicas: 2
  availableReplicas: 2
---
apiVersion: v1
kind: Pod
metadata:
  name: checkout-api-76d9c-a
  namespace: checkout
  labels:
    app: checkout-api
    tier: backend
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
  containerStatuses:
    - name: app
      ready: true
      restartCount: 0
      image: checkout:1.0.0
      state:
        running: {}
---
apiVersion: v1
kind: Pod
metadata:
  name: checkout-api-76d9c-b
  namespace: checkout
  labels:
    app: checkout-api
    tier: backend
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
  containerStatuses:
    - name: app
      ready: true
      restartCount: 1
      image: checkout:1.0.0
      state:
        running: {}
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
    matchExpressions:
      - key: tier
        operator: In
        values:
          - backend
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: checkout-api
            matchExpressions:
              - key: legacy
                operator: DoesNotExist
      ports:
        - protocol: TCP
          port: 80
  egress:
    - to:
        - namespaceSelector:
            matchExpressions:
              - key: team
                operator: In
                values:
                  - platform
          podSelector:
            matchExpressions:
              - key: app
                operator: In
                values:
                  - node-agent
              - key: tier
                operator: Exists
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
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: reconcile
              image: checkout/reconcile:1.0.0
status:
  active: []
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
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: reconcile
          image: checkout/reconcile:1.0.0
status:
  succeeded: 1
---
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: widgets.platform.example.com
spec:
  group: platform.example.com
  scope: Namespaced
  names:
    plural: widgets
    singular: widget
    kind: Widget
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          x-kubernetes-preserve-unknown-fields: true
status:
  conditions:
    - type: Established
      status: "True"
---
apiVersion: platform.example.com/v1
kind: Widget
metadata:
  name: checkout-dashboard
  namespace: checkout
  labels:
    app: checkout-api
spec:
  owner: checkout
  replicas: 2
  secretRef:
    name: checkout-secret
  configMapRefs:
    - name: checkout-config
  backendRef:
    apiVersion: v1
    kind: Service
    name: checkout-api
status:
  conditions:
    - type: Ready
      status: "True"
---
apiVersion: example.com/v1
kind: UnsupportedWidget
metadata:
  name: upload-warning-demo
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
apiVersion: gateway.networking.k8s.io/v1
kind: GRPCRoute
metadata:
  name: checkout-grpc
  namespace: checkout
spec:
  parentRefs:
    - name: checkout-gateway
  hostnames:
    - grpc.checkout.local
  rules:
    - matches:
        - method:
            service: checkout.v1.Checkout
            method: Get
      backendRefs:
        - name: checkout-api
          port: 80
---
apiVersion: gateway.networking.k8s.io/v1alpha2
kind: TLSRoute
metadata:
  name: checkout-tls
  namespace: checkout
spec:
  parentRefs:
    - name: checkout-gateway
  hostnames:
    - tls.checkout.local
  rules:
    - backendRefs:
        - name: checkout-api
          port: 443
---
apiVersion: gateway.networking.k8s.io/v1alpha2
kind: TCPRoute
metadata:
  name: checkout-tcp
  namespace: checkout
spec:
  parentRefs:
    - name: checkout-gateway
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
  template:
    metadata:
      labels:
        app: node-agent
    spec:
      containers:
        - name: agent
          image: agent:1.0.0
status:
  desiredNumberScheduled: 2
  numberReady: 2
---
apiVersion: v1
kind: Pod
metadata:
  name: node-agent-worker-a
  namespace: observability
  labels:
    app: node-agent
    tier: telemetry
spec:
  nodeName: worker-a
  containers:
    - name: agent
      image: agent:1.0.0
status:
  phase: Running
  containerStatuses:
    - name: agent
      ready: true
      restartCount: 0
      image: agent:1.0.0
      state:
        running: {}
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
