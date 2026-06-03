// 받은편지함 목록/상세 조회 + 수동 동기화 mutation.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { getMessage, listMessages, syncMailbox } from '../../api/mailMessages';
import { handleApiError } from '../../lib/api-error';

export const mailMessageKeys = {
  list: (accountId: number, query: string) =>
    ['mail-messages', accountId, query] as const,
  detail: (messageId: number) => ['mail-message', messageId] as const,
};

/** 계정의 메시지 목록(검색어 포함). accountId 가 없으면 비활성. */
export function useMailMessages(accountId: number | undefined, query: string) {
  return useQuery({
    queryKey: mailMessageKeys.list(accountId ?? 0, query),
    queryFn: () => listMessages(accountId as number, query || undefined),
    enabled: !!accountId,
  });
}

/** 메시지 단건 상세. messageId 가 없으면 비활성. */
export function useMailMessage(messageId: number | null) {
  return useQuery({
    queryKey: mailMessageKeys.detail(messageId ?? 0),
    queryFn: () => getMessage(messageId as number),
    enabled: !!messageId,
  });
}

/** INBOX 수동 동기화 — 성공 시 해당 계정의 목록 캐시 무효화. */
export function useSyncMailbox(accountId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => syncMailbox(accountId as number),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['mail-messages', accountId] });
      toast.success(
        result.saved > 0
          ? `새 메일 ${result.saved}건을 받았습니다`
          : '새 메일이 없습니다',
      );
    },
    onError: (e) => handleApiError(e, '동기화에 실패했습니다'),
  });
}
