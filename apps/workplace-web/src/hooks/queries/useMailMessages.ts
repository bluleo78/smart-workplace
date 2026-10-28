// 받은편지함/보낸편지함 목록·상세 조회 + 동기화·발송 mutation.

import { type InfiniteData, type QueryClient, queryOptions, useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useMemo } from 'react';
import { toast } from 'sonner';

import { coachDraft, fetchMailAttachmentDataUri, fetchOlderMail, generateIssueDraft, generateMailSummary, generateReplyDraft, getLinkedIssue, getMailSummary, getMessage, getSyncStatus, getUnreadCounts, getUnreadSummary, listMailFolders, listMessages, type MailViewScope, markAllRead, markMessageRead, markMessageUnread, promoteMailToIssue, respondToInvite, sendMail, syncMailbox, syncMailFolder } from '../../api/mailMessages';
import { handleApiError } from '../../lib/api-error';
import { replaceCidRefs, resolveCidTargets } from '../../lib/mailInlineImages';
import { MAIL_PAGE_SIZE, type MailListCache, mapMailListCache, nextMailCursor } from '../../lib/mailListPages';
import type { CalendarInvite, DraftCoachingRequest, EmailAttachmentMeta, EmailMessageDetail, EmailMessageSummary, InviteResponseRequest, MailFolder, MailListCursor, MailOlderResult, MailSendRequest, PromoteToIssuePayload } from '../../types/mailMessage';
import { calendarKeys } from './calendarKeys';
import { invalidateMailDrafts } from './mailDraftKeys';
import { mailMessageKeys } from './mailMessageKeys';

export { mailMessageKeys };

/**
 * 읽음 상태가 바뀌어 "안 읽은 수"가 달라졌을 때의 공통 무효화 — 사이드바 안 읽은 수(계정 무관 prefix)·탭 배지 합계·홈 메일 요약.
 * 홈 요약은 exact: true — 메시지별 AI 요약 ['mail-summary', id] 의 불필요한 재생성을 막는다(useSyncMailbox 와 동일).
 */
function invalidateMailCounts(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: mailMessageKeys.unreadCountsAll() });
  qc.invalidateQueries({ queryKey: mailMessageKeys.unreadSummary() });
  qc.invalidateQueries({ queryKey: ['mail-summary'], exact: true });
}

/**
 * 계정의 메시지 목록(폴더·검색어·unread·category·needsReply 필터). accountId 가 없으면 비활성.
 * options.folderId(WP-961) — 서버 메일함(보관·내 메일함) 보기. 있으면 서버가 folder·분류·회신필요를 무시한다.
 * WP-965: {@link MAIL_PAGE_SIZE}통씩 페이지로 받는다 — 끝까지 내리면 fetchNextPage 로 다음 페이지를 잇는다(커서 = 앞 페이지 마지막 행).
 * data 는 페이지를 이어 붙인 배열이라 쓰는 쪽은 예전처럼 한 목록으로 본다. 주기 재조회는 받은 페이지를 모두 차례로 다시 받으며 커서를 새로 잡는다.
 */
export function useMailMessages(
  accountId: number | undefined,
  folder: MailFolder,
  query: string,
  unread = false,
  category = '',
  needsReply = false,
  options?: { enabled?: boolean; folderId?: number | null },
) {
  const folderId = options?.folderId ?? null;
  return useInfiniteQuery({
    queryKey: mailMessageKeys.list(accountId ?? 0, folder, query, unread, category, needsReply, folderId),
    queryFn: ({ pageParam }) =>
      listMessages(accountId as number, folder, query || undefined, unread,
                   category || undefined, needsReply, MAIL_PAGE_SIZE, folderId, pageParam),
    initialPageParam: null as MailListCursor | null,
    getNextPageParam: (lastPage) => nextMailCursor(lastPage),
    select: selectFlatPages,
    enabled: (options?.enabled ?? true) && !!accountId,
    // 백그라운드 자동 동기화로 들어온 새 메일을 주기 반영. 재조회는 받은 페이지를 모두 차례로 다시 받으므로 깊이 내린 목록은 주기 재조회를 멈춘다 —
    // 새 메일은 SSE(mail 변경 알림)·포커스 재조회가 목록을 다시 받게 한다.
    refetchInterval: (q) => ((q.state.data?.pages.length ?? 0) > POLL_MAX_PAGES ? false : 60_000),
    refetchOnWindowFocus: true,
  });
}

/** 페이지를 이어 붙인 목록 — 모듈 수준이라 참조가 고정돼 데이터가 같으면 TanStack 이 select 를 다시 돌리지 않는다(selectSeen 과 같은 까닭). */
function selectFlatPages(data: InfiniteData<EmailMessageSummary[], MailListCursor | null>): EmailMessageSummary[] {
  return data.pages.flat();
}

/** 60초 주기 재조회를 하는 최대 페이지 수 — 넘게 내린 목록은 주기 재조회를 멈춘다(재조회 한 번에 페이지 수만큼 요청이 나간다). */
const POLL_MAX_PAGES = 3;

/** 이미 가져오는 중(running)일 때 다시 부르기 전 기다리는 시간 — 그사이 목록 끝 표시는 「가져오는 중」으로 남는다. */
const OLDER_RUNNING_WAIT_MS = 3_000;

/**
 * WP-965 받은편지함·보낸편지함 이전 메일 더 가져오기 — 목록을 끝까지 내려 로컬이 바닥났을 때 부른다.
 * 새로 넣은 메일이 있으면 그 계정 목록을 다시 받은 뒤에 끝난다 — 끝난 직후 목록 끝이 아직 보여도 옛 목록으로 한 번 더 부르지 않게.
 * 같은 폴더를 이미 가져오는 중이거나 아직 가져올 수 없으면(running — 첫 동기화 전 등) 잠시 기다렸다 끝나 화면이 곧바로 다시 부르지 않게 한다.
 * 실패는 화면이 목록 끝에 「다시 시도」로 보인다(토스트 없음).
 */
export function useFetchOlderMail(accountId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (folder: MailFolder) => {
      const refreshList = () => qc.invalidateQueries({ queryKey: ['mail-messages', accountId] });
      let result: MailOlderResult;
      try {
        result = await fetchOlderMail(accountId as number, folder);
      } catch (e) {
        // 실패해도 서버가 그 전에 받은 메일이 있을 수 있다(더 있는지 확인만 실패) — 목록을 다시 받아 보이게 한다.
        await refreshList();
        throw e;
      }
      if (result.running) {
        await new Promise((resolve) => setTimeout(resolve, OLDER_RUNNING_WAIT_MS));
      } else if (result.saved > 0) {
        await refreshList();
      }
      return result;
    },
  });
}

/**
 * 메시지 목록의 최신 N건만(WP-160) — 모바일 홈 메일 목록 타일 요약 한 줄(최신 1건)처럼 목록 전체가 필요 없는 곳용.
 * 키는 같은 필터의 전체 목록 키 끝에 { limit } 을 붙인다 — 'mail-messages' prefix 무효화·읽음 낙관 갱신
 * (setQueriesData, 같은 배열 모양)이 그대로 닿고, 전체 목록 캐시와는 섞이지 않는다.
 */
export function useMailMessagesHead(
  accountId: number | undefined,
  folder: MailFolder,
  query: string,
  unread: boolean,
  limit: number,
) {
  return useQuery({
    queryKey: [...mailMessageKeys.list(accountId ?? 0, folder, query, unread, '', false), { limit }] as const,
    queryFn: () => listMessages(accountId as number, folder, query || undefined, unread, undefined, false, limit),
    enabled: !!accountId,
    // 전체 목록(useMailMessages)과 같은 주기 반영.
    refetchInterval: 60_000,
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

/**
 * WP-961 서버 메일함(보관·내 메일함) 목록 + 메일함별 안 읽은 수. accountId 없으면 비활성.
 * 키가 안 읽은 수 키 아래라 안 읽은 수 무효화(읽음 전환·모두 읽음·SSE)에 함께 갱신된다(mailMessageKeys.folders).
 */
export function useMailFolders(accountId: number | undefined) {
  return useQuery({
    queryKey: mailMessageKeys.folders(accountId ?? 0),
    queryFn: () => listMailFolders(accountId as number),
    enabled: !!accountId,
    refetchInterval: 60_000,
  });
}

/**
 * WP-961 서버 메일함 한 개 가져오기 — 메일함을 열 때·새로 고침(older=false), 더 가져오기(older=true).
 * 끝나면 그 계정 목록·메일함 목록(가져온 시각·안 읽은 수)을 다시 받는다. 같은 메일함을 이미 가져오는 중(running)이면
 * 서버가 바로 돌아오므로 잠시 뒤 한 번 더 다시 받아 진행 중이던 결과를 반영한다. 실패는 토스트.
 */
export function useSyncMailFolder(accountId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ folderId, older }: { folderId: number; older: boolean }) =>
      syncMailFolder(accountId as number, folderId, older),
    onSuccess: (result) => {
      const refresh = () => {
        qc.invalidateQueries({ queryKey: ['mail-messages', accountId] });
        qc.invalidateQueries({ queryKey: mailMessageKeys.folders(accountId ?? 0) });
      };
      refresh();
      if (result.running) setTimeout(refresh, FOLDER_SYNC_RETRY_MS);
    },
    onError: (e) => handleApiError(e, '메일함을 가져오지 못했어요'),
  });
}

/** 이미 가져오는 중(running)일 때 다시 읽기까지 기다리는 시간. */
const FOLDER_SYNC_RETRY_MS = 3_000;

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
 * WP-220: 데이터 없이 첫 조회 중인 목록은 취소하지 않는다 — 취소하면 데이터 없는 idle 로 되돌아가 다시 조회하지 않아
 * "받은 메일이 없습니다"로 멈춘다. 전환 시작 때 목록 조회가 진행 중이었다면(취소한 재조회·읽음 처리 전 응답) 완료 뒤 목록을 다시 받는다
 * (refreshListsAfterToggle). 평소에는 낙관 갱신만으로 끝나 목록을 다시 받지 않는다.
 */
export function useToggleRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, seen }: { id: number; seen: boolean }) => (seen ? markMessageRead(id) : markMessageUnread(id)),
    onMutate: async ({ id, seen }) => {
      pendingToggles += 1;
      // 진행 중이던 목록 조회(취소할 재조회·첫 조회)가 있으면 완료 뒤 다시 받아야 한다.
      if (qc.isFetching({ queryKey: ['mail-messages'] }) > 0) listsNeedRefresh = true;
      await qc.cancelQueries({ queryKey: ['mail-messages'], predicate: (q) => q.state.data !== undefined });
      const snapshot = qc.getQueriesData<MailListCache>({ queryKey: ['mail-messages'] });
      // WP-965: 목록은 페이지 묶음, 최신 N건은 배열 — 두 모양 모두 바꾼다.
      qc.setQueriesData<MailListCache>({ queryKey: ['mail-messages'], exact: false }, (old) =>
        mapMailListCache(old, (m) => (m.id === id ? { ...m, seen } : m)),
      );
      return { snapshot };
    },
    onError: (e, _v, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      handleApiError(e, '읽음 상태를 바꾸지 못했어요');
    },
    onSettled: () => {
      pendingToggles -= 1;
      invalidateMailCounts(qc);
      void refreshListsAfterToggle(qc);
    },
  });
}

/**
 * 진행 중인 읽음 전환 수 — onMutate 에서 늘리고 onSettled 에서 줄인다(onMutate 가 실패해도 onSettled 는 불린다).
 * qc.isMutating 은 onSettled 안에선 자기 자신을 세지만, 진행 중 조회를 기다린 뒤의 재확인 시점엔 셀지가 타이밍에 달려 있어 직접 센다.
 */
let pendingToggles = 0;
/** 어떤 전환이 진행 중이던 목록 조회와 겹쳤다 — 마지막 전환이 끝난 뒤 목록을 다시 받아야 한다. */
let listsNeedRefresh = false;

/**
 * WP-220 읽음 전환 완료 뒤 목록 재조회. 동시에 여러 통을 전환하면 마지막 하나만 다시 받는다 —
 * 앞 전환의 재조회는 다음 전환의 cancelQueries 가 지워 버리므로, 진행 중 전환이 남아 있으면 그쪽 완료에 맡긴다.
 * 데이터 없는 목록은 invalidate 가 진행 중 조회를 끊지 않고 그 결과(읽음 처리 전 값)를 그대로 쓰므로,
 * 진행 중 조회가 끝나기(성공·실패 무관)를 기다린 뒤 다시 받는다.
 */
async function refreshListsAfterToggle(qc: QueryClient) {
  if (pendingToggles > 0 || !listsNeedRefresh) return;
  await Promise.allSettled(
    qc.getQueryCache().findAll({ queryKey: ['mail-messages'], fetchStatus: 'fetching' }).map((q) => q.promise),
  );
  // 기다리는 사이 새 전환이 시작됐으면 그 완료가 다시 받는다.
  if (pendingToggles > 0) return;
  listsNeedRefresh = false;
  await qc.invalidateQueries({ queryKey: ['mail-messages'] });
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

/** 메시지 단건 상세 쿼리 정의 — useMailMessage·useMailMessageSeen·임시저장 열기(인용문 원본)가 같은 캐시를 쓰도록 한 곳에 둔다. */
export const mailMessageQuery = (messageId: number | null) =>
  queryOptions({
    queryKey: mailMessageKeys.detail(messageId ?? 0),
    queryFn: () => getMessage(messageId as number),
    enabled: !!messageId,
  });

const selectSeen = (d: EmailMessageDetail) => d.seen;

/** WP-214 메시지 읽음 여부만 구독 — 첫 열람 읽음 처리 판정용. 상세와 같은 쿼리를 공유해 추가 요청이 없다. */
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
      // WP-961: 계정 동기화가 서버 메일함 목록(보관·내 메일함)도 새로 저장한다 — 사이드바 트리를 다시 받는다.
      qc.invalidateQueries({ queryKey: mailMessageKeys.folders(accountId ?? 0) });
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
export function useSendMail() {
  const qc = useQueryClient();
  return useMutation({
    // 계정은 요청마다 싣는다 — 보내는 동안 다른 계정의 작성으로 바뀌어도 보낸 계정의 목록·임시보관함을 다시 받게.
    mutationFn: ({ accountId, body }: { accountId: number; body: MailSendRequest }) => sendMail(accountId, body),
    onSuccess: (_r, { accountId, body }) => {
      qc.invalidateQueries({ queryKey: ['mail-messages', accountId, 'SENT'] });
      // 임시저장에서 보냈으면 서버가 그 임시저장을 지웠다 — 임시보관함 목록·개수를 다시 받는다(WP-577).
      if (body.draftId != null) void invalidateMailDrafts(qc, accountId);
      toast.success('메일을 보냈습니다');
    },
    // 실패 알림은 작성창이 정한다 — 보내는 동안 작성창을 닫았으면 「보내지 못해 임시보관함에 저장했어요」로 함께 알린다(WP-577).
  });
}

/**
 * WP-986 일정 초대 메일에 응답(수락·미정·거절).
 * 성공하면 돌려받은 초대 정보로 상세 캐시의 calendarInvite 를 바로 바꾸고(카드가 새 응답을 강조),
 * 서버가 내 캘린더 일정을 넣거나 고쳤으므로 캘린더 쿼리(목록·상세 전부)를 무효화한다. 실패는 토스트.
 */
export function useRespondToInvite(messageId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (response: InviteResponseRequest['response']) => respondToInvite(messageId, response),
    onSuccess: (invite: CalendarInvite) => {
      qc.setQueryData<EmailMessageDetail>(mailMessageKeys.detail(messageId), (old) =>
        old ? { ...old, calendarInvite: invite } : old,
      );
      qc.invalidateQueries({ queryKey: calendarKeys.all });
    },
    onError: (e) => {
      handleApiError(e, '초대에 응답하지 못했어요');
      // 409 = 그사이 취소·변경돼 응답할 수 없는 초대 — 카드를 다시 받아 버튼을 내리고 안내를 보인다(PR #962 리뷰).
      if (isAxiosError(e) && e.response?.status === 409) {
        qc.invalidateQueries({ queryKey: mailMessageKeys.detail(messageId) });
      }
    },
  });
}
