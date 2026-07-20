import assert from 'node:assert/strict';
import test from 'node:test';
import { slugifyDesktopCmTestId } from './desktopCmReorder.ts';

test('desktop CM reorder test ids remain normalized and bounded to a fallback', () => {
  assert.equal(slugifyDesktopCmTestId(' Production / API '), 'production-api');
  assert.equal(slugifyDesktopCmTestId('---'), 'preset');
});
