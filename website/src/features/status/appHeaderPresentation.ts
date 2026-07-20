import type { TopologySourceMode } from '../topology/useTopology';
import type { UploadedTopologyState } from '../upload/parseKubernetesFiles';
import type { ConnectorStatus } from '../../types/status';
import { describeConnectorError } from './connectorDiagnostics.ts';

export function formatAppConnectorStatus(
  status: ConnectorStatus | null,
  loading: boolean,
  error: string,
  sourceMode: TopologySourceMode,
  liveUnlocked: boolean,
  uploadedState: UploadedTopologyState | null,
) {
  if (sourceMode === 'upload') {
    if (!uploadedState) {
      return '업로드 소스 · 매니페스트 대기 중';
    }
    return `업로드 소스 · ${uploadedState.snapshot.nodes.length}개 리소스 · 경고 ${uploadedState.warnings.length}개`;
  }
  if (sourceMode === 'mock') {
    return '목업 소스 · 내장 데모 데이터';
  }
  if (!liveUnlocked) {
    return '실시간 소스 잠김 · admin token 필요';
  }
  if (status) {
    const accessLabel = status.readOnly ? '읽기 전용' : '쓰기 가능';
    const secretsLabel = status.secrets === 'hidden' ? 'Secret 숨김' : `Secret ${status.secrets}`;
    const uiLabel = status.static ? '정적 UI 포함' : '분리된 UI';
    return `제공자 ${status.source} · ${accessLabel} · ${secretsLabel} · ${uiLabel}`;
  }
  if (loading) {
    return '제공자 상태 로딩 중';
  }
  if (error) {
    return `제공자 상태 오류: ${describeConnectorError(error).message}`;
  }
  return '제공자 상태 확인 불가';
}

export function formatAppUiError(error: string) {
  if (error.includes('invalid_topology_json')) {
    return '토폴로지 JSON 형식이 올바르지 않습니다.';
  }
  if (error.includes('topology_import_failed')) {
    return '토폴로지 JSON 가져오기에 실패했습니다.';
  }
  if (error.includes('upload_parse_failed')) {
    return '업로드 파일을 해석하지 못했습니다.';
  }
  if (error.includes('topology_request_failed')) {
    return describeConnectorError(error).message;
  }
  if (error.includes('status_request_failed') || error.includes('api_base_url') || error.toLowerCase().includes('failed to fetch')) {
    return describeConnectorError(error).message;
  }
  return '요청을 처리하지 못했습니다.';
}
