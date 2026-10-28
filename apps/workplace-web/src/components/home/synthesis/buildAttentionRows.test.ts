// buildAttentionRows(WP-412) — '지금 신경 쓸 일' 행 병합·정렬 규칙 단위 테스트.
// 홈 E2E 가 화면으로 확인하던 규칙(메일 제외/포함, 어텐션 대화 필터, 크로스앱 정렬, AI 점수 정렬·폴백)을 여기로 옮겼다.
import { describe, expect, it } from 'vitest'

import type { PriorityItem } from '@/api/priorityItems'
import type { IssueDueMarker } from '@/types/calendar'
import type { ConversationSummaryItem, MailSummaryItem } from '@/types/dashboard'
import type { NotificationResponse } from '@/types/notification'

import { type AttentionRowsInput, buildAttentionRows } from './buildAttentionRows'

const TODAY = '2026-06-16'

function due(over: Partial<IssueDueMarker>): IssueDueMarker {
  return { issueId: 1, projectKey: 'WP', number: 7, title: '이슈', dueDate: '2020-01-01', ...over }
}

function mention(over: Partial<NotificationResponse>): NotificationResponse {
  return {
    id: 1,
    type: 'ISSUE_COMMENT_MENTION',
    actorId: 3,
    actorName: '홍길동',
    actorKind: 'HUMAN',
    issueId: 2,
    projectKey: 'WP',
    issueNumber: 8,
    issueTitle: '멘션 이슈',
    commentId: 1,
    eventId: null,
    eventTitle: null,
    eventStartsAt: null,
    read: false,
    createdAt: '2026-06-16T00:00:00Z',
    ...over,
  }
}

function mail(over: Partial<MailSummaryItem>): MailSummaryItem {
  return {
    id: 100,
    accountId: 1,
    subject: '계약서 회신 요청',
    fromAddress: 'a@b.com',
    fromName: '거래처',
    snippet: null,
    receivedAt: '2026-06-16T00:00:00Z',
    seen: false,
    hasAttachment: false,
    aiCategory: 'ACTION',
    aiNeedsReply: true,
    ...over,
  }
}

function convo(over: Partial<ConversationSummaryItem>): ConversationSummaryItem {
  return {
    kind: 'CHANNEL',
    conversationId: 12,
    label: '#dev',
    lastAuthorName: '박서연',
    lastMessagePreview: '배포 여부 확인',
    lastMessageAt: '2026-06-16T00:05:00Z',
    unreadCount: 1,
    mentioned: false,
    needsReply: false,
    newThreadReplyCount: 0,
    aiReason: null,
    ...over,
  }
}

function score(sourceType: string, sourceId: string, total: number): PriorityItem {
  return { sourceType, sourceId, title: 't', deepLink: '/x', importanceScore: total, urgencyScore: 0, reason: 'r' }
}

function build(over: Partial<AttentionRowsInput>) {
  return buildAttentionRows({
    dues: [],
    notifications: [],
    mailRecent: [],
    messagingRecent: [],
    priorityItems: [],
    todayKey: TODAY,
    ...over,
  })
}

describe('buildAttentionRows — 마감 이슈', () => {
  it('지난 마감은 "마감 지남", 오늘 마감은 "오늘 마감", 미래 마감은 제외한다', () => {
    const rows = build({
      dues: [
        due({ issueId: 1, title: '지연', dueDate: '2020-01-01' }),
        due({ issueId: 2, title: '오늘', dueDate: TODAY }),
        due({ issueId: 3, title: '내일', dueDate: '2026-06-17' }),
      ],
    })
    expect(rows.map((r) => [r.title, r.meta])).toEqual([
      ['오늘', '오늘 마감'],
      ['지연', '마감 지남'],
    ])
    expect(rows[1]).toMatchObject({ to: '/projects/WP/issues/7', ariaLabel: '이슈 열기: 지연', source: '이슈' })
  })
})

describe('buildAttentionRows — 완료·취소 이슈 제외(WP-675)', () => {
  it('마감 지남·오늘 마감 행에 완료(DONE)·취소(CANCELED) 이슈는 넣지 않는다', () => {
    const rows = build({
      dues: [
        due({ issueId: 1, title: '오늘-TODO', dueDate: TODAY, status: 'TODO' }),
        due({ issueId: 2, title: '오늘-DONE', dueDate: TODAY, status: 'DONE' }),
        due({ issueId: 3, title: '오늘-CANCELED', dueDate: TODAY, status: 'CANCELED' }),
        due({ issueId: 4, title: '어제-DONE', dueDate: '2020-01-01', status: 'DONE' }),
        due({ issueId: 5, title: '어제-IN_PROGRESS', dueDate: '2020-01-01', status: 'IN_PROGRESS' }),
      ],
    })
    expect(rows.map((r) => r.title)).toEqual(['오늘-TODO', '어제-IN_PROGRESS'])
  })
})

describe('buildAttentionRows — 메일', () => {
  it('회신 필요(aiNeedsReply true·안읽음)만 진입하고 pending(null)·읽은 메일·일반 안읽음은 제외한다', () => {
    const rows = build({
      mailRecent: [
        mail({ id: 100, subject: '계약서 회신 요청' }),
        mail({ id: 101, subject: '뉴스레터', aiNeedsReply: null }),
        mail({ id: 102, subject: '읽음', seen: true }),
        mail({ id: 103, subject: '월간 보고서', aiNeedsReply: false }),
      ],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      title: '계약서 회신 요청',
      meta: '회신 필요',
      to: '/mail/1?messageId=100',
      ariaLabel: '메일 열기: 계약서 회신 요청',
    })
  })

  it('제목이 없으면 "(제목 없음)"으로 표시한다', () => {
    expect(build({ mailRecent: [mail({ subject: null })] })[0].title).toBe('(제목 없음)')
  })
})

describe('buildAttentionRows — 메시징', () => {
  it('어텐션 신호(멘션·회신·AI발굴·새 답글)가 없는 대화는 제외한다', () => {
    expect(build({ messagingRecent: [convo({ label: '#잡담' })] })).toEqual([])
  })

  it('meta 는 AI발굴 > 멘션 > 회신 > 새 답글 우선순위로 정한다', () => {
    const metaOf = (over: Partial<ConversationSummaryItem>) => build({ messagingRecent: [convo(over)] })[0].meta
    expect(metaOf({ aiReason: '질문', mentioned: true, needsReply: true })).toBe('확인 필요')
    expect(metaOf({ mentioned: true, needsReply: true })).toBe('멘션')
    expect(metaOf({ needsReply: true, newThreadReplyCount: 2 })).toBe('회신')
    expect(metaOf({ newThreadReplyCount: 2 })).toBe('새 답글 2')
  })

  it('채널은 /chat/channels, DM 은 /chat/dms 로 딥링크하고 AI 발굴이면 isAi', () => {
    const [ch] = build({ messagingRecent: [convo({ conversationId: 12, aiReason: '질문' })] })
    expect(ch).toMatchObject({ to: '/chat/channels/12', ariaLabel: '대화 열기: #dev', isAi: true })
    const [dm] = build({ messagingRecent: [convo({ kind: 'DM', conversationId: 7, label: '이대리', needsReply: true })] })
    expect(dm).toMatchObject({ to: '/chat/dms/7', ariaLabel: '대화 열기: 이대리', isAi: false })
  })
})

describe('buildAttentionRows — 멘션 묶음', () => {
  it('같은 이슈 멘션은 한 줄로 묶어 건수·시각을 붙이고, 단건은 "멘션" 만 쓴다', () => {
    const rows = build({
      notifications: [
        mention({ id: 1, issueId: 7, issueNumber: 7, issueTitle: 'A', createdAt: '2026-06-16T01:00:00Z' }),
        mention({ id: 2, issueId: 7, issueNumber: 7, issueTitle: 'A', createdAt: '2026-06-16T03:00:00Z' }),
        mention({ id: 4, issueId: 8, issueNumber: 8, issueTitle: 'B', createdAt: '2026-06-16T00:00:00Z' }),
      ],
    })
    expect(rows.map((r) => r.title)).toEqual(['A', 'B'])
    expect(rows[0].meta).toMatch(/^멘션 2 · /)
    expect(rows[0]).toMatchObject({ to: '/projects/WP/issues/7', ariaLabel: '알림 열기: A (멘션 2건)' })
    expect(rows[1]).toMatchObject({ meta: '멘션', ariaLabel: '알림 열기: B' })
  })

  it('묶음의 AI 점수는 매칭된 항목 중 최고값을 쓴다', () => {
    const rows = build({
      notifications: [mention({ id: 1, issueId: 7 }), mention({ id: 2, issueId: 7 })],
      priorityItems: [score('MENTION', '1', 10), score('MENTION', '2', 40)],
    })
    expect(rows[0].aiScore).toBe(40)
  })

  it('멘션 없는 일반 댓글(COMMENTED) 알림은 「멘션」 행으로 올리지 않는다(WP-1092)', () => {
    const rows = build({ notifications: [mention({ id: 1, type: 'COMMENTED' })] })
    expect(rows).toEqual([])
  })
})

describe('buildAttentionRows — 정렬', () => {
  it('AI 점수가 없으면 이슈(urgency 0) → 메시지(1) → 메일(2) 순서다', () => {
    const rows = build({
      dues: [due({ title: '마감 지난 이슈' })],
      mailRecent: [mail({ subject: '계약 검토 요청' })],
      messagingRecent: [convo({ aiReason: '배포 여부 질문' })],
    })
    expect(rows.map((r) => r.source)).toEqual(['이슈', '메시지', '메일'])
  })

  it('같은 urgency 안에서는 최신순이다(멘션·메시지 교차)', () => {
    const rows = build({
      notifications: [mention({ issueTitle: '옛 멘션', createdAt: '2026-06-16T00:00:00Z' })],
      messagingRecent: [convo({ label: '#새 대화', needsReply: true, lastMessageAt: '2026-06-16T02:00:00Z' })],
    })
    expect(rows.map((r) => r.title)).toEqual(['#새 대화', '옛 멘션'])
  })

  it('양쪽 다 AI 점수가 있으면 소스 고정 순위 대신 점수합산 내림차순이다', () => {
    const rows = build({
      dues: [due({ issueId: 1, title: '이슈 A' })],
      notifications: [mention({ id: 2, issueTitle: '멘션 B' })],
      priorityItems: [score('ISSUE_DUE', '1', 20), score('MENTION', '2', 180)],
    })
    expect(rows.map((r) => r.title)).toEqual(['멘션 B', '이슈 A'])
    expect(rows.map((r) => r.aiScore)).toEqual([180, 20])
  })

  it('한쪽이라도 AI 점수가 없으면(배치 전 신규 후보) 기존 urgency 순위로 폴백한다', () => {
    const rows = build({
      dues: [due({ issueId: 1, title: '이슈 A' })],
      notifications: [mention({ id: 2, issueTitle: '멘션 B' })],
      priorityItems: [score('MENTION', '2', 180)],
    })
    expect(rows.map((r) => r.title)).toEqual(['이슈 A', '멘션 B'])
  })
})
