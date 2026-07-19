import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveResourceDetailShortcut } from './resourceDetailShortcut.ts';

test('resource detail shortcuts map navigation, section actions, and direct focus', () => {
  assert.deepEqual(resolveResourceDetailShortcut({ key: 'j' }), { type: 'move', offset: 1 });
  assert.deepEqual(resolveResourceDetailShortcut({ key: 'K' }), { type: 'move', offset: -1 });
  assert.deepEqual(resolveResourceDetailShortcut({ key: 'o' }), { type: 'toggle' });
  assert.deepEqual(resolveResourceDetailShortcut({ key: 'e' }), { type: 'expand-all' });
  assert.deepEqual(resolveResourceDetailShortcut({ key: 'c' }), { type: 'collapse-all' });
  assert.deepEqual(resolveResourceDetailShortcut({ key: 'r' }), { type: 'reset' });
  assert.deepEqual(resolveResourceDetailShortcut({ key: '1' }), { type: 'focus', sectionId: 'metadata' });
  assert.deepEqual(resolveResourceDetailShortcut({ key: '9' }), { type: 'focus', sectionId: 'logs' });
  assert.equal(resolveResourceDetailShortcut({ key: '0' }), null);
  assert.equal(resolveResourceDetailShortcut({ key: 'x' }), null);
});

test('resource detail shortcuts ignore editable targets and modified keys', () => {
  assert.equal(resolveResourceDetailShortcut({ key: 'j', editable: true }), null);
  assert.equal(resolveResourceDetailShortcut({ key: 'j', altKey: true }), null);
  assert.equal(resolveResourceDetailShortcut({ key: 'j', ctrlKey: true }), null);
  assert.equal(resolveResourceDetailShortcut({ key: 'j', metaKey: true }), null);
});
