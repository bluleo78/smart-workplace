// 요약 위젯 KPI 5종 건수 집계(WP-161) — 데스크톱 펼친 화면(SynthesisLayer)과 모바일 접힘 한 줄(useSynthesisCounts)이
// 같은 규칙을 쓰도록 계산 경로를 이 순수 함수 하나로 모은다. 규칙이 한 곳에서만 바뀌므로 두 화면 숫자가 어긋나지 않는다.
import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'
import type { MailSummary, MessagingSummary } from '@/types/dashboard'
import type { NotificationResponse } from '@/types/notification'

import { isMentionLike } from '../notifTarget'
import { mailBadgeCount } from '../widgets/mobile/summaries/summaryLogic'

/** KPI 집계 입력 — 각 소스의 이미 받아온 데이터(아직 없으면 빈 배열/undefined). */
export interface SynthesisCountsInput {
  dues: IssueDueMarker[]
  notifications: NotificationResponse[]
  mail: MailSummary | undefined
  events: CalendarEvent[]
  messaging: MessagingSummary | undefined
  /** 오늘 날짜 키(yyyy-MM-dd, 로컬) — '오늘 마감' 판정 기준. */
  todayKey: string
}

/** KPI 5종 건수 + 메일 칸 라벨 스왑 여부(classifyOn). */
export interface SynthesisCounts {
  /** 오늘 마감 이슈 수(마감일 == 오늘). 지난 마감은 '지금 신경 쓸 일' 행에서만 다룬다. */
  dueToday: number
  /** 안 읽은 멘션성 알림 수(묶기 전 건수). */
  mention: number
  /** 메일 배지 — 분류 활성이면 회신 필요, 아니면 안 읽음(mailBadgeCount 스왑 규칙). */
  mail: number
  /** 오늘 일정 수(조회 범위가 이미 오늘이라 그대로 길이). */
  event: number
  /** 메시징 확인 필요 — 회신대기 ∪ AI 발굴 dedup 값(백엔드 attentionCount 단일값; 단순 합산은 이중 집계). */
  chat: number
  /** 메일 AI 분류 활성 여부 — 메일 칸 라벨('회신 필요' / '안 읽음')·AI 배지 선택에 쓴다. */
  classifyOn: boolean
}

/** KPI 5종 건수를 계산한다. 로딩·에러 판정은 호출부(셀 단위 격리) 몫이다. */
export function computeSynthesisCounts(input: SynthesisCountsInput): SynthesisCounts {
  return {
    dueToday: input.dues.filter((d) => d.dueDate === input.todayKey).length,
    mention: input.notifications.filter((n) => isMentionLike(n) && !n.read).length,
    mail: mailBadgeCount(input.mail),
    event: input.events.length,
    chat: input.messaging?.attentionCount ?? 0,
    classifyOn: input.mail?.classificationActive ?? false,
  }
}
