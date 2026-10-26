// 메일 목록 이어 보기(WP-965) — 목록을 끝까지 내리면 로컬 메일을 다음 페이지로 잇고, 로컬이 바닥나면 받은편지함·보낸편지함은 서버에서 이전 메일을 더 가져온다.
// 페이지 커서·캐시 모양(배열 ↔ 페이지 묶음)·서버 가져오기 대상 판정을 화면·쿼리 훅과 떼어 둔 순수 로직.
import type { InfiniteData } from '@tanstack/react-query'

import type { EmailMessageSummary, MailFolder, MailListCursor } from '@/types/mailMessage'

import type { MailView } from './mailView'

/** 목록 한 페이지 크기 — 서버 기본 건수(MailMessageService.DEFAULT_LIMIT)와 같게 둔다. */
export const MAIL_PAGE_SIZE = 50

/** 다음 페이지 커서 — 마지막 페이지가 꽉 찼으면 그 마지막 행, 덜 찼으면 로컬 끝(undefined). */
export function nextMailCursor(lastPage: readonly EmailMessageSummary[]): MailListCursor | undefined {
  if (lastPage.length < MAIL_PAGE_SIZE) return undefined
  const last = lastPage[lastPage.length - 1]
  return { receivedAt: last.receivedAt, id: last.id }
}

/** 메일 목록 캐시 한 칸 — 페이지로 받는 목록(useMailMessages)과 최신 N건만 받는 배열(useMailMessagesHead)이 같은 키 prefix 를 쓴다. */
export type MailListCache = EmailMessageSummary[] | InfiniteData<EmailMessageSummary[], MailListCursor | null>

/** 캐시 모양과 무관하게 각 행을 바꾼다(읽음 낙관 갱신). 데이터가 없으면 그대로 undefined. */
export function mapMailListCache(
  old: MailListCache | undefined,
  fn: (m: EmailMessageSummary) => EmailMessageSummary,
): MailListCache | undefined {
  if (!old) return old
  if (Array.isArray(old)) return old.map(fn)
  return { ...old, pages: old.pages.map((p) => p.map(fn)) }
}

/**
 * 로컬이 바닥났을 때 서버에서 이전 메일을 더 가져올 폴더. 받은편지함 전체·업무 보기(옛 메일은 미분류라 업무에 보인다)와 보낸편지함만 —
 * 검색·안 읽은 메일만·다른 분류·회신필요·서버 메일함 보기는 가져온 메일이 그 보기에 안 보일 수 있어 가져오지 않는다(끝이 계속 보여 끝없이 받게 된다).
 */
export function serverOlderFolder(view: MailView, search: string): MailFolder | null {
  if (search.trim() || view.unreadOnly) return null
  if (view.kind === 'sent') return 'SENT'
  if (view.kind === 'all' || view.kind === 'work') return 'INBOX'
  return null
}
