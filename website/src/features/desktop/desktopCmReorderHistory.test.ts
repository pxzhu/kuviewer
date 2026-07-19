import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatDesktopCmSessionLayoutReorderHistoryAge,
  formatDesktopCmSessionLayoutReorderHistoryIsoTime,
  matchesDesktopCmSessionLayoutReorderHistoryScope,
  matchesDesktopCmSessionLayoutReorderHistoryStatus,
  slugifyDesktopCmTestId,
  type DesktopCmSessionLayoutReorderHistoryEntry,
} from './desktopCmReorderHistory.ts';

const entry: DesktopCmSessionLayoutReorderHistoryEntry = {
  id: '1', scope: 'folder', message: 'Reorder complete: Production moved.', createdAt: 1_000,
};

test('reorder history filters use bounded safe metadata', () => {
  assert.equal(matchesDesktopCmSessionLayoutReorderHistoryScope(entry, 'all'), true);
  assert.equal(matchesDesktopCmSessionLayoutReorderHistoryScope(entry, 'folder'), true);
  assert.equal(matchesDesktopCmSessionLayoutReorderHistoryScope(entry, 'focus'), false);
  assert.equal(matchesDesktopCmSessionLayoutReorderHistoryStatus(entry, 'reorder-complete'), true);
  assert.equal(matchesDesktopCmSessionLayoutReorderHistoryStatus(entry, 'reorder-unavailable'), false);
});

test('reorder history time and test-id helpers tolerate malformed values', () => {
  assert.equal(formatDesktopCmSessionLayoutReorderHistoryAge(1_000, 6_000), 'just now');
  assert.equal(formatDesktopCmSessionLayoutReorderHistoryAge(1_000, 62_000), '1m ago');
  assert.equal(formatDesktopCmSessionLayoutReorderHistoryAge(Number.NaN, 1_000), 'timestamp unknown');
  assert.equal(formatDesktopCmSessionLayoutReorderHistoryIsoTime(Number.NaN), '');
  assert.equal(slugifyDesktopCmTestId(' Production / API '), 'production-api');
});
