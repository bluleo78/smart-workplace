// 메일 임시저장(WP-577) TanStack Query 키 — api·컴포넌트를 import 하지 않는 순수 파일이라 발송 훅(useMailMessages)도 가볍게 쓴다.
import type { QueryClient } from '@tanstack/react-query';

/** 임시저장 쿼리 키 — 계정 단위 prefix 하나로 목록·개수를 함께 무효화한다. */
export const mailDraftKeys = {
  all: () => ['mail-drafts'] as const,
  account: (accountId: number) => ['mail-drafts', accountId] as const,
  list: (accountId: number) => ['mail-drafts', accountId, 'list'] as const,
  count: (accountId: number) => ['mail-drafts', accountId, 'count'] as const,
  detail: (id: number) => ['mail-draft', id] as const,
};

/** 임시보관함 목록·개수를 다시 받는다(저장·삭제·발송 뒤). 열려 있는 쿼리만 실제로 다시 요청된다. */
export function invalidateMailDrafts(qc: QueryClient, accountId: number) {
  return qc.invalidateQueries({ queryKey: mailDraftKeys.account(accountId) });
}
