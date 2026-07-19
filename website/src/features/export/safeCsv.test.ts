import test from 'node:test';
import assert from 'node:assert/strict';
import { safeCsvCell, safeCsvDocument } from './safeCsv.ts';

test('safe CSV cells neutralize spreadsheet formulas and NUL bytes', () => {
  assert.equal(safeCsvCell('=HYPERLINK("https://example.invalid")'), `"'=HYPERLINK(""https://example.invalid"")"`);
  assert.equal(safeCsvCell('  +SUM(1,2)'), `"'  +SUM(1,2)"`);
  assert.equal(safeCsvCell('@command'), "'@command");
  assert.equal(safeCsvCell('-10'), "'-10");
  assert.equal(safeCsvCell('safe\0value'), 'safevalue');
});

test('safe CSV documents quote delimiters and preserve row structure', () => {
  const csv = safeCsvDocument(['name', 'message'], [
    ['pod-a', 'hello, world'],
    ['pod-b', 'line 1\nline 2'],
  ]);

  assert.equal(csv, 'name,message\npod-a,"hello, world"\npod-b,"line 1\nline 2"\n');
});
