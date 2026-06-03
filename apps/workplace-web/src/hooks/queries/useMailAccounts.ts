// 메일 계정 목록 조회 + 생성/수정/삭제/연결 테스트 mutation. queryKey 는 ['mail-accounts'] 단일.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  createMailAccount,
  deleteMailAccount,
  listMailAccounts,
  testMailConnection,
  updateMailAccount,
} from '../../api/mailAccounts';
import { handleApiError } from '../../lib/api-error';
import type { MailAccountRequest } from '../../types/mailAccount';

export const mailAccountKeys = {
  all: ['mail-accounts'] as const,
};

export function useMailAccounts() {
  return useQuery({
    queryKey: mailAccountKeys.all,
    queryFn: listMailAccounts,
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
