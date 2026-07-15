import type { TopologySnapshot } from '../types/topology';
import { getStoredAdminToken } from '../features/auth/adminToken';
import { getDesktopApiBaseUrl } from '../features/desktop/desktopApiBaseUrl';

export function getTopologyApiBaseUrl() {
  const desktopApiBaseUrl = getDesktopApiBaseUrl();
  if (desktopApiBaseUrl) {
    return desktopApiBaseUrl;
  }

  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  if (import.meta.env.PROD && isDesktopDocumentOrigin()) {
    return '';
  }

  if (import.meta.env.PROD) {
    return window.location.origin;
  }

  return '';
}

export async function fetchTopologySnapshot(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<TopologySnapshot> {
  const baseUrl = getTopologyApiBaseUrl().replace(/\/$/, '');

  if (!baseUrl) {
    throw new Error('api_base_url_not_configured');
  }

  const query = options.refresh ? '?refresh=true' : '';
  const response = await fetch(`${baseUrl}/api/topology${query}`, {
    headers: {
      Authorization: `Bearer ${getStoredAdminToken()}`,
    },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`topology_request_failed:${response.status}`);
  }

  return response.json() as Promise<TopologySnapshot>;
}

function isDesktopDocumentOrigin() {
  return window.location.protocol === 'tauri:' || window.location.hostname === 'tauri.localhost';
}
