// WP-1458 — 모델 목록 쿼리 키에 묶음 계정 id 가 들어 있다: 계정이 바뀌면 같은 엔드포인트라도 새 키로 다시 받는다.
// 네트워크는 vi.mock 으로 끊고, 훅을 렌더해 실제 쿼리 키 전환을 본다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const m = vi.hoisted(() => ({ getAgentModels: vi.fn(), getAgentAccount: vi.fn() }));
vi.mock('../../api/models', () => ({
  getAgentModels: m.getAgentModels,
  getMyAssistantModels: vi.fn(),
  probeAgentModels: vi.fn(),
  // useAssistant 가 쓰는 나머지 모듈 형상(쓰기 쪽에서 안 부른다).
}));
vi.mock('../../api/agents', () => ({ getAgentAccount: m.getAgentAccount }));

import { useAgentAccount, useAgentModels } from './useAssistant';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

test('같은 AI 라도 묶음 계정이 바뀌면 모델 목록을 다시 받는다', async () => {
  m.getAgentModels.mockResolvedValue({ provider: 'anthropic', models: [] });
  const { rerender } = renderHook(
    ({ userId, accountId }: { userId: number | null; accountId: number | null }) => useAgentModels(userId, accountId),
    { wrapper, initialProps: { userId: 7, accountId: 42 } },
  );
  await waitFor(() => expect(m.getAgentModels).toHaveBeenCalledWith(7));

  rerender({ userId: 7, accountId: 43 });

  await waitFor(() => expect(m.getAgentModels).toHaveBeenCalledTimes(2));
});

test('미묶임(404) — 계정 조회는 null, 모델 목록은 계정 키 없이 조회한다', async () => {
  m.getAgentAccount.mockRejectedValue({ response: { status: 404 } });
  m.getAgentModels.mockResolvedValue({ provider: 'anthropic', models: [] });

  const { result } = renderHook(() => ({ account: useAgentAccount(7), models: useAgentModels(7) }), { wrapper });

  await waitFor(() => expect(result.current.account.data).toBeNull());
  await waitFor(() => expect(m.getAgentModels).toHaveBeenCalledWith(7));
});
