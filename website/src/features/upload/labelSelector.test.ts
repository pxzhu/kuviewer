import assert from 'node:assert/strict';
import test from 'node:test';
import {
  labelSelectorMatches,
  labelSelectorSummary,
  matchingNetworkPolicyNamespaces,
  selectorKeySummary,
} from './labelSelector.ts';

test('label selectors combine matchLabels and supported expressions with AND semantics', () => {
  const labels = { app: 'checkout', tier: 'api', managed: 'true', 'app.kubernetes.io/name': 'checkout' };

  assert.equal(labelSelectorMatches({}, labels), true);
  assert.equal(labelSelectorMatches({ matchLabels: { app: 'checkout', tier: 'api' } }, labels), true);
  assert.equal(labelSelectorMatches({ matchLabels: { app: 'other' } }, labels), false);
  assert.equal(labelSelectorMatches({ matchLabels: { 'app.kubernetes.io/name': 'checkout' } }, labels), true);
  assert.equal(labelSelectorMatches({ matchExpressions: [{ key: 'tier', operator: 'In', values: ['api', 'worker'] }] }, labels), true);
  assert.equal(labelSelectorMatches({ matchExpressions: [{ key: 'tier', operator: 'NotIn', values: ['frontend'] }] }, labels), true);
  assert.equal(labelSelectorMatches({ matchExpressions: [{ key: 'managed', operator: 'Exists' }] }, labels), true);
  assert.equal(labelSelectorMatches({ matchExpressions: [{ key: 'debug', operator: 'DoesNotExist', values: [] }] }, labels), true);
  assert.equal(labelSelectorMatches({
    matchLabels: { app: 'checkout' },
    matchExpressions: [
      { key: 'tier', operator: 'In', values: ['api'] },
      { key: 'debug', operator: 'DoesNotExist' },
    ],
  }, labels), true);
});

test('label selectors fail closed for malformed and oversized input', () => {
  const labels = { app: 'checkout' };
  const oversizedLabels = Object.fromEntries(
    Array.from({ length: 101 }, (_, index) => [`key-${index}`, 'value']),
  );
  const oversizedExpressions = Array.from(
    { length: 101 },
    (_, index) => ({ key: `key-${index}`, operator: 'Exists' }),
  );

  assert.equal(labelSelectorMatches(undefined, labels), false);
  assert.equal(labelSelectorMatches({ unexpected: true }, labels), false);
  assert.equal(labelSelectorMatches({ matchLabels: [] }, labels), false);
  assert.equal(labelSelectorMatches({ matchLabels: { app: 42 } }, labels), false);
  assert.equal(labelSelectorMatches({ matchLabels: { 'invalid key': 'value' } }, labels), false);
  assert.equal(labelSelectorMatches({ matchLabels: { app: 'x'.repeat(64) } }, labels), false);
  assert.equal(labelSelectorMatches({ matchLabels: { 'INVALID.example/name': 'value' } }, labels), false);
  assert.equal(labelSelectorMatches({ matchLabels: oversizedLabels }, labels), false);
  assert.equal(labelSelectorMatches({ matchExpressions: {} }, labels), false);
  assert.equal(labelSelectorMatches({ matchExpressions: [null] }, labels), false);
  assert.equal(labelSelectorMatches({ matchExpressions: [{ key: 'app', operator: 'Unknown' }] }, labels), false);
  assert.equal(labelSelectorMatches({ matchExpressions: [{ key: 'app', operator: 'In', values: [] }] }, labels), false);
  assert.equal(labelSelectorMatches({ matchExpressions: [{ key: 'app', operator: 'Exists', values: ['unexpected'] }] }, labels), false);
  assert.equal(labelSelectorMatches({ matchExpressions: oversizedExpressions }, labels), false);
});

test('namespace selector matching preserves policy scope and evaluates explicit selectors', () => {
  const namespaces = [
    { name: 'checkout', labels: { environment: 'prod' } },
    { name: 'preview', labels: { environment: 'preview' } },
    { name: 'shared', labels: { shared: 'true' } },
  ];

  assert.deepEqual([...matchingNetworkPolicyNamespaces(namespaces, 'checkout', undefined)], ['checkout']);
  assert.deepEqual(
    [...matchingNetworkPolicyNamespaces(namespaces, 'checkout', { matchLabels: { environment: 'preview' } })],
    ['preview'],
  );
  assert.deepEqual([...matchingNetworkPolicyNamespaces(namespaces, 'checkout', {})], ['checkout', 'preview', 'shared']);
  assert.deepEqual([...matchingNetworkPolicyNamespaces(namespaces, 'checkout', 'invalid')], []);
});

test('selector summaries expose bounded keys and counts without label values', () => {
  const selector = {
    matchLabels: { app: 'private-value', tier: 'api' },
    matchExpressions: [{ key: 'managed', operator: 'Exists' }],
  };
  const manyKeys = Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`key-${index}`, 'value']));

  assert.equal(labelSelectorSummary(selector), 'app,tier,1 expressions');
  assert.equal(labelSelectorSummary({}), 'all pods');
  assert.equal(labelSelectorSummary({ matchLabels: [] }), 'invalid selector');
  assert.equal(selectorKeySummary({ app: 'private-value' }), 'app');
  assert.equal(selectorKeySummary(manyKeys), 'key-0,key-1,key-2,key-3,key-4,key-5,key-6,key-7,key-8,key-9,key-10,key-11,+3');
  assert.equal(labelSelectorSummary(selector).includes('private-value'), false);
});
