// notifTarget 규칙 — 이슈 챗 알림(WP-452)은 챗 드로워(?chat=1)로, 그 외 이슈 알림은 이슈 상세로.
import { describe, expect, it } from 'vitest'

import type { NotificationResponse } from '@/types/notification'

import {
  aiLimitWaitPath,
  isAiLimitWaitType,
  isMailSendFailedType,
  isMentionLike,
  isOAuthAppConnectedType,
  isPersonalAssistantRevokedType,
  isWikiShareType,
  notifLabel,
  notifTarget,
} from './notifTarget'

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
    // 워크플로우 되돌림 한도(WP-1985)도 이슈 상세로 — 챗 드로워 없이.
    expect(notifTarget(notif({ type: 'WORKFLOW_VISIT_LIMIT' }))).toBe('/projects/WP/issues/452')
    // 워크플로우 차례 타이머(WP-1987)도 이슈 상세로.
    expect(notifTarget(notif({ type: 'WORKFLOW_TURN_REMIND' }))).toBe('/projects/WP/issues/452')
    expect(notifTarget(notif({ type: 'WORKFLOW_TURN_ESCALATE' }))).toBe('/projects/WP/issues/452')
  })

  it('AI 질문은 상태(권한 필요·차단됨)가 있어도 챗 드로워로 연다 (WP-913)', () => {
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

// WP-1686 — 새 앱 연결은 행위자·이슈·일정·노트 없이 온다(앱 이름은 message). 끊을 수 있는 설정 › API 토큰으로 연다.
describe('새 앱 연결 알림', () => {
  const app = (over: Partial<NotificationResponse> = {}) =>
    notif({
      type: 'OAUTH_APP_CONNECTED',
      actorId: null,
      actorName: null,
      actorKind: null,
      projectKey: '',
      issueNumber: 0,
      issueTitle: '',
      message: 'Claude',
      ...over,
    })

  it('/settings/tokens#connected-apps 로 연다, 이슈 키가 남아 있어도 이슈 상세로 새지 않는다', () => {
    expect(notifTarget(app())).toBe('/settings/tokens#connected-apps')
    expect(notifTarget(app({ projectKey: 'WP', issueNumber: 3 }))).toBe('/settings/tokens#connected-apps')
  })

  it('제목 라벨은 「앱 연결」, 종류 판정은 이 종류만 true', () => {
    expect(notifLabel(app())).toBe('앱 연결')
    expect(isOAuthAppConnectedType(app())).toBe(true)
    expect(isOAuthAppConnectedType(notif({ type: 'PERSONAL_ASSISTANT_REVOKED' }))).toBe(false)
  })
})

// WP-1786 — 메일 보내기 실패: 그 임시보관을 메인 창의 쓰기 창으로 연다(/mail?draftId=N 을 MailDraftDeepLink 가 받는다).
describe('메일 보내기 실패 알림', () => {
  const failed = (over: Partial<NotificationResponse> = {}) =>
    notif({
      type: 'MAIL_SEND_FAILED',
      actorId: null,
      actorName: null,
      actorKind: null,
      projectKey: '',
      issueNumber: 0,
      issueTitle: '',
      message: '주간 보고',
      mailDraftId: 42,
      mailSendUnknown: false,
      ...over,
    })

  it('그 임시보관을 쓰기 창으로 여는 /mail?draftId=N 으로 간다, 이슈 키가 남아 있어도 이슈 상세로 새지 않는다', () => {
    expect(notifTarget(failed())).toBe('/mail?draftId=42')
    expect(notifTarget(failed({ projectKey: 'WP', issueNumber: 3 }))).toBe('/mail?draftId=42')
  })

  it('임시보관 id 가 없으면 메일 첫 화면으로 간다', () => {
    expect(notifTarget(failed({ mailDraftId: null }))).toBe('/mail')
  })

  it('제목 라벨은 메일 제목, 제목이 없으면 「(제목 없음)」', () => {
    expect(notifLabel(failed())).toBe('주간 보고')
    expect(notifLabel(failed({ message: null }))).toBe('(제목 없음)')
    expect(notifLabel(failed({ message: '' }))).toBe('(제목 없음)')
    expect(isMailSendFailedType(failed())).toBe(true)
    expect(isMailSendFailedType(notif({ type: 'OAUTH_APP_CONNECTED' }))).toBe(false)
  })
})

// WP-2108 — 비서 사용 한도 대기: 알림 행의 statusName(범위)·actorId(비서 AGENT)로 이동 경로를 확정한다. 이슈 키는 없다.
describe('AI 사용 한도 알림', () => {
  const limit = (over: Partial<NotificationResponse> = {}) =>
    notif({
      type: 'AI_ASSISTANT_LIMIT_WAIT',
      projectKey: '',
      issueNumber: 0,
      issueTitle: '',
      message: '개인 비서가 사용 한도에 걸렸어요',
      ...over,
    })

  it('개인 비서는 내 비서 설정으로 연다', () => {
    expect(notifTarget(limit({ statusName: 'PERSONAL_ASSISTANT', actorId: 7 }))).toBe('/settings/assistant')
  })

  it('공통 비서는 그 비서(AGENT) 상세로, 비서 id 가 없으면 에이전트 목록으로 연다', () => {
    expect(notifTarget(limit({ statusName: 'WORKSPACE_ASSISTANT', actorId: 42 }))).toBe('/settings/agents/42')
    expect(notifTarget(limit({ statusName: 'WORKSPACE_ASSISTANT', actorId: null }))).toBe('/settings/agents')
  })

  it('작업 AI 계정은 AI 계정 화면으로 연다', () => {
    expect(notifTarget(limit({ statusName: 'AGENT_ACCOUNT', actorId: null }))).toBe('/settings/agents/accounts')
  })

  it('범위를 모르면 내 비서 설정으로, 이슈 키가 남아 있어도 이슈 상세로 새지 않는다', () => {
    expect(notifTarget(limit({ statusName: null }))).toBe('/settings/assistant')
    expect(notifTarget(limit({ statusName: 'AGENT_ACCOUNT', projectKey: 'WP', issueNumber: 3 }))).toBe(
      '/settings/agents/accounts',
    )
    expect(aiLimitWaitPath(limit({ statusName: 'PERSONAL_ASSISTANT' }))).toBe('/settings/assistant')
  })

  it('제목 라벨은 「AI 사용 한도」, 종류 판정은 이 종류만 true', () => {
    expect(notifLabel(limit())).toBe('AI 사용 한도')
    expect(isAiLimitWaitType(limit())).toBe(true)
    expect(isAiLimitWaitType(notif({ type: 'PERSONAL_ASSISTANT_REVOKED' }))).toBe(false)
  })
})
