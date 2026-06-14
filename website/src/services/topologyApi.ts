import type { TopologySnapshot } from '../types/topology';
import { getStoredAdminToken } from '../features/auth/adminToken';

export function getTopologyApiBaseUrl() {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  if (import.meta.env.PROD) {
    return window.location.origin;
  }

  return '';
}

export async function fetchTopologySnapshot(signal?: AbortSignal): Promise<TopologySnapshot> {
  const baseUrl = getTopologyApiBaseUrl().replace(/\/$/, '');

  if (!baseUrl) {
    throw new Error('api_base_url_not_configured');
  }

  const response = await fetch(`${baseUrl}/api/topology`, {
    headers: {
      Authorization: `Bearer ${getStoredAdminToken()}`,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`topology_request_failed:${response.status}`);
  }

  return response.json() as Promise<TopologySnapshot>;
}
