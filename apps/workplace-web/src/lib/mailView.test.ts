import { describe, expect, it } from 'vitest'

import type { MailServerFolder } from '@/types/mailFolder'
import type { MailUnreadCounts } from '@/types/mailMessage'

import { mailViewHref, resolveMailView, unreadCountForView } from './mailView'

const p = (q: string) => new URLSearchParams(q)
/** 서버 메일함 한 개(기본: 열 수 있는 USER 최상위). */
const mailServerFolder = (o: Partial<MailServerFolder> & { id: number }): MailServerFolder => ({
  displayName: `메일함${o.id}`, parentId: null, role: 'USER', selectable: true, unreadCount: 0, totalCount: 0,
  syncedSince: null, folderSyncedAt: null, ...o,
})

describe('resolveMailView', () => {
  it('기본 = 업무(API 에 업무 전달)', () => {
    const v = resolveMailView(p(''), true)
    expect(v).toMatchObject({ kind: 'work', apiCategory: '업무', activeCategory: '업무', title: '업무', breadcrumb: ['받은편지함', '업무'], unreadToggleVisible: true })
  })
  it('?category=업무 도 같은 보기(옛 링크 호환)', () => {
    expect(resolveMailView(p('category=업무'), true).kind).toBe('work')
  })
  it('?category=all = 전체(API category 없음)', () => {
    expect(resolveMailView(p('category=all'), true)).toMatchObject({ kind: 'all', apiCategory: '', activeCategory: null, title: '받은편지함', breadcrumb: ['받은편지함'] })
  })
  it('개별 분류', () => {
    expect(resolveMailView(p('category=개인'), true)).toMatchObject({ kind: 'category', apiCategory: '개인', activeCategory: '개인', title: '개인' })
  })
  it('허용 밖 category 는 기본(업무)', () => {
    expect(resolveMailView(p('category=스팸'), true).kind).toBe('work')
  })
  it('AI 분류 꺼짐: 기본·옛 업무 링크·개별 분류 모두 전체', () => {
    for (const q of ['', 'category=업무', 'category=개인']) {
      expect(resolveMailView(p(q), false)).toMatchObject({ kind: 'all', apiCategory: '', activeCategory: null })
    }
  })
  it('딥링크 ?messageId(category 없음) = 전체 — 분류와 무관하게 목록에 보이게', () => {
    expect(resolveMailView(p('messageId=55'), true)).toMatchObject({ kind: 'all', apiCategory: '', activeCategory: null, title: '받은편지함' })
  })
  it('앱 안 행 열기(열림 마크)로 붙은 messageId 는 딥링크가 아니다 — 업무 보기 유지(WP-218)', () => {
    expect(resolveMailView(p('messageId=55'), true, { inAppSelection: true }).kind).toBe('work')
    expect(resolveMailView(p('messageId=55&category=all'), true, { inAppSelection: true }).kind).toBe('all')
  })
  it('messageId 가 있어도 명시 category·needsReply·sent 는 그대로', () => {
    expect(resolveMailView(p('messageId=55&category=개인'), true).kind).toBe('category')
    expect(resolveMailView(p('messageId=55&category=업무'), true).kind).toBe('work')
    expect(resolveMailView(p('messageId=55&needsReply=true'), true).kind).toBe('needsReply')
    expect(resolveMailView(p('messageId=55&folder=sent'), true).kind).toBe('sent')
  })
  it('회신필요 — 토글 숨김·unreadOnly 무시', () => {
    expect(resolveMailView(p('needsReply=true&unread=true'), true)).toMatchObject({ kind: 'needsReply', unreadOnly: false, unreadToggleVisible: false, title: '회신필요' })
  })
  it('보낸편지함 — 분류·토글 없음', () => {
    expect(resolveMailView(p('folder=sent&category=개인&unread=true'), true)).toMatchObject({ kind: 'sent', apiCategory: '', unreadOnly: false, unreadToggleVisible: false, title: '보낸편지함' })
  })
  // WP-577 임시보관함 — 앱 서버 임시저장 목록. 분류·안 읽음 토글이 없고, 다른 보기와 key 가 겹치지 않는다.
  it('임시보관함 — 분류·토글 없음, 제목 임시보관함', () => {
    expect(resolveMailView(p('folder=drafts&category=개인&unread=true'), true)).toMatchObject({
      kind: 'drafts', apiCategory: '', activeCategory: null, unreadOnly: false, unreadToggleVisible: false, title: '임시보관함', breadcrumb: ['임시보관함'], key: 'drafts',
    })
    expect(resolveMailView(p('folder=drafts&messageId=55'), true).kind).toBe('drafts')
  })
  it('unread=true 는 key 를 바꾼다', () => {
    expect(resolveMailView(p('unread=true'), true).key).not.toBe(resolveMailView(p(''), true).key)
  })
})

describe('mailViewHref', () => {
  it('업무는 쿼리 없음, 전체는 all, 토글 유지', () => {
    expect(mailViewHref(3, 'work', false)).toBe('/mail/3')
    expect(mailViewHref(3, 'all', true)).toBe('/mail/3?category=all&unread=true')
    expect(mailViewHref(3, '개인', false)).toBe('/mail/3?category=%EA%B0%9C%EC%9D%B8')
  })
})

describe('unreadCountForView', () => {
  const counts = {
    classificationActive: true,
    inbox: 40,
    byCategory: { 업무: 7, 개인: 3, 알림: 2, 프로모션: 1, 뉴스레터: 5 },
    needsReply: 4,
  } satisfies MailUnreadCounts
  const view = (q: string) => resolveMailView(p(q), true)

  it('work = 업무 버킷', () => expect(unreadCountForView(view(''), counts)).toBe(7))
  it('all = 받은편지함 전체', () => expect(unreadCountForView(view('category=all'), counts)).toBe(40))
  it('category = 해당 분류', () => expect(unreadCountForView(view('category=개인'), counts)).toBe(3))
  it('needsReply = 회신필요 수', () => expect(unreadCountForView(view('needsReply=true'), counts)).toBe(4))
  it('sent = 0', () => expect(unreadCountForView(view('folder=sent'), counts)).toBe(0))
  it('drafts = 0', () => expect(unreadCountForView(view('folder=drafts'), counts)).toBe(0))
})

// WP-961 서버 메일함 보기(?box=<id>) — 보관·내 메일함.
describe('서버 메일함 보기', () => {
  const folders: MailServerFolder[] = [
    mailServerFolder({ id: 1, displayName: 'Archive', role: 'ARCHIVE', unreadCount: 2 }),
    mailServerFolder({ id: 5, displayName: '프로젝트', unreadCount: 0 }),
    mailServerFolder({ id: 6, displayName: '견적', parentId: 5, unreadCount: null }),
  ]
  it('?box=6 = folder 보기 — 분류·회신필요 없음, 토글 보임, 경로 breadcrumb', () => {
    expect(resolveMailView(p('box=6&category=개인&needsReply=true'), true, { folders })).toMatchObject({
      kind: 'folder', folderId: 6, apiCategory: '', activeCategory: null, unreadToggleVisible: true,
      title: '견적', breadcrumb: ['내 메일함', '프로젝트', '견적'],
    })
  })
  it('보관은 서버 이름과 무관하게 「보관」', () => {
    expect(resolveMailView(p('box=1'), true, { folders })).toMatchObject({ kind: 'folder', title: '보관', breadcrumb: ['보관'] })
  })
  it('목록 로딩 전 — 자리표시 제목, key 는 목록과 무관(id 기반)', () => {
    const before = resolveMailView(p('box=6'), true)
    expect(before).toMatchObject({ kind: 'folder', folderId: 6, title: '메일함' })
    expect(before.key).toBe(resolveMailView(p('box=6'), true, { folders }).key)
    expect(before.key).not.toBe(resolveMailView(p('box=5'), true).key)
    expect(resolveMailView(p('box=6&unread=true'), true)).toMatchObject({ unreadOnly: true, key: 'folder:6:true' })
  })
  it('딥링크 messageId 가 있어도 메일함 보기 유지, 분류 꺼짐과 무관', () => {
    expect(resolveMailView(p('box=6&messageId=9'), true).kind).toBe('folder')
    expect(resolveMailView(p('box=6'), false).kind).toBe('folder')
  })
  it('잘못된 box 값은 무시(기본 보기)', () => {
    for (const q of ['box=abc', 'box=0', 'box=-1', 'box=1.5']) expect(resolveMailView(p(q), true).kind).toBe('work')
  })
  it('folder=sent 가 box 보다 앞선다', () => {
    expect(resolveMailView(p('folder=sent&box=6'), true).kind).toBe('sent')
  })
  it('다른 보기는 folderId null', () => {
    for (const q of ['', 'category=all', 'needsReply=true', 'folder=sent', 'folder=drafts']) {
      expect(resolveMailView(p(q), true).folderId).toBeNull()
    }
  })
  it('mailViewHref — ?box, 토글 유지', () => {
    expect(mailViewHref(3, { folderId: 6 }, false)).toBe('/mail/3?box=6')
    expect(mailViewHref(3, { folderId: 6 }, true)).toBe('/mail/3?box=6&unread=true')
  })
  it('unreadCountForView — 그 메일함 안 읽은 수, 모르면 null(0 아님)', () => {
    const counts: MailUnreadCounts = { classificationActive: true, inbox: 9, byCategory: { 업무: 1, 개인: 0, 알림: 0, 프로모션: 0, 뉴스레터: 0 }, needsReply: 0 }
    expect(unreadCountForView(resolveMailView(p('box=1'), true), counts, folders)).toBe(2)
    expect(unreadCountForView(resolveMailView(p('box=5'), true), counts, folders)).toBe(0)
    expect(unreadCountForView(resolveMailView(p('box=6'), true), counts, folders)).toBeNull()
    expect(unreadCountForView(resolveMailView(p('box=1'), true), counts)).toBeNull()
  })
})
