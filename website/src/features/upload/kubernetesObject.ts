export interface KubeObject {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    ownerReferences?: Array<{ kind?: string; name?: string }>;
    creationTimestamp?: string;
  };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  data?: Record<string, unknown>;
  binaryData?: Record<string, unknown>;
  immutable?: boolean;
  items?: KubeObject[];
}

export function readAt(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);
}

export function stringAt(value: unknown, path: string[]) {
  const result = readAt(value, path);
  return typeof result === 'string' ? result : '';
}

export function numberAt(value: unknown, path: string[]) {
  const result = readAt(value, path);
  return typeof result === 'number' ? result : undefined;
}

export function boolAt(value: unknown, path: string[]) {
  const result = readAt(value, path);
  return typeof result === 'boolean' ? result : undefined;
}

export function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function uniqueStrings(values: string[]) {
  return Array.from(new Set(values)).sort();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
