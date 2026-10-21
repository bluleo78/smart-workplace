// notifTarget 규칙 — 이슈 챗 알림(WP-452)은 챗 드로워(?chat=1)로, 그 외 이슈 알림은 이슈 상세로.
import { describe, expect, it } from 'vitest'

import type { NotificationResponse } from '@/types/notification'

import { isMentionLike, isWikiShareType, notifLabel, notifTarget } from './notifTarget'

// 테스트용 알림 한 건 — 필요한 필드만 덮어쓴다.
function notif(over: Partial<NotificationResponse>): NotificationResponse {
  return {
    id: 1,
    type: 'COMMENTED',
    actorId: 2,
    actorName: 'AI 개발자',
    actorKind: 'AGENT',
    issueId: 1,
    projectKey: 'WP',
    issueNumber: 452,
    issueTitle: '알림',
    commentId: null,
    eventId: null,
    eventTitle: null,
    eventStartsAt: null,
    wikiPageId: null,
    wikiPageTitle: null,
    message: null,
    read: false,
    createdAt: '2026-10-18T00:00:00Z',
    ...over,
  }
}

describe('notifTarget', () => {
  it('이슈 챗 알림은 이슈 상세 + 챗 드로워로 연다', () => {
    expect(notifTarget(notif({ type: 'AI_QUESTION' }))).toBe('/projects/WP/issues/452?chat=1')
    expect(notifTarget(notif({ type: 'ISSUE_CHAT_MENTION' }))).toBe('/projects/WP/issues/452?chat=1')
  })

  it('그 외 이슈 알림은 이슈 상세 그대로', () => {
    expect(notifTarget(notif({ type: 'COMMENTED' }))).toBe('/projects/WP/issues/452')
    // 코멘트 멘션(WP-650)은 코멘트가 있는 이슈 상세로 — 챗 드로워를 열지 않는다.
    expect(notifTarget(notif({ type: 'ISSUE_COMMENT_MENTION' }))).toBe('/projects/WP/issues/452')
    expect(notifTarget(notif({ type: 'ASSIGNED' }))).toBe('/projects/WP/issues/452')
  })
})

describe('isMentionLike', () => {
  it('이슈 챗 질문·멘션과 코멘트는 나를 호출한 알림', () => {
    expect(isMentionLike(notif({ type: 'AI_QUESTION' }))).toBe(true)
    expect(isMentionLike(notif({ type: 'ISSUE_CHAT_MENTION' }))).toBe(true)
    expect(isMentionLike(notif({ type: 'COMMENTED' }))).toBe(true)
    expect(isMentionLike(notif({ type: 'ISSUE_COMMENT_MENTION' }))).toBe(true)
    expect(isMentionLike(notif({ type: 'STATUS_CHANGED' }))).toBe(false)
  })
})

// WP-579 노트 공유 알림 — 알림을 누르면 /wiki/open/{pageId} 가 멤버 여부에 따라 노트·공유 화면으로 보낸다.
describe('노트 공유 알림', () => {
  const wiki = (type: NotificationResponse['type']) =>
    notif({
      type,
      wikiPageId: 77,
      wikiPageTitle: '제품 로드맵',
    })

  it('공유받음·접근 승인은 /wiki/open/{pageId} 로 연다', () => {
    expect(notifTarget(wiki('WIKI_SHARED'))).toBe('/wiki/open/77')
    expect(notifTarget(wiki('WIKI_SHARE_ACCESS_APPROVED'))).toBe('/wiki/open/77')
  })

  it('접근 요청은 공유 창을 연 채로(?share=1) 연다', () => {
    expect(notifTarget(wiki('WIKI_SHARE_ACCESS_REQUESTED'))).toBe('/wiki/open/77?share=1')
  })

  it('페이지 식별 정보가 없으면 인박스 대용으로 폴백한다', () => {
    expect(notifTarget({ ...wiki('WIKI_SHARED'), wikiPageId: null })).toBe('/me/tasks/assigned')
  })

  it('isWikiShareType 은 세 유형만 참이고, 제목 라벨은 페이지 제목이다', () => {
    expect(isWikiShareType(wiki('WIKI_SHARED'))).toBe(true)
    expect(isWikiShareType(wiki('WIKI_SHARE_ACCESS_REQUESTED'))).toBe(true)
    expect(isWikiShareType(wiki('WIKI_SHARE_ACCESS_APPROVED'))).toBe(true)
    expect(isWikiShareType(notif({ type: 'COMMENTED' }))).toBe(false)
    expect(notifLabel(wiki('WIKI_SHARED'))).toBe('제품 로드맵')
    expect(isMentionLike(wiki('WIKI_SHARE_ACCESS_REQUESTED'))).toBe(false)
  })
})
