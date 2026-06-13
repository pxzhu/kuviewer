import { useEffect, useState } from 'react';
import { fetchConnectorStatus } from '../../services/statusApi';
import { getTopologyApiBaseUrl } from '../../services/topologyApi';
import type { ConnectorStatus } from '../../types/status';

export function useConnectorStatus(enabled: boolean) {
  const apiBaseUrl = getTopologyApiBaseUrl();
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      setLoading(false);
      setError('');
      return;
    }

    if (!apiBaseUrl) {
      setStatus(null);
      setLoading(false);
      setError('api_base_url_not_configured');
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError('');

    fetchConnectorStatus(controller.signal)
      .then((nextStatus) => {
        setStatus(nextStatus);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setStatus(null);
        setError(requestError instanceof Error ? requestError.message : 'status_request_failed');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [apiBaseUrl, enabled]);

  return {
    status,
    loading,
    error,
  };
}
