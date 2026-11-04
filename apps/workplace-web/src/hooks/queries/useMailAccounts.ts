// 메일 계정 목록 조회 + 생성/수정/삭제/연결 테스트 mutation. queryKey 는 ['mail-accounts'] 단일.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  createMailAccount,
  deleteMailAccount,
  getM365MailStatus,
  listMailAccounts,
  setMailAiEnabled,
  testMailConnection,
  testMailConnectionForAccount,
  updateMailAccount,
} from '../../api/mailAccounts';
import { handleApiError } from '../../lib/api-error';
import type { MailAccountRequest } from '../../types/mailAccount';

export const mailAccountKeys = {
  all: ['mail-accounts'] as const,
};

export function useMailAccounts(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: mailAccountKeys.all,
    queryFn: listMailAccounts,
    enabled: options?.enabled ?? true,
  });
}

/**
 * 메일 계정 추가 시 Outlook(Microsoft 365)을 기본으로 고를지(WP-879). 워크스페이스 설정이라 거의 바뀌지 않는다.
 * 실패하면 기본값(IMAP)을 그대로 쓰면 되므로 재시도하지 않는다.
 */
export function useM365MailStatus() {
  return useQuery({
    // 계정 목록 키(['mail-accounts']) 밖에 둔다 — 계정 추가·수정 무효화 때마다 다시 조회할 필요가 없다.
    queryKey: ['mail-m365-status'],
    queryFn: getM365MailStatus,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useCreateMailAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MailAccountRequest) => createMailAccount(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mailAccountKeys.all });
      toast.success('메일 계정을 추가했습니다');
    },
    onError: (e) => handleApiError(e, '메일 계정 추가에 실패했습니다'),
  });
}

export function useUpdateMailAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: MailAccountRequest }) =>
      updateMailAccount(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mailAccountKeys.all });
      toast.success('메일 계정을 수정했습니다');
    },
    onError: (e) => handleApiError(e, '메일 계정 수정에 실패했습니다'),
  });
}

export function useDeleteMailAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteMailAccount(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mailAccountKeys.all });
      toast.success('메일 계정을 삭제했습니다');
    },
    onError: (e) => handleApiError(e, '메일 계정 삭제에 실패했습니다'),
  });
}

// 연결 테스트는 캐시 무효화 없이 결과만 반환(폼 인라인 표시).
export function useTestMailConnection() {
  return useMutation({
    mutationFn: (body: MailAccountRequest) => testMailConnection(body),
  });
}

/** 모든 활성 메일 계정의 개인 비서 사용 여부를 일괄 변경한다(전역 토글). */
export function useSetMailAiEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (aiEnabled: boolean) => setMailAiEnabled(aiEnabled),
    onSuccess: (_data, aiEnabled) => {
      qc.invalidateQueries({ queryKey: mailAccountKeys.all });
      toast.success(aiEnabled ? '개인 비서를 켰습니다' : '개인 비서를 껐습니다');
    },
    onError: (e) => handleApiError(e, '개인 비서 설정에 실패했습니다'),
  });
}

// 기존 계정 연결 테스트(수정 폼) — 비밀번호 미입력 시 저장된 비밀번호로 폴백(#448).
export function useTestMailConnectionForAccount() {
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: MailAccountRequest }) =>
      testMailConnectionForAccount(id, body),
  });
}
