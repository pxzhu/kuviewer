export function safeAnnotations(values?: Record<string, string>) {
  if (!values) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, sensitiveField(key) || sensitiveField(value) ? 'redacted' : value]),
  );
}

export function sensitiveField(value: string) {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('token') ||
    normalized.includes('password') ||
    normalized.includes('secret') ||
    normalized.includes('credential') ||
    normalized.includes('apikey') ||
    normalized.includes('api-key') ||
    normalized.includes('accesskey') ||
    normalized.includes('access-key') ||
    normalized.includes('private-key') ||
    normalized.includes('client-key')
  );
}
