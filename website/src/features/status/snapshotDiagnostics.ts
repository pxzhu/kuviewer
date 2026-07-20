import type { SnapshotDiagnostic } from '../../types/topology';

const reasonLabels: Record<string, string> = {
  response_too_large: '응답 제한',
  pagination_incomplete: '페이지 불완전',
  pagination_token_invalid: '페이지 토큰 오류',
  pagination_page_limit: '페이지 상한',
  pagination_item_limit: '항목 상한',
  pagination_byte_limit: '전체 용량 상한',
  invalid_response: '응답 형식 오류',
  response_read_failed: '응답 읽기 실패',
  api_unavailable: 'API 연결 실패',
  request_invalid: '요청 생성 실패',
  request_failed: 'API 요청 실패',
  invalid_item: '유효하지 않은 항목',
};

export function snapshotDiagnosticReasonLabel(reason: string) {
  return reasonLabels[reason] || '수집 실패';
}

export function snapshotDiagnosticAffectedCount(items: SnapshotDiagnostic[]) {
  return items.reduce((total, item) => total + Math.max(item.count, 1), 0);
}
