// 메일 계정 공급자 표시 라벨 — MailAccountsSection 의 순수 규칙(WP-412 에서 컴포넌트 밖으로 분리).
import type { MailAccountResponse } from '@/types/mailAccount'

/** 공급자 라벨 — M365_GRAPH 는 'Outlook (Microsoft 365)'(#499), IMAP 은 접속 호스트(없으면 'IMAP'). */
export function mailAccountProviderLabel(acc: Pick<MailAccountResponse, 'provider' | 'imapHost'>): string {
  if (acc.provider === 'M365_GRAPH') return 'Outlook (Microsoft 365)'
  return acc.imapHost || 'IMAP'
}
