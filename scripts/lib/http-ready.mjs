const defaultTimeoutMs = 10_000;
const defaultIntervalMs = 250;

export async function waitForHttpReady(rawUrl, options = {}) {
  const url = safeHttpUrl(rawUrl);
  const timeoutMs = boundedDuration(options.timeoutMs, defaultTimeoutMs, 1_000, 120_000);
  const intervalMs = boundedDuration(options.intervalMs, defaultIntervalMs, 25, 5_000);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('http_ready_fetch_unavailable');
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url, { method: 'HEAD', redirect: 'manual' });
      if (response.ok) {
        return;
      }
    } catch {
      // The local preview may still be starting; raw network details are intentionally discarded.
    }
    await delay(intervalMs);
  }
  throw new Error('http_ready_timeout');
}

function safeHttpUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error('http_ready_invalid_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('http_ready_invalid_url');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  return url.toString();
}

function boundedDuration(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
