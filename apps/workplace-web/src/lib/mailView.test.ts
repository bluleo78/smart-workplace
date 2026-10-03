import { describe, expect, it } from 'vitest'

import { mailViewHref, resolveMailView } from './mailView'

const p = (q: string) => new URLSearchParams(q)

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
  it('회신필요 — 토글 숨김·unreadOnly 무시', () => {
    expect(resolveMailView(p('needsReply=true&unread=true'), true)).toMatchObject({ kind: 'needsReply', unreadOnly: false, unreadToggleVisible: false, title: '회신필요' })
  })
  it('보낸편지함 — 분류·토글 없음', () => {
    expect(resolveMailView(p('folder=sent&category=개인&unread=true'), true)).toMatchObject({ kind: 'sent', apiCategory: '', unreadOnly: false, unreadToggleVisible: false, title: '보낸편지함' })
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
