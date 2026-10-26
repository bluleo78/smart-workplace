import { describe, expect, it } from 'vitest'

import type { EmailMessageSummary } from '@/types/mailMessage'

import { MAIL_PAGE_SIZE, mapMailListCache, nextMailCursor, serverOlderFolder } from './mailListPages'
import { resolveMailView } from './mailView'

const row = (id: number, receivedAt: string | null = '2026-10-20T10:00:00.123456Z'): EmailMessageSummary => ({
  id, accountId: 1, threadId: `t${id}`, fromAddress: null, fromName: null, subject: `메일 ${id}`, snippet: null,
  receivedAt, seen: false, hasAttachment: false, aiCategory: null, aiNeedsReply: null, categoryPending: false,
})
const page = (n: number, from = 1) => Array.from({ length: n }, (_, i) => row(from + i))

describe('nextMailCursor', () => {
  it('마지막 페이지가 꽉 찼으면 그 마지막 행(서버 receivedAt 문자열 그대로)', () => {
    const p = page(MAIL_PAGE_SIZE)
    expect(nextMailCursor(p)).toEqual({ receivedAt: '2026-10-20T10:00:00.123456Z', id: MAIL_PAGE_SIZE })
  })
  it('덜 찼으면 로컬 끝', () => {
    expect(nextMailCursor(page(MAIL_PAGE_SIZE - 1))).toBeUndefined()
    expect(nextMailCursor([])).toBeUndefined()
  })
  it('수신 시각 없는 행이면 receivedAt 도 null', () => {
    const p = [...page(MAIL_PAGE_SIZE - 1), row(999, null)]
    expect(nextMailCursor(p)).toEqual({ receivedAt: null, id: 999 })
  })
})

describe('mapMailListCache', () => {
  const read = (m: EmailMessageSummary) => (m.id === 2 ? { ...m, seen: true } : m)
  it('배열(최신 N건 캐시)', () => {
    const out = mapMailListCache(page(3), read) as EmailMessageSummary[]
    expect(out.map((m) => m.seen)).toEqual([false, true, false])
  })
  it('페이지 묶음(이어 보기 캐시) — 모든 페이지, pageParams 는 그대로', () => {
    const old = { pages: [page(2), page(2, 3)], pageParams: [null, { receivedAt: null, id: 2 }] }
    const out = mapMailListCache(old, (m) => ({ ...m, seen: true }))
    expect(out).toEqual({ pages: [page(2).map((m) => ({ ...m, seen: true })), page(2, 3).map((m) => ({ ...m, seen: true }))], pageParams: old.pageParams })
  })
  it('데이터 없음은 그대로', () => {
    expect(mapMailListCache(undefined, read)).toBeUndefined()
  })
})

describe('serverOlderFolder', () => {
  const view = (q: string, classified = true) => resolveMailView(new URLSearchParams(q), classified)
  it('받은편지함 업무(기본)·전체는 INBOX, 보낸편지함은 SENT', () => {
    expect(serverOlderFolder(view(''), '')).toBe('INBOX')
    expect(serverOlderFolder(view('category=all'), '')).toBe('INBOX')
    expect(serverOlderFolder(view('', false), '')).toBe('INBOX')
    expect(serverOlderFolder(view('folder=sent'), '')).toBe('SENT')
  })
  it('검색·안 읽은 메일만·다른 분류·회신필요는 가져오지 않는다', () => {
    expect(serverOlderFolder(view(''), '견적')).toBeNull()
    expect(serverOlderFolder(view('folder=sent'), ' x ')).toBeNull()
    expect(serverOlderFolder(view('unread=true'), '')).toBeNull()
    expect(serverOlderFolder(view('category=개인'), '')).toBeNull()
    expect(serverOlderFolder(view('needsReply=true'), '')).toBeNull()
  })
})
