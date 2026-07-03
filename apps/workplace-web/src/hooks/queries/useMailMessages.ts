// 받은편지함/보낸편지함 목록·상세 조회 + 동기화·발송 mutation.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { clearNeedsReplyDone, coachDraft, generateIssueDraft, generateReplyDraft, getLinkedIssue, getMailSummary, getMessage, getNeedsReplyCount, getSyncStatus, listMessages, markNeedsReplyDone, promoteMailToIssue, sendMail, syncMailbox } from '../../api/mailMessages';
import { handleApiError } from '../../lib/api-error';
import type { DraftCoachingRequest, EmailMessageSummary, MailFolder, MailSendRequest, PromoteToIssuePayload } from '../../types/mailMessage';

export const mailMessageKeys = {
  // #469: unread 필터를 캐시 키에 포함(읽음 목록과 안읽음 목록 캐시 분리).
  // P2: category/needsReply 필터도 캐시 키에 포함.
  list: (accountId: number, folder: MailFolder, query: string, unread = false,
         category = '', needsReply = false) =>
    ['mail-messages', accountId, folder, query, unread, category, needsReply] as const,
  detail: (messageId: number) => ['mail-message', messageId] as const,
  summary: (messageId: number) => ['mail-summary', messageId] as const,
  syncStatus: (accountId: number) => ['mail-sync-status', accountId] as const,
};

/** 계정의 메시지 목록(폴더·검색어·unread·category·needsReply 필터). accountId 가 없으면 비활성. */
export function useMailMessages(
  accountId: number | undefined,
  folder: MailFolder,
  query: string,
  unread = false,
  category = '',
  needsReply = false,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: mailMessageKeys.list(accountId ?? 0, folder, query, unread, category, needsReply),
    queryFn: () =>
      listMessages(accountId as number, folder, query || undefined, unread,
                   category || undefined, needsReply),
    enabled: (options?.enabled ?? true) && !!accountId,
    refetchInterval: 60_000,       // 백그라운드 자동 동기화로 들어온 새 메일을 주기 반영
    refetchOnWindowFocus: true,
  });
}

/** P2: 계정의 회신필요(미처리) 메일 건수(사이드바 배지). accountId 없으면 비활성. */
export function useNeedsReplyCount(accountId: number | undefined) {
  return useQuery({
    queryKey: ['mail-needs-reply-count', accountId ?? 0] as const,
    queryFn: () => getNeedsReplyCount(accountId as number),
    enabled: !!accountId,
    refetchInterval: 60_000,
  });
}

/**
 * P2: 회신필요 처리완료 mutation — 성공 시 목록·사이드바 카운트·홈 위젯 요약 무효화.
 * Sonner 토스트 "처리완료" + "되돌리기" 액션(DELETE 호출 후 재무효화).
 */
export function useMarkNeedsReplyDone(accountId: number | undefined) {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['mail-messages', accountId] })
    qc.invalidateQueries({ queryKey: ['mail-needs-reply-count', accountId] })
    // 홈 위젯 회신필요 카운트 갱신 — exact:true 로 메시지별 AI 요약 키 불필요 재생성 방지.
    qc.invalidateQueries({ queryKey: ['mail-summary'], exact: true })
  }
  return useMutation({
    mutationFn: (messageId: number) => markNeedsReplyDone(accountId as number, messageId),
    onSuccess: (_d, messageId) => {
      invalidate()
      toast.success('처리완료', {
        action: {
          label: '되돌리기',
          onClick: async () => {
            await clearNeedsReplyDone(accountId as number, messageId)
            invalidate()
          },
        },
      })
    },
    onError: (e) => handleApiError(e, '처리완료에 실패했습니다'),
  })
}

/** 메시지 단건 상세. messageId 가 없으면 비활성. 성공 시 목록 캐시의 seen 플래그를 낙관적으로 동기화(읽음 처리). */
export function useMailMessage(messageId: number | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: mailMessageKeys.detail(messageId ?? 0),
    queryFn: () => getMessage(messageId as number),
    enabled: !!messageId,
  });

  // 상세 조회 성공 시 모든 목록 캐시에서 해당 메시지의 seen=true 로 업데이트
  useEffect(() => {
    if (query.isSuccess && messageId) {
      qc.setQueriesData<EmailMessageSummary[]>(
        { queryKey: ['mail-messages'], exact: false },
        (old) => old?.map((msg) => (msg.id === messageId ? { ...msg, seen: true } : msg)),
      );
      // 홈 대시보드 메일 요약(useMailSummary, ['mail-summary'])도 무효화 — 읽음으로 회신 필요/안읽음 수 즉시 반영.
      // exact: true — 메시지별 AI 요약 ['mail-summary', messageId] 의 불필요한 재생성 방지(useSyncMailbox 와 동일).
      qc.invalidateQueries({ queryKey: ['mail-summary'], exact: true });
    }
  }, [query.isSuccess, messageId, qc]);

  return query;
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

/** 동기화 진행 상태 폴링 — running 동안 1초 간격, 그 외 정지. */
export function useSyncStatus(accountId: number | undefined, active: boolean) {
  return useQuery({
    queryKey: mailMessageKeys.syncStatus(accountId ?? 0),
    queryFn: () => getSyncStatus(accountId as number),
    enabled: !!accountId && active,
    refetchInterval: (q) => (q.state.data?.running ? 1000 : false),
  });
}

/** INBOX 수동 동기화 — 성공 시 해당 계정의 목록 캐시 + 홈 메일 요약 무효화. */
export function useSyncMailbox(accountId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => syncMailbox(accountId as number),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['mail-messages', accountId] });
      qc.invalidateQueries({ queryKey: mailMessageKeys.syncStatus(accountId ?? 0) });
      // 계정 목록(['mail-accounts'])도 무효화 — 받은편지함 헤더의 "N분 전 동기화됨"
      // 표시가 이 쿼리의 lastSyncedAt 에서 오므로, 무효화하지 않으면 동기화 후에도
      // "동기화 안 됨"이 갱신되지 않는다.
      qc.invalidateQueries({ queryKey: ['mail-accounts'] });
      // 홈 대시보드 안읽은 메일 위젯(useMailSummary, queryKey ['mail-summary'])도 갱신.
      // exact: true — 메시지별 AI 요약 ['mail-summary', messageId]까지 무효화해
      // 불필요한 AI 재생성이 일어나지 않도록 홈 요약 단건만 정확히 무효화한다.
      qc.invalidateQueries({ queryKey: ['mail-summary'], exact: true });
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

/** 초안 코칭 — "AI 검토" 탭 진입 시 1회 호출. 결과는 호출 측 로컬 state. */
export function useCoachDraft() {
  return useMutation({
    mutationFn: (req: DraftCoachingRequest) => coachDraft(req),
    onError: (e) => handleApiError(e, 'AI 검토에 실패했습니다'),
  })
}

/** #520 AI 이슈 초안 — 버튼 클릭 시 1회 생성. */
export function useIssueDraft() {
  return useMutation({
    mutationFn: (messageId: number) => generateIssueDraft(messageId),
    onError: (e) => handleApiError(e, 'AI 이슈 초안 생성에 실패했습니다'),
  })
}

/** #520 메일→이슈 승격(생성). 성공 시 linked-issue 무효화로 배지 갱신. */
export function usePromoteToIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ messageId, payload }: { messageId: number; payload: PromoteToIssuePayload }) =>
      promoteMailToIssue(messageId, payload),
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ['mail', 'linked-issue', v.messageId] }),
    onError: (e) => handleApiError(e, '이슈 생성에 실패했습니다'),
  })
}

/** #520 메일 연결 이슈(배지). */
export function useLinkedIssue(messageId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['mail', 'linked-issue', messageId],
    queryFn: () => getLinkedIssue(messageId as number),
    enabled: enabled && messageId != null,
  })
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
