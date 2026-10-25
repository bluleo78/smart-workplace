import type { MailFolder } from '../../types/mailMessage';

// 메일 메시지 TanStack Query 키 팩토리 — api 모듈을 import 하지 않는 순수 파일이라 lib/resourceInvalidation 에서도 쓸 수 있다.
// useMailMessages 가 그대로 re-export 한다(기존 import 경로 호환).
export const mailMessageKeys = {
  // #469: unread 필터를 캐시 키에 포함(읽음 목록과 안읽음 목록 캐시 분리).
  // P2: category/needsReply 필터도 캐시 키에 포함.
  // WP-961: 서버 메일함 id 는 맨 뒤 — ['mail-messages', 계정]·['mail-messages', 계정, 'SENT'] prefix 무효화가 그대로 닿게.
  list: (accountId: number, folder: MailFolder, query: string, unread = false,
         category = '', needsReply = false, folderId: number | null = null) =>
    ['mail-messages', accountId, folder, query, unread, category, needsReply, folderId] as const,
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
};
