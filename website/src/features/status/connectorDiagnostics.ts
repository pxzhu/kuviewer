export type ConnectorDiagnosticStage = 'configuration' | 'authentication' | 'authorization' | 'reachability' | 'server';

export interface ConnectorDiagnostic {
  stage: ConnectorDiagnosticStage;
  code: string;
  message: string;
  hint: string;
}

export function describeConnectorError(error: string): ConnectorDiagnostic {
  const statusCode = readStatusCode(error);
  if (error.includes('api_base_url')) {
    return diagnostic('configuration', 'api-not-configured', 'API 주소가 설정되지 않았습니다.', '배포 환경의 API base URL 또는 desktop runtime 연결을 확인하세요.');
  }
  if (statusCode === 401) {
    return diagnostic('authentication', 'authentication-failed', 'admin token 인증에 실패했습니다.', '실시간 잠금을 해제하고 올바른 admin token을 다시 입력하세요.');
  }
  if (statusCode === 403) {
    return diagnostic('authorization', 'rbac-denied', 'Kubernetes 읽기 권한이 부족합니다.', 'Kuviewer ServiceAccount의 read-only RBAC와 대상 API group 권한을 확인하세요.');
  }
  if (statusCode === 404) {
    return diagnostic('configuration', 'endpoint-not-found', '요청한 API endpoint를 찾지 못했습니다.', 'reverse proxy 경로와 서버 API 버전이 일치하는지 확인하세요.');
  }
  if (statusCode === 408 || statusCode === 504) {
    return diagnostic('reachability', 'request-timeout', '클러스터 응답 시간이 초과되었습니다.', 'API server 또는 SSH tunnel 연결 상태를 확인한 뒤 다시 시도하세요.');
  }
  if (statusCode === 429) {
    return diagnostic('server', 'rate-limited', '요청이 너무 많아 잠시 제한되었습니다.', '자동 새로고침을 멈추고 잠시 후 다시 시도하세요.');
  }
  if (statusCode && statusCode >= 500) {
    return diagnostic('server', 'server-unavailable', '서버가 토폴로지 요청을 처리하지 못했습니다.', 'Kuviewer server health와 Kubernetes API 연결 상태를 확인하세요.');
  }
  const normalizedError = error.toLowerCase();
  if (
    error === 'AbortError' ||
    normalizedError.includes('failed to fetch') ||
    normalizedError.includes('load failed') ||
    normalizedError.includes('network')
  ) {
    return diagnostic('reachability', 'network-unreachable', 'Kuviewer API에 연결할 수 없습니다.', '서버 주소, TLS, reverse proxy, desktop tunnel 상태를 확인하세요.');
  }
  if (error.includes('topology_request_failed') || error.includes('status_request_failed')) {
    return diagnostic('server', 'request-failed', 'Kuviewer API 요청에 실패했습니다.', '서버 health와 연결 설정을 확인한 뒤 다시 시도하세요.');
  }
  return diagnostic('server', 'unknown-error', '연결 상태를 확인하지 못했습니다.', '서버 health와 브라우저 네트워크 상태를 확인한 뒤 다시 시도하세요.');
}

function readStatusCode(error: string) {
  const match = error.match(/:(\d{3})(?:$|\D)/);
  return match ? Number(match[1]) : null;
}

function diagnostic(stage: ConnectorDiagnosticStage, code: string, message: string, hint: string): ConnectorDiagnostic {
  return { stage, code, message, hint };
}
