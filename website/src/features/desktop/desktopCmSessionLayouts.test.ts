import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDesktopCmSessionLayoutFolderFilterOptions,
  buildDesktopCmSessionLayoutFolders,
  createDesktopCmSessionLayoutExportBundle,
  desktopCmSessionLayoutEqual,
  desktopCmSessionLayoutExportKind,
  matchesDesktopCmSessionLayoutSearch,
  maxDesktopCmSessionLayoutPresets,
  moveDesktopCmSessionLayoutFolderBefore,
  moveDesktopCmSessionLayoutFolderToIndex,
  moveDesktopCmSessionLayoutPresetBefore,
  moveDesktopCmSessionLayoutPresetToIndex,
  normalizeDesktopCmSessionLayoutPresets,
  parseDesktopCmSessionLayoutImportBundle,
} from './desktopCmSessionLayouts.ts';

const sessions = [{ id: 'cm-a' }, { id: 'cm-b' }, { id: 'cm-c' }] as never;

function viewPreferences(sessionId: string, group = 'General', favorite = false) {
  return {
    sessions: [{ sessionId, group, favorite, updatedAt: 10 }],
    collapsedGroups: [],
  };
}

function layout(name: string, folder: string, sessionId: string) {
  return {
    name,
    folder,
    viewPreferences: viewPreferences(sessionId, folder),
    updatedAt: 10,
  };
}

test('desktop CM layouts reject unnamed entries, normalize metadata, and enforce the cap', () => {
  const candidates = [
    { folder: 'Hidden', viewPreferences: viewPreferences('cm-a'), updatedAt: 1 },
    layout('  Primary   layout  ', '  Production   East ', 'cm-a'),
    layout('primary layout', 'Ignored duplicate', 'cm-b'),
    ...Array.from({ length: 10 }, (_, index) => layout(`Layout ${index + 1}`, 'General', 'cm-b')),
  ];

  const normalized = normalizeDesktopCmSessionLayoutPresets(candidates);

  assert.equal(normalized.length, maxDesktopCmSessionLayoutPresets);
  assert.equal(normalized[0].name, 'Primary layout');
  assert.equal(normalized[0].folder, 'Production East');
  assert.equal(normalized.some((preset) => preset.folder === 'Hidden'), false);
  assert.equal(normalized.filter((preset) => preset.name.toLowerCase() === 'primary layout').length, 1);
});

test('desktop CM layout import accepts safe metadata and prunes unknown sessions', () => {
  const parsed = parseDesktopCmSessionLayoutImportBundle({
    schemaVersion: 1,
    kind: desktopCmSessionLayoutExportKind,
    items: [
      {
        name: 'Ops layout',
        folder: 'Ops',
        viewPreferences: {
          sessions: [
            { sessionId: 'cm-a', group: 'Ops', favorite: true, updatedAt: 1 },
            { sessionId: 'missing', group: 'Hidden', favorite: true, updatedAt: 2 },
          ],
          collapsedGroups: ['Ops'],
        },
        updatedAt: 20,
      },
      { name: 'ops layout', folder: 'Duplicate', viewPreferences: viewPreferences('cm-b') },
      { name: 'Missing session', folder: 'Ops', viewPreferences: viewPreferences('unknown') },
      { name: '', viewPreferences: viewPreferences('cm-a') },
    ],
  }, sessions);

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.invalid, 2);
  assert.deepEqual(parsed.items[0].viewPreferences.sessions.map((preference) => preference.sessionId), ['cm-a']);
  assert.throws(
    () => parseDesktopCmSessionLayoutImportBundle({ kind: 'other.bundle', items: [] }, sessions),
    /desktop_cm_session_layout_import_invalid_kind/,
  );
  assert.throws(
    () => parseDesktopCmSessionLayoutImportBundle({ schemaVersion: 2, items: [] }, sessions),
    /desktop_cm_session_layout_import_invalid_version/,
  );
});

test('desktop CM layout folder and preset reordering remains deterministic', () => {
  const presets = [
    layout('General one', 'General', 'cm-a'),
    layout('Ops one', 'Ops', 'cm-b'),
    layout('Ops two', 'Ops', 'cm-c'),
    layout('Dev one', 'Dev', 'cm-a'),
  ];

  assert.deepEqual(
    moveDesktopCmSessionLayoutFolderBefore(presets, 'Dev', 'Ops').map((preset) => preset.name),
    ['General one', 'Dev one', 'Ops one', 'Ops two'],
  );
  assert.deepEqual(
    moveDesktopCmSessionLayoutFolderToIndex(presets, 'Dev', 0).map((preset) => preset.name),
    ['Dev one', 'General one', 'Ops one', 'Ops two'],
  );
  assert.deepEqual(
    moveDesktopCmSessionLayoutPresetBefore(presets, 'Ops two', 'Ops one').map((preset) => preset.name),
    ['General one', 'Ops two', 'Ops one', 'Dev one'],
  );
  assert.deepEqual(
    moveDesktopCmSessionLayoutPresetToIndex(presets, 'Ops one', 1).map((preset) => preset.name),
    ['General one', 'Ops two', 'Ops one', 'Dev one'],
  );
  assert.deepEqual(
    moveDesktopCmSessionLayoutPresetBefore(presets, 'Ops one', 'Dev one').map((preset) => preset.name),
    presets.map((preset) => preset.name),
  );
});

test('desktop CM layout grouping, search, equality, and export use safe view metadata', () => {
  const presets = [
    { ...layout('Production favorites', 'Ops', 'cm-a'), viewPreferences: viewPreferences('cm-a', 'Ops', true) },
    layout('Default layout', 'General', 'cm-b'),
  ];
  const folderOptions = buildDesktopCmSessionLayoutFolderFilterOptions(presets);
  const folders = buildDesktopCmSessionLayoutFolders(presets, [presets[0]], new Set(['Ops']), { includeFolders: ['General'] });
  const exported = createDesktopCmSessionLayoutExportBundle(presets);

  assert.deepEqual(folderOptions.map((option) => option.folder), ['General', 'Ops']);
  assert.deepEqual(folders.map((folder) => [folder.folder, folder.presets.length, folder.totalCount, folder.collapsed]), [
    ['General', 0, 1, false],
    ['Ops', 1, 1, true],
  ]);
  assert.equal(matchesDesktopCmSessionLayoutSearch(presets[0], '즐겨찾기'), true);
  assert.equal(matchesDesktopCmSessionLayoutSearch(presets[0], 'private key'), false);
  const equivalentLayoutLeft = {
    sessions: [
      { sessionId: 'cm-a', group: 'Ops', favorite: true, updatedAt: 1 },
      { sessionId: 'cm-b', group: 'General', favorite: false, updatedAt: 2 },
    ],
    collapsedGroups: ['Ops', 'General'],
  };
  const equivalentLayoutRight = {
    sessions: [...equivalentLayoutLeft.sessions].reverse(),
    collapsedGroups: [...equivalentLayoutLeft.collapsedGroups].reverse(),
  };
  assert.equal(desktopCmSessionLayoutEqual(equivalentLayoutLeft, equivalentLayoutRight), true);
  assert.equal(exported.kind, desktopCmSessionLayoutExportKind);
  assert.equal(JSON.stringify(exported).includes('credential'), false);
  assert.equal(JSON.stringify(exported).includes('privateKey'), false);
});
