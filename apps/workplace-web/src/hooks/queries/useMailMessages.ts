// 받은편지함/보낸편지함 목록·상세 조회 + 동기화·발송 mutation.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { generateReplyDraft, getMessage, getMailSummary, listMessages, sendMail, syncMailbox } from '../../api/mailMessages';
import { handleApiError } from '../../lib/api-error';
import type { MailFolder, MailSendRequest } from '../../types/mailMessage';

export const mailMessageKeys = {
  list: (accountId: number, folder: MailFolder, query: string) =>
    ['mail-messages', accountId, folder, query] as const,
  detail: (messageId: number) => ['mail-message', messageId] as const,
  summary: (messageId: number) => ['mail-summary', messageId] as const,
};

/** 계정의 메시지 목록(폴더·검색어). accountId 가 없으면 비활성. */
export function useMailMessages(
  accountId: number | undefined,
  folder: MailFolder,
  query: string,
) {
  return useQuery({
    queryKey: mailMessageKeys.list(accountId ?? 0, folder, query),
    queryFn: () => listMessages(accountId as number, folder, query || undefined),
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

/** 메일 요약 — 열람 시 자동 조회(계정 AI 사용 + messageId 있을 때만). */
export function useMailSummary(messageId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: mailMessageKeys.summary(messageId ?? 0),
    queryFn: () => getMailSummary(messageId as number),
    enabled: !!messageId && enabled,
    staleTime: Infinity,
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

/** AI 답장 초안 — 버튼 클릭 시 1회 생성. 결과는 호출 측에서 작성 도크에 채움. */
export function useReplyDraft() {
  return useMutation({
    mutationFn: (messageId: number) => generateReplyDraft(messageId),
    onError: (e) => handleApiError(e, 'AI 답장 초안 생성에 실패했습니다'),
  });
}

/** 메일 발송 — 성공 시 보낸편지함 목록 무효화 + 토스트. */
export function useSendMail(accountId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MailSendRequest) => sendMail(accountId as number, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mail-messages', accountId, 'SENT'] });
      toast.success('메일을 보냈습니다');
    },
    onError: (e) => handleApiError(e, '메일 발송에 실패했습니다'),
  });
}
