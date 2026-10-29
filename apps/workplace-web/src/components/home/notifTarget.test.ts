// notifTarget 규칙 — 이슈 챗 알림(WP-452)은 챗 드로워(?chat=1)로, 그 외 이슈 알림은 이슈 상세로.
import { describe, expect, it } from 'vitest'

import type { NotificationResponse } from '@/types/notification'

import { isMentionLike, isPersonalAssistantRevokedType, isWikiShareType, notifLabel, notifTarget } from './notifTarget'

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
    // AI 검토 요청·실패(WP-913)는 결과를 볼 이슈 상세로 — 챗 드로워를 열지 않는다.
    expect(notifTarget(notif({ type: 'AI_REVIEW_REQUESTED', agentWorkState: 'REVIEW' }))).toBe('/projects/WP/issues/452')
    expect(notifTarget(notif({ type: 'AI_WORK_FAILED', agentWorkState: 'FAILED' }))).toBe('/projects/WP/issues/452')
  })

  it('AI 질문은 상태(권한 필요·막힘)가 있어도 챗 드로워로 연다 (WP-913)', () => {
    expect(notifTarget(notif({ type: 'AI_QUESTION', agentWorkState: 'AUTH_REQUIRED' }))).toBe('/projects/WP/issues/452?chat=1')
    expect(notifTarget(notif({ type: 'AI_QUESTION', agentWorkState: 'BLOCKED' }))).toBe('/projects/WP/issues/452?chat=1')
  })
})

describe('isMentionLike', () => {
  it('이슈 챗 질문·멘션과 코멘트 멘션은 나를 호출한 알림', () => {
    expect(isMentionLike(notif({ type: 'AI_QUESTION' }))).toBe(true)
    expect(isMentionLike(notif({ type: 'ISSUE_CHAT_MENTION' }))).toBe(true)
    expect(isMentionLike(notif({ type: 'ISSUE_COMMENT_MENTION' }))).toBe(true)
    // 멘션 없는 일반 댓글(담당·구독 이슈 공통 알림)은 나를 호출한 알림이 아니다(WP-1092).
    expect(isMentionLike(notif({ type: 'COMMENTED' }))).toBe(false)
    expect(isMentionLike(notif({ type: 'STATUS_CHANGED' }))).toBe(false)
    // AI 검토 요청·실패(WP-913)는 나를 호출한 알림이 아니다(멘션 카운트에 넣지 않음).
    expect(isMentionLike(notif({ type: 'AI_REVIEW_REQUESTED' }))).toBe(false)
    expect(isMentionLike(notif({ type: 'AI_WORK_FAILED' }))).toBe(false)
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

// WP-1170 — 내 개인 비서 연결 해제는 이슈·일정·노트 id 없이 온다. 다시 연결할 내 비서 설정으로 연다.
describe('개인 비서 연결 해제 알림', () => {
  const revoked = (over: Partial<NotificationResponse> = {}) =>
    notif({ type: 'PERSONAL_ASSISTANT_REVOKED', projectKey: '', issueNumber: 0, issueTitle: '', ...over })

  it('행위자 유무와 관계없이 /settings/assistant 로 연다', () => {
    expect(notifTarget(revoked())).toBe('/settings/assistant')
    expect(notifTarget(revoked({ actorId: null, actorName: null, actorKind: null }))).toBe('/settings/assistant')
  })

  it('이슈 키가 남아 있어도 이슈 상세로 새지 않는다, 제목 라벨은 「개인 비서」', () => {
    expect(notifTarget(revoked({ projectKey: 'WP', issueNumber: 3 }))).toBe('/settings/assistant')
    expect(notifLabel(revoked())).toBe('개인 비서')
    expect(isPersonalAssistantRevokedType(revoked())).toBe(true)
    expect(isPersonalAssistantRevokedType(notif({ type: 'WIKI_SHARE_ACCESS_APPROVED' }))).toBe(false)
  })
})
