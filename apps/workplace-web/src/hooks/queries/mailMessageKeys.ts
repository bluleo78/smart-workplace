import type { MailFolder } from '../../types/mailMessage';

// 메일 메시지 TanStack Query 키 팩토리 — api 모듈을 import 하지 않는 순수 파일이라 lib/resourceInvalidation 에서도 쓸 수 있다.
// useMailMessages 가 그대로 re-export 한다(기존 import 경로 호환).
export const mailMessageKeys = {
  // #469: unread 필터를 캐시 키에 포함(읽음 목록과 안읽음 목록 캐시 분리).
  // P2: category/needsReply 필터도 캐시 키에 포함.
  list: (accountId: number, folder: MailFolder, query: string, unread = false,
         category = '', needsReply = false) =>
    ['mail-messages', accountId, folder, query, unread, category, needsReply] as const,
  detail: (messageId: number) => ['mail-message', messageId] as const,
  summary: (messageId: number) => ['mail-summary', messageId] as const,
  // WP-186: 사이드바 안 읽은 수(계정별)·탭 배지 합계.
  unreadCountsAll: () => ['mail-unread-counts'] as const,
  unreadCounts: (accountId: number) => ['mail-unread-counts', accountId] as const,
  unreadSummary: () => ['mail-unread-summary'] as const,
  syncStatus: (accountId: number) => ['mail-sync-status', accountId] as const,
};
