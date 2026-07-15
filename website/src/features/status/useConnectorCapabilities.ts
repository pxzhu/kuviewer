import { useCallback, useEffect, useState } from 'react';
import { fetchConnectorCapabilities } from '../../services/statusApi';
import { getTopologyApiBaseUrl } from '../../services/topologyApi';
import type { CapabilityReport } from '../../types/capabilities';

export function useConnectorCapabilities(enabled: boolean) {
  const apiBaseUrl = getTopologyApiBaseUrl();
  const [report, setReport] = useState<CapabilityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = useCallback(() => setRefreshTick((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) {
      setReport(null);
      setLoading(false);
      setError('');
      return;
    }
    if (!apiBaseUrl) {
      setReport(null);
      setLoading(false);
      setError('api_base_url_not_configured');
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetchConnectorCapabilities(controller.signal)
      .then(setReport)
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setReport(null);
          setError(requestError instanceof Error ? requestError.message : 'capabilities_request_failed');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [apiBaseUrl, enabled, refreshTick]);

  return { report, loading, error, refresh };
}
