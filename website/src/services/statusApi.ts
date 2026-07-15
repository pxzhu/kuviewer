import { getStoredAdminToken } from '../features/auth/adminToken';
import type { ConnectorStatus } from '../types/status';
import type { CapabilityReport } from '../types/capabilities';
import { getTopologyApiBaseUrl } from './topologyApi';

export async function fetchConnectorStatus(signal?: AbortSignal): Promise<ConnectorStatus> {
  return fetchConnectorStatusWithToken(getStoredAdminToken(), signal);
}

export async function fetchConnectorStatusWithToken(token: string, signal?: AbortSignal): Promise<ConnectorStatus> {
  const baseUrl = getTopologyApiBaseUrl().replace(/\/$/, '');

  if (!baseUrl) {
    throw new Error('api_base_url_not_configured');
  }

  const response = await fetch(`${baseUrl}/api/status`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`status_request_failed:${response.status}`);
  }

  return response.json() as Promise<ConnectorStatus>;
}

export async function fetchConnectorCapabilities(signal?: AbortSignal): Promise<CapabilityReport> {
  const baseUrl = getTopologyApiBaseUrl().replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('api_base_url_not_configured');
  }

  const response = await fetch(`${baseUrl}/api/capabilities`, {
    headers: {
      Authorization: `Bearer ${getStoredAdminToken()}`,
    },
    signal,
  });
  if (!response.ok) {
    throw new Error(`capabilities_request_failed:${response.status}`);
  }
  return response.json() as Promise<CapabilityReport>;
}
