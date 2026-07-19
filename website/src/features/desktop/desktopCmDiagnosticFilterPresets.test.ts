import assert from 'node:assert/strict';
import test from 'node:test';
import {
  desktopCmDiagnosticFilterPresetStorageKey,
  maxDesktopCmDiagnosticFilterPresets,
  normalizeDesktopCmDiagnosticFilterPresets,
  readDesktopCmDiagnosticFilterPresets,
  writeDesktopCmDiagnosticFilterPresets,
} from './desktopCmDiagnosticFilterPresets.ts';

test('diagnostic filter presets normalize safe fields, names, duplicates, and caps', () => {
  const presets = normalizeDesktopCmDiagnosticFilterPresets([
    { name: '  Reachability   errors ', diagnosticStage: 'reachability', diagnosticSeverity: 'error', updatedAt: 12 },
    { name: 'reachability errors', diagnosticStage: 'runtime', diagnosticSeverity: 'warning', updatedAt: 13 },
    { name: '', diagnosticStage: 'unknown', diagnosticSeverity: 'unknown', updatedAt: Number.NaN },
    ...Array.from({ length: 20 }, (_, index) => ({ name: `Preset ${index}`, diagnosticStage: 'all', diagnosticSeverity: 'info' })),
  ]);

  assert.equal(presets.length, maxDesktopCmDiagnosticFilterPresets);
  assert.deepEqual(presets[0], {
    name: 'Reachability errors',
    diagnosticStage: 'reachability',
    diagnosticSeverity: 'error',
    updatedAt: 12,
  });
  assert.equal(presets.filter((preset) => preset.name.toLowerCase() === 'reachability errors').length, 1);
  assert.equal(presets[1].name, 'all stages · all severities');
  assert.equal(presets[1].diagnosticStage, 'all');
  assert.equal(presets[1].diagnosticSeverity, 'all');
});

test('diagnostic filter storage removes malformed payloads and writes only normalized metadata', () => {
  const values = new Map([[desktopCmDiagnosticFilterPresetStorageKey, '{bad json']]);
  const removed: string[] = [];
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => { removed.push(key); values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, value); },
  };

  assert.deepEqual(readDesktopCmDiagnosticFilterPresets(storage), []);
  assert.deepEqual(removed, [desktopCmDiagnosticFilterPresetStorageKey]);

  writeDesktopCmDiagnosticFilterPresets([
    { name: ' Runtime ', diagnosticStage: 'runtime', diagnosticSeverity: 'warning', updatedAt: 42 },
  ], storage);
  assert.deepEqual(JSON.parse(values.get(desktopCmDiagnosticFilterPresetStorageKey) || '[]'), [{
    name: 'Runtime',
    diagnosticStage: 'runtime',
    diagnosticSeverity: 'warning',
    updatedAt: 42,
  }]);
});
