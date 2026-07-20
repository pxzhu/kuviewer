import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAppConnectorStatus, formatAppUiError } from './appHeaderPresentation.ts';

test('app header connector status keeps source-specific safe summaries', () => {
  assert.equal(formatAppConnectorStatus(null, false, '', 'upload', false, null), '업로드 소스 · 매니페스트 대기 중');
  assert.equal(formatAppConnectorStatus(null, false, '', 'mock', false, null), '목업 소스 · 내장 데모 데이터');
  assert.equal(formatAppConnectorStatus(null, false, '', 'live', false, null), '실시간 소스 잠김 · admin token 필요');
  assert.equal(formatAppConnectorStatus(null, true, '', 'live', true, null), '제공자 상태 로딩 중');
});

test('app header error formatting never echoes unknown or remote error text', () => {
  const sensitiveRemoteText = 'failed to fetch https://private-host.example/api?credential=confidential-placeholder';
  const connectorMessage = formatAppConnectorStatus(null, false, sensitiveRemoteText, 'live', true, null);
  const uiMessage = formatAppUiError(sensitiveRemoteText);
  const unknownMessage = formatAppUiError('unexpected private diagnostic body');

  assert.equal(connectorMessage.includes('private-host'), false);
  assert.equal(connectorMessage.includes('confidential-placeholder'), false);
  assert.equal(uiMessage.includes('private-host'), false);
  assert.equal(uiMessage.includes('confidential-placeholder'), false);
  assert.equal(unknownMessage, '요청을 처리하지 못했습니다.');
});

test('app header maps known upload and topology errors to bounded messages', () => {
  assert.equal(formatAppUiError('invalid_topology_json:details'), '토폴로지 JSON 형식이 올바르지 않습니다.');
  assert.equal(formatAppUiError('topology_import_failed:details'), '토폴로지 JSON 가져오기에 실패했습니다.');
  assert.equal(formatAppUiError('upload_parse_failed:details'), '업로드 파일을 해석하지 못했습니다.');
  assert.equal(formatAppUiError('topology_request_failed:500:remote body'), '서버가 토폴로지 요청을 처리하지 못했습니다.');
});
