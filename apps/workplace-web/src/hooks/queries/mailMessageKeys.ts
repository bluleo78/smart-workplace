import type { MailFolder } from '../../types/mailMessage';

// 메일 메시지 TanStack Query 키 팩토리 — api 모듈을 import 하지 않는 순수 파일이라 lib/resourceInvalidation 에서도 쓸 수 있다.
// useMailMessages 가 그대로 re-export 한다(기존 import 경로 호환).
export const mailMessageKeys = {
  // #469: unread 필터를 캐시 키에 포함(읽음 목록과 안읽음 목록 캐시 분리).
  // P2: category/needsReply 필터도 캐시 키에 포함.
  // WP-961: 서버 메일함 id 는 맨 뒤 — ['mail-messages', 계정]·['mail-messages', 계정, 'SENT'] prefix 무효화가 그대로 닿게.
  // WP-1742: 별표 모아 보기 여부도 맨 뒤 — 별표 전환 뒤 별표 목록만 골라 다시 받을 때 이 자리(isFlaggedListKey)를 본다.
  list: (accountId: number, folder: MailFolder, query: string, unread = false,
         category = '', needsReply = false, folderId: number | null = null, flagged = false) =>
    ['mail-messages', accountId, folder, query, unread, category, needsReply, folderId, flagged] as const,
  detail: (messageId: number) => ['mail-message', messageId] as const,
  summary: (messageId: number) => ['mail-summary', messageId] as const,
  // WP-186: 사이드바 안 읽은 수(계정별)·탭 배지 합계.
  unreadCountsAll: () => ['mail-unread-counts'] as const,
  unreadCounts: (accountId: number) => ['mail-unread-counts', accountId] as const,
  // WP-961 서버 메일함(보관·내 메일함) 목록 — 안 읽은 수를 함께 싣는 목록이라 안 읽은 수 키 아래에 둔다.
  // 그래서 안 읽은 수를 무효화하는 모든 곳(읽음 전환·모두 읽음·SSE mail/mail-account)이 메일함 목록도 함께 다시 받는다.
  folders: (accountId: number) => ['mail-unread-counts', accountId, 'folders'] as const,
  unreadSummary: () => ['mail-unread-summary'] as const,
  syncStatus: (accountId: number) => ['mail-sync-status', accountId] as const,
  // WP-1682 휴지통 비우기 진행 상태(계정별, RUNNING 동안 1초 폴링).
  trashEmpty: (accountId: number) => ['mail-trash-empty', accountId] as const,
  // WP-1708 휴지통 메일 수(서버 실시간, 계정별) — 목록 캐시(['mail-messages']) 아래에 두면 읽음 전환의
  // setQueriesData(목록 모양 가정)가 숫자 데이터를 망가뜨리므로 목록과 분리된 접두사를 쓴다.
  trashCount: (accountId: number) => ['mail-trash-count', accountId] as const,
};

/** WP-1742 별표 모아 보기 목록 키인가 — list 키의 9번째(flagged)가 true. 최신 N건 키(useMailMessagesHead)는 늘 false 다. */
export function isFlaggedListKey(key: readonly unknown[]): boolean {
  return key[0] === 'mail-messages' && key[8] === true
}
