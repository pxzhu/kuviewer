const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function formatClockTime(value: Date | number | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return clockFormatter.format(date);
}

export function formatLastSync(lastUpdatedAt: number | null, emptyLabel = '동기화 안 됨') {
  if (!lastUpdatedAt) {
    return emptyLabel;
  }

  return formatClockTime(lastUpdatedAt) || emptyLabel;
}
