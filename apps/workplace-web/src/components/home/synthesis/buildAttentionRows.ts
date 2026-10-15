// '지금 신경 쓸 일' 행 병합·정렬 규칙(WP-412) — SynthesisLayer 가 그리던 판단 로직을 순수 함수로 뺐다.
// 화면 없이 규칙(어떤 항목이 끼는지·meta 문구·딥링크·정렬 순서)을 단위 테스트로 고정하기 위함이다.
import type { PriorityItem } from '@/api/priorityItems'
import { formatRelativeTime, parseUtcDate } from '@/lib/formatters'
import { isNeedsReply } from '@/lib/mailNeedsReply'
import type { IssueDueMarker } from '@/types/calendar'
import type { MailSummary, MessagingSummary } from '@/types/dashboard'
import type { NotificationResponse } from '@/types/notification'

import { notifLabel } from '../notifTarget'
import { groupMentionNotifs } from './groupMentions'

// 지금 신경 쓸 일 한 행의 표준 모델.
// source: 소스 앱 구분 — '이슈'(urgency 0), '멘션'·'메시지'(urgency 1), '메일'(urgency 2, AI 회신 필요).
// isAi: AI 발굴 신호 — meta 를 text-ai-accent 로 강조 표시.
export interface AttentionRow {
  key: string
  source: '이슈' | '멘션' | '메일' | '메시지'
  title: string
  meta: string // 우측 정렬 메타(마감/시각)
  to: string
  ariaLabel: string
  urgency: number // 작을수록 위(0=마감지남/오늘, 1=멘션·메시지, 2=회신필요메일)
  recency: number // 동일 urgency 내 최신순(epoch ms, 클수록 위)
  isAi?: boolean // AI 발굴 신호(메시지 aiReason, 메일 aiNeedsReply)
  aiScore: number | null // AI 배치 점수합산(없으면 null, 정렬 시 urgency 폴백)
}

/**
 * 행 병합 입력 — 각 소스의 이미 받아온 데이터.
 * 에러난 소스는 호출부가 빈 값으로 넘긴다(TanStack Query 는 재조회 실패 시에도 이전 data 를 유지하므로
 * 에러 소스를 빼는 판단은 호출부의 isError 게이트 몫).
 */
export interface AttentionRowsInput {
  dues: IssueDueMarker[]
  notifications: NotificationResponse[]
  mailRecent: MailSummary['recent']
  messagingRecent: MessagingSummary['recent']
  /** AI 우선순위 점수(15분 배치) — sourceType+sourceId 로 매칭해 정렬 키로 쓴다. */
  priorityItems: PriorityItem[]
  /** 오늘 날짜 키(yyyy-MM-dd, 로컬) — 마감 지남/오늘 판정 기준. */
  todayKey: string
}

/**
 * 크로스앱 급한 것(마감 지남/오늘 이슈·멘션·회신 필요 메일·어텐션 대화)을 한 목록으로 합쳐 정렬해 돌려준다.
 * 표시 개수 제한(상위 5건)은 화면 몫이라 호출부가 자른다.
 */
export function buildAttentionRows(input: AttentionRowsInput): AttentionRow[] {
  const { todayKey, priorityItems } = input
  // 아직 배치가 못 돈 신규 후보는 매칭이 안 되므로 null → 기존 소스 고정 순위로 폴백(정렬 실패로 전체가 깨지지 않도록 방어).
  const priorityScoreOf = (sourceType: string, sourceId: string): number | null => {
    const match = priorityItems.find((i) => i.sourceType === sourceType && i.sourceId === sourceId)
    return match ? match.importanceScore + match.urgencyScore : null
  }
  const rows: AttentionRow[] = []

  // 1) 마감 지남/오늘 이슈 — urgency 0.
  for (const d of input.dues) {
    if (d.dueDate <= todayKey) {
      const overdue = d.dueDate < todayKey
      rows.push({
        key: `due-${d.issueId}`,
        source: '이슈',
        title: d.title,
        meta: overdue ? '마감 지남' : '오늘 마감',
        to: `/projects/${d.projectKey}/issues/${d.number}`,
        ariaLabel: `이슈 열기: ${d.title}`,
        urgency: 0,
        // 마감일만 있어 recency 는 마감일 epoch(지난 게 더 위로 오게 음수 정렬은 urgency 가 처리).
        recency: parseUtcDate(`${d.dueDate}T00:00:00Z`).getTime(),
        aiScore: priorityScoreOf('ISSUE_DUE', String(d.issueId)),
      })
    }
  }

  // 2) @멘션(안 읽은 COMMENTED) — urgency 1.
  // WP-258: 같은 이슈에 코멘트가 여러 번 달리면 같은 제목 줄이 반복됐다 → 이동 대상(notifTarget) 기준으로
  // 묶어 한 줄 + 건수·최신 시각("멘션 2 · 3시간 전")으로 보여준다. 단건은 다른 행과 같은 짧은 라벨('멘션') 유지.
  // 상단 '멘션' 카운트 셀은 묶기 전 건수 그대로.
  for (const g of groupMentionNotifs(input.notifications)) {
    const n = g.latest
    // AI 점수 대표값 — 묶음 중 최고 점수(배치가 일부만 채점했어도 매칭된 값 중 가장 급한 것을 따른다).
    const scores = g.items
      .map((it) => priorityScoreOf('MENTION', String(it.id)))
      .filter((s): s is number => s != null)
    const count = g.items.length
    rows.push({
      key: `notif-${g.key}`,
      source: '멘션',
      title: notifLabel(n),
      meta: count > 1 ? `멘션 ${count} · ${formatRelativeTime(n.createdAt)}` : '멘션',
      to: g.to,
      ariaLabel: `알림 열기: ${notifLabel(n)}${count > 1 ? ` (멘션 ${count}건)` : ''}`,
      urgency: 1,
      recency: parseUtcDate(n.createdAt).getTime(),
      aiScore: scores.length > 0 ? Math.max(...scores) : null,
    })
  }

  // 3) 회신 필요 메일(분류 활성 + aiNeedsReply===true && 안읽음) — urgency 2.
  // pending(aiNeedsReply null)은 제외 — AI 판정 전 상태라 노이즈.
  for (const m of input.mailRecent) {
    if (isNeedsReply(m)) {
      rows.push({
        key: `mail-${m.id}`,
        source: '메일',
        title: m.subject ?? '(제목 없음)',
        meta: '회신 필요',
        // accountId 기반 딥링크 — Task 6 가 소비.
        to: `/mail/${m.accountId}?messageId=${m.id}`,
        ariaLabel: `메일 열기: ${m.subject ?? '(제목 없음)'}`,
        urgency: 2,
        recency: parseUtcDate(m.receivedAt ?? '1970-01-01T00:00:00Z').getTime(),
        aiScore: priorityScoreOf('MAIL_NEEDS_REPLY', String(m.id)),
      })
    }
  }

  // 4) 메시징 어텐션 대화 — urgency 1(멘션과 동렬, recency 로 교차 정렬).
  // 필터: 멘션·회신대기·AI발굴·새 스레드 답글 중 하나라도 있는 것만.
  for (const c of input.messagingRecent) {
    const isAttention = c.mentioned || c.needsReply || c.aiReason != null || c.newThreadReplyCount > 0
    if (!isAttention) continue

    // meta: 신호 우선순위(AI발굴 > 멘션 > 회신 > 새 답글).
    const meta =
      c.aiReason != null
        ? '확인 필요'
        : c.mentioned
          ? '멘션'
          : c.needsReply
            ? '회신'
            : `새 답글 ${c.newThreadReplyCount}`

    rows.push({
      key: `chat-${c.conversationId}`,
      source: '메시지',
      title: c.label,
      meta,
      // DM은 /chat/dms/:id, 채널은 /chat/channels/:id 딥링크.
      to: c.kind === 'DM' ? `/chat/dms/${c.conversationId}` : `/chat/channels/${c.conversationId}`,
      ariaLabel: `대화 열기: ${c.label}`,
      urgency: 1,
      recency: c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0,
      isAi: c.aiReason != null,
      aiScore: priorityScoreOf('MESSAGE_ATTENTION', String(c.conversationId)),
    })
  }

  // 긴급도 우선, 동일 긴급도 내 최신순 — 이었던 기존 규칙을 AI 점수합산 내림차순(동점/미매칭 시 기존
  // urgency 폴백 → recency)으로 교체. aiScore 가 둘 다 있으면 그것으로, 하나라도 null 이면 기존 규칙.
  rows.sort((a, b) => {
    if (a.aiScore != null && b.aiScore != null) {
      return b.aiScore - a.aiScore || b.recency - a.recency
    }
    return a.urgency - b.urgency || b.recency - a.recency
  })
  return rows
}
