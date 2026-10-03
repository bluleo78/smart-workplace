// 받은편지함/보낸편지함 목록·상세 조회 + 동기화·발송 mutation.

import { type QueryClient, queryOptions, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { toast } from 'sonner';

import { coachDraft, fetchMailAttachmentDataUri, generateIssueDraft, generateMailSummary, generateReplyDraft, getLinkedIssue, getMailSummary, getMessage, getSyncStatus, getUnreadCounts, getUnreadSummary, listMessages, type MailViewScope, markAllRead, markMessageRead, markMessageUnread, promoteMailToIssue, sendMail, syncMailbox } from '../../api/mailMessages';
import { handleApiError } from '../../lib/api-error';
import { replaceCidRefs, resolveCidTargets } from '../../lib/mailInlineImages';
import type { DraftCoachingRequest, EmailAttachmentMeta, EmailMessageDetail, EmailMessageSummary, MailFolder, MailSendRequest, PromoteToIssuePayload } from '../../types/mailMessage';
import { mailMessageKeys } from './mailMessageKeys';

export { mailMessageKeys };

/**
 * 읽음 상태가 바뀌어 "안 읽은 수"가 달라졌을 때의 공통 무효화 — 사이드바 안 읽은 수(계정 무관 prefix)·탭 배지 합계·홈 메일 요약.
 * 홈 요약은 exact: true — 메시지별 AI 요약 ['mail-summary', id] 의 불필요한 재생성을 막는다(useSyncMailbox 와 동일).
 */
export function invalidateMailCounts(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: mailMessageKeys.unreadCountsAll() });
  qc.invalidateQueries({ queryKey: mailMessageKeys.unreadSummary() });
  qc.invalidateQueries({ queryKey: ['mail-summary'], exact: true });
}

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

/** WP-186 사이드바 안 읽은 수 + AI 분류 활성 여부. accountId 없으면 비활성. */
export function useUnreadCounts(accountId: number | undefined) {
  return useQuery({
    queryKey: mailMessageKeys.unreadCounts(accountId ?? 0),
    queryFn: () => getUnreadCounts(accountId as number),
    enabled: !!accountId,
    refetchInterval: 60_000,
  });
}

/** WP-186 모바일 탭 배지 합계. 모바일 셸에서만 켠다. */
export function useUnreadSummary(enabled: boolean) {
  return useQuery({
    queryKey: mailMessageKeys.unreadSummary(),
    queryFn: getUnreadSummary,
    enabled,
    refetchInterval: 60_000,
  });
}

/**
 * WP-187 한 통 읽음/안읽음 전환 — 목록 캐시의 seen 을 낙관적으로 바꾸고 실패하면 되돌린다.
 * 안 읽은 수는 낙관 갱신하지 않고(F17) 완료(settle) 시 무효화로 서버 값을 다시 받는다.
 */
export function useToggleRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, seen }: { id: number; seen: boolean }) => (seen ? markMessageRead(id) : markMessageUnread(id)),
    onMutate: async ({ id, seen }) => {
      await qc.cancelQueries({ queryKey: ['mail-messages'] });
      const snapshot = qc.getQueriesData<EmailMessageSummary[]>({ queryKey: ['mail-messages'] });
      qc.setQueriesData<EmailMessageSummary[]>({ queryKey: ['mail-messages'], exact: false }, (old) =>
        old?.map((m) => (m.id === id ? { ...m, seen } : m)),
      );
      // 상세 캐시의 seen 도 맞춘다 — 목록에 없는 메일(딥링크)의 첫 열람 판정이 이 값을 쓴다(WP-214).
      const detailSnapshot = qc.getQueryData<EmailMessageDetail>(mailMessageKeys.detail(id));
      if (detailSnapshot) qc.setQueryData<EmailMessageDetail>(mailMessageKeys.detail(id), { ...detailSnapshot, seen });
      return { snapshot, detailSnapshot };
    },
    onError: (e, { id }, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      if (ctx?.detailSnapshot) qc.setQueryData(mailMessageKeys.detail(id), ctx.detailSnapshot);
      handleApiError(e, '읽음 상태를 바꾸지 못했어요');
    },
    onSettled: () => {
      invalidateMailCounts(qc);
    },
  });
}

/** WP-187 모두 읽음 실행 — 성공 시 목록·안 읽은 수·탭 합계를 무효화하고 "N통 읽음 처리" 토스트. */
export function useMarkAllRead(accountId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MailViewScope & { asOf: string }) => markAllRead(accountId as number, body),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['mail-messages', accountId] });
      invalidateMailCounts(qc);
      toast.success(`${updated}통 읽음 처리`);
    },
    onError: (e) => handleApiError(e, '모두 읽음 처리하지 못했어요'),
  });
}

/** 메시지 단건 상세 쿼리 정의 — useMailMessage·useMailMessageSubject 가 같은 캐시를 쓰도록 한 곳에 둔다. */
const mailMessageQuery = (messageId: number | null) =>
  queryOptions({
    queryKey: mailMessageKeys.detail(messageId ?? 0),
    queryFn: () => getMessage(messageId as number),
    enabled: !!messageId,
  });

const selectSubject = (d: EmailMessageDetail) => d.subject;

/** 메시지 제목만 구독 — 모바일 상세 헤더 제목용. 상세와 같은 쿼리를 공유해 추가 요청이 없다. */
export function useMailMessageSubject(messageId: number | null) {
  return useQuery({ ...mailMessageQuery(messageId), select: selectSubject });
}

const selectSeen = (d: EmailMessageDetail) => d.seen;

/** WP-214 메시지 읽음 여부만 구독 — 목록에 없는 메일(딥링크)을 열 때 첫 열람 읽음 처리 판정용. 상세와 같은 쿼리를 공유한다. */
export function useMailMessageSeen(messageId: number | null) {
  return useQuery({ ...mailMessageQuery(messageId), select: selectSeen });
}

/** 메시지 단건 상세. messageId 가 없으면 비활성. 조회는 읽음 처리하지 않는다(WP-214 — 첫 열람 읽음은 메일함 화면이 따로 보낸다). */
export function useMailMessage(messageId: number | null) {
  return useQuery(mailMessageQuery(messageId));
}

/**
 * useQueries combine — 모듈 스코프에 둬 렌더마다 새 함수가 생기지 않게 한다(결과는 구조 공유로 값이 같으면 참조 유지).
 */
function summarizeDataUriResults(rs: { data?: string; isPending: boolean; isError: boolean }[]) {
  return rs.map((r) => ({ data: r.data, pending: r.isPending, failed: r.isError }));
}

/**
 * 메일 HTML 의 인라인 이미지(cid:)를 data URI 로 치환한 HTML(WP-65). 본문 패널과 답장·전달 인용문 미리보기(WP-69)가 공유한다.
 * - 첨부별 개별 쿼리 — 한 이미지 실패가 다른 이미지 캐시를 오염시키지 않고, 실패분만 재시도한다.
 * - 모든 쿼리가 끝난 뒤 한 번에 치환 — 이미지마다 srcDoc 이 바뀌어 iframe 이 N번 다시 로드되는 것을 막는다.
 * - 치환 준비 중·실패한 참조는 원문(cid:) 유지 — 본문 렌더 자체를 막지 않는다.
 *
 * @param enabled false 면 조회하지 않고 원문을 돌려준다(예: text 본문을 보여 iframe 이 없을 때)
 * @returns html: 치환된 HTML. inlinedIds: 본문에 표시되는(또는 표시 준비 중인) 첨부 id — 조회에 실패한 첨부는 빠진다.
 *   첨부 목록 숨김(WP-70)은 이 값을 써야 실패한 이미지가 본문·목록 어디에서도 안 보이는 일이 없다.
 */
export function useInlineMailHtml(
  html: string | null,
  attachments: EmailAttachmentMeta[] | undefined,
  enabled = true,
): { html: string | null; inlinedIds: ReadonlySet<number> } {
  const targets = useMemo(
    () => (html && attachments && enabled ? resolveCidTargets(html, attachments) : []),
    [html, attachments, enabled],
  );

  // combine 결과는 replaceEqualDeep 으로 구조 공유 — 값이 같으면 참조 유지돼 memo 의존성으로 바로 쓸 수 있다.
  const results = useQueries({
    queries: targets.map(({ att }) => ({
      queryKey: ['mail-attachment-data-uri', att.id] as const,
      queryFn: () => fetchMailAttachmentDataUri(att.id, att.contentType as string),
      staleTime: Infinity,
      // 렌더된 iframe 이 결과를 이미 들고 있으므로 base64 캐시는 짧게만 보관(대용량 이미지 메모리 점유 방지)
      gcTime: 30_000,
      // 전부 settle 해야 치환하므로 긴 재시도 백오프가 다른 이미지 표시까지 늦추지 않게 1회만
      retry: 1,
    })),
    combine: summarizeDataUriResults,
  });

  const inlinedIds = useMemo(
    () => new Set(targets.filter((_, i) => !results[i]?.failed).map((t) => t.att.id)),
    [targets, results],
  );

  const resolvedHtml = useMemo(() => {
    // 전부 settle 전에는 원문 유지 — 치환을 한 번에 적용
    if (!html || results.some((r) => r.pending)) return html;
    const urls = new Map<string, string>();
    targets.forEach((t, i) => {
      const uri = results[i]?.data;
      if (uri) urls.set(t.cid, uri);
    });
    return replaceCidRefs(html, urls);
  }, [html, targets, results]);

  return { html: resolvedHtml, inlinedIds };
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

/**
 * WP-149 요약 생략 메일의 "AI 요약" 버튼 — 누를 때만 강제 생성한다. 결과로 요약 캐시를 바로 덮어쓴다
 * (useMailSummary 는 staleTime Infinity 라 무효화해도 다시 불리지 않는다).
 */
export function useGenerateMailSummary() {
  const qc = useQueryClient();
  return useMutation({
    // 메일 id 를 변수로 받는다 — 생성 중에 다른 메일을 열어도 결과가 요청한 메일의 캐시에만 들어가게(클로저 캡처 금지)
    mutationFn: (messageId: number) => generateMailSummary(messageId),
    onSuccess: (data, messageId) => {
      qc.setQueryData(mailMessageKeys.summary(messageId), data);
    },
    onError: (e) => handleApiError(e, 'AI 요약에 실패했습니다'),
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
    // 성공이든 실패든 연결 이슈 배지를 다시 불러온다 — #859 이미 이 메일로 만든 이슈가 있으면 서버가 409 로 거절하므로 그 이슈를 드러낸다.
    onSettled: (_d, _e, v) =>
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
