import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDesktopCmSessionCloneName,
  formatCmSessionCheckStatus,
  formatCmSessionError,
  formatRuntimeStatus,
  normalizeSearchValue,
  validateDesktopCmSessionForm,
} from './desktopCmSessionPresentation.ts';

const validForm = {
  name: 'Primary CM',
  host: 'cm.internal',
  port: 22,
  user: 'ubuntu',
  remoteApiHost: '127.0.0.1',
  remoteApiPort: 18085,
};

test('desktop CM form validation rejects missing identity and invalid ports', () => {
  assert.equal(validateDesktopCmSessionForm(validForm), '');
  assert.equal(validateDesktopCmSessionForm({ ...validForm, name: ' ' }), 'name 필요');
  assert.equal(validateDesktopCmSessionForm({ ...validForm, host: '' }), 'host 필요');
  assert.equal(validateDesktopCmSessionForm({ ...validForm, user: '' }), 'user 필요');
  assert.equal(validateDesktopCmSessionForm({ ...validForm, port: 0 }), 'port 1-65535');
  assert.equal(validateDesktopCmSessionForm({ ...validForm, remoteApiPort: 65536 }), 'API port 1-65535');
});

test('desktop CM error formatting returns bounded safe messages instead of raw errors', () => {
  assert.equal(formatCmSessionError('desktop_cm_runtime_health_failed: redacted-input'), 'API health 확인 실패');
  assert.equal(formatCmSessionError('desktop_cm_private_key_file_invalid: /Users/example/.ssh/id_key'), 'key 파일 오류');
  assert.equal(formatCmSessionError('unexpected raw stderr with sensitive details'), '세션 오류');
  assert.equal(formatCmSessionError('desktop_cm_session_timeout'), '연결 시간 초과');
});

test('desktop CM clone names are unique, bounded, and search normalization is stable', () => {
  const sessions = [{ name: 'Primary CM copy' }, { name: 'Primary CM copy 2' }] as never;
  assert.equal(buildDesktopCmSessionCloneName('Primary CM', sessions), 'Primary CM copy 3');
  assert.ok(buildDesktopCmSessionCloneName('x'.repeat(100), []).length <= 60);
  assert.equal(normalizeSearchValue('  SSH Auth  '), 'ssh auth');
  assert.equal(formatCmSessionCheckStatus('auth-failed'), '인증 실패');
  assert.equal(formatRuntimeStatus('runtime-lost'), 'runtime 끊김');
});
