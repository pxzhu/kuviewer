import { FormEvent, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { getStoredAdminToken, isValidAdminToken, storeAdminToken } from '../features/auth/adminToken';
import { fetchConnectorStatusWithToken } from '../services/statusApi';
import { getTopologyApiBaseUrl } from '../services/topologyApi';
import { KuButton } from './ui/KuButton';
import { KuInput } from './ui/KuInput';
import { KuSurface } from './ui/KuSurface';

interface TokenGateProps {
  onUnlock: () => void;
}

export function TokenGate({ onUnlock }: TokenGateProps) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const token = String(formData.get('adminToken') || '').trim();

    if (!isValidAdminToken(token)) {
      setError('admin token을 입력해주세요.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      if (getTopologyApiBaseUrl()) {
        await fetchConnectorStatusWithToken(token);
      }
      storeAdminToken(token);
      onUnlock();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'token_validation_failed';
      setError(message.includes('401') ? 'admin token이 올바르지 않습니다.' : `token 확인 실패: ${message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10 text-[#1d1d1f]">
      <KuSurface className="w-full max-w-[430px] p-5 sm:p-6" role="region" aria-label="관리자 인증">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#007aff] text-white shadow-[0_8px_22px_rgba(0,122,255,0.24)]">
            <LockKeyhole size={22} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.02em]">Kuviewer</h1>
            <p className="ku-meta mt-1">Admin token 필요</p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[#1d1d1f]">Admin token</span>
            <KuInput
              className="h-11 w-full"
              name="adminToken"
              type="password"
              defaultValue={getStoredAdminToken()}
              onChange={() => setError('')}
              placeholder="kuviewer-admin"
              autoComplete="current-password"
            />
          </label>

          {error ? (
            <p className="rounded-[10px] border border-[rgba(255,59,48,0.22)] bg-[rgba(255,59,48,0.10)] px-3 py-2 text-sm font-medium text-[#d70015]">
              {error}
            </p>
          ) : null}

          <KuButton
            className="h-11 w-full"
            disabled={submitting}
            type="submit"
            tone="primary"
          >
            {submitting ? '토큰 확인 중...' : '토폴로지 열기'}
          </KuButton>
        </form>
      </KuSurface>
    </main>
  );
}
