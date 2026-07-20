export interface LabelNamespaceRecord {
  name: string;
  labels: Record<string, string>;
}

const maxSelectorLabels = 100;
const maxSelectorExpressions = 100;
const maxExpressionValues = 100;
const maxSelectorKeyLength = 317;
const maxLabelNameLength = 63;
const maxDnsPrefixLength = 253;
const maxSelectorValueLength = 63;
const maxSummaryKeys = 12;

interface ParsedLabelSelector {
  matchLabels: Record<string, string>;
  matchExpressions: LabelSelectorExpression[];
}

interface LabelSelectorExpression {
  key: string;
  operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist';
  values: string[];
}

export function labelSelectorMatches(selector: unknown, labels: Record<string, string>) {
  const parsed = parseLabelSelector(selector);
  if (!parsed) {
    return false;
  }
  if (!Object.entries(parsed.matchLabels).every(([key, value]) => labels[key] === value)) {
    return false;
  }
  return parsed.matchExpressions.every((expression) => expressionMatches(expression, labels));
}

export function matchingNetworkPolicyNamespaces(
  namespaces: LabelNamespaceRecord[],
  policyNamespace: string,
  namespaceSelector: unknown,
) {
  if (namespaceSelector == null) {
    return new Set([policyNamespace]);
  }
  if (!isRecord(namespaceSelector)) {
    return new Set<string>();
  }
  return new Set(
    namespaces
      .filter((namespace) => labelSelectorMatches(namespaceSelector, namespace.labels))
      .map((namespace) => namespace.name),
  );
}

export function selectorKeySummary(value: unknown) {
  if (!isRecord(value)) {
    return '-';
  }
  return summarizeKeys(Object.keys(value));
}

export function labelSelectorSummary(value: unknown, emptyLabel = 'all pods') {
  const parsed = parseLabelSelector(value);
  if (!parsed) {
    return 'invalid selector';
  }
  const keys = Object.keys(parsed.matchLabels);
  if (keys.length === 0 && parsed.matchExpressions.length === 0) {
    return emptyLabel;
  }
  const labelSummary = keys.length > 0 ? summarizeKeys(keys) : '';
  return [
    labelSummary,
    parsed.matchExpressions.length > 0 ? `${parsed.matchExpressions.length} expressions` : '',
  ].filter(Boolean).join(',');
}

function parseLabelSelector(selector: unknown): ParsedLabelSelector | null {
  if (!isRecord(selector)) {
    return null;
  }
  if (Object.keys(selector).some((key) => key !== 'matchLabels' && key !== 'matchExpressions')) {
    return null;
  }

  const matchLabels = parseMatchLabels(selector.matchLabels);
  if (!matchLabels) {
    return null;
  }
  const matchExpressions = parseMatchExpressions(selector.matchExpressions);
  if (!matchExpressions) {
    return null;
  }
  return { matchLabels, matchExpressions };
}

function parseMatchLabels(value: unknown): Record<string, string> | null {
  if (value == null) {
    return {};
  }
  if (!isRecord(value)) {
    return null;
  }
  const entries = Object.entries(value);
  if (entries.length > maxSelectorLabels) {
    return null;
  }
  const parsed: Record<string, string> = {};
  for (const [key, labelValue] of entries) {
    if (!validSelectorKey(key) || !validSelectorValue(labelValue)) {
      return null;
    }
    parsed[key] = labelValue;
  }
  return parsed;
}

function parseMatchExpressions(value: unknown): LabelSelectorExpression[] | null {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > maxSelectorExpressions) {
    return null;
  }
  const expressions: LabelSelectorExpression[] = [];
  for (const item of value) {
    const expression = parseExpression(item);
    if (!expression) {
      return null;
    }
    expressions.push(expression);
  }
  return expressions;
}

function parseExpression(value: unknown): LabelSelectorExpression | null {
  if (!isRecord(value)) {
    return null;
  }
  if (Object.keys(value).some((key) => key !== 'key' && key !== 'operator' && key !== 'values')) {
    return null;
  }
  if (!validSelectorKey(value.key) || !isSelectorOperator(value.operator)) {
    return null;
  }

  const values = parseExpressionValues(value.values);
  if (!values) {
    return null;
  }
  if ((value.operator === 'In' || value.operator === 'NotIn') && values.length === 0) {
    return null;
  }
  if ((value.operator === 'Exists' || value.operator === 'DoesNotExist') && values.length > 0) {
    return null;
  }
  return { key: value.key, operator: value.operator, values };
}

function parseExpressionValues(value: unknown) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > maxExpressionValues) {
    return null;
  }
  const values: string[] = [];
  for (const item of value) {
    if (!validSelectorValue(item)) {
      return null;
    }
    values.push(item);
  }
  return values;
}

function expressionMatches(expression: LabelSelectorExpression, labels: Record<string, string>) {
  switch (expression.operator) {
    case 'In':
      return expression.values.includes(labels[expression.key]);
    case 'NotIn':
      return !expression.values.includes(labels[expression.key]);
    case 'Exists':
      return Object.prototype.hasOwnProperty.call(labels, expression.key);
    case 'DoesNotExist':
      return !Object.prototype.hasOwnProperty.call(labels, expression.key);
  }
}

function summarizeKeys(keys: string[]) {
  if (keys.length === 0) {
    return '-';
  }
  const safeKeys = keys.slice(0, maxSummaryKeys).map(safeSummaryKey);
  if (keys.length > maxSummaryKeys) {
    safeKeys.push(`+${keys.length - maxSummaryKeys}`);
  }
  return safeKeys.join(',');
}

function safeSummaryKey(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, maxSelectorKeyLength);
}

function validSelectorKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxSelectorKeyLength) {
    return false;
  }
  const segments = value.split('/');
  if (segments.length > 2) {
    return false;
  }
  const name = segments[segments.length - 1] || '';
  if (!validLabelName(name)) {
    return false;
  }
  return segments.length === 1 || validDnsPrefix(segments[0] || '');
}

function validSelectorValue(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= maxSelectorValueLength
    && (value.length === 0 || validLabelName(value));
}

function validLabelName(value: string) {
  return value.length > 0
    && value.length <= maxLabelNameLength
    && /^[A-Za-z0-9](?:[-_.A-Za-z0-9]*[A-Za-z0-9])?$/.test(value);
}

function validDnsPrefix(value: string) {
  return value.length > 0
    && value.length <= maxDnsPrefixLength
    && value.split('.').every(
      (segment) => segment.length > 0
        && segment.length <= 63
        && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(segment),
    );
}

function isSelectorOperator(value: unknown): value is LabelSelectorExpression['operator'] {
  return value === 'In'
    || value === 'NotIn'
    || value === 'Exists'
    || value === 'DoesNotExist';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
