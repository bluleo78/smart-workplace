// 합성 레이어 "지금 신경 쓸 일" 멘션 행 묶기(WP-258) — 같은 이슈에 코멘트가 여러 번 달리면 안 읽은
// COMMENTED 알림이 이슈 하나에 여러 건 쌓여 같은 제목 줄이 반복됐다. 이동 대상(notifTarget)이 같은
// 알림을 한 묶음으로 모아 한 줄 + 건수로 보여주기 위한 순수 그룹핑 함수. DOM/React 비의존(vitest 대상).
import { parseUtcDate } from '@/lib/formatters'
import type { NotificationResponse } from '@/types/notification'

import { isMentionLike, notifTarget } from '../notifTarget'

/** 이동 대상이 같은 안 읽은 멘션 알림 묶음. */
export interface MentionGroup {
  /** 묶음 키 = 이동 대상 라우트(식별 정보가 없는 알림은 알림 id 단위로 따로 둔다). */
  key: string
  /** 묶음의 이동 대상 라우트. */
  to: string
  /** 가장 최근 알림 — 제목·시각의 대표값. */
  latest: NotificationResponse
  /** 묶인 알림 전체(입력 순서 유지). AI 점수 대표값 산출에 쓴다. */
  items: NotificationResponse[]
}

// notifTarget 이 식별 정보가 없을 때 돌려주는 폴백 라우트 — 서로 다른 알림이 이 값으로 잘못 묶이지 않게 구분한다.
const FALLBACK_TARGET = '/me/tasks/assigned'

/**
 * 안 읽은 멘션성 알림을 이동 대상(notifTarget)별로 묶는다.
 *
 * - 읽은 알림·멘션이 아닌 알림은 제외(기존 행 필터와 동일 규칙).
 * - 반환 순서는 각 묶음이 처음 등장한 순서 — 최종 정렬은 호출측(recency/AI 점수)이 한다.
 */
export function groupMentionNotifs(notifs: NotificationResponse[]): MentionGroup[] {
  const groups = new Map<string, MentionGroup>()
  for (const n of notifs) {
    if (!isMentionLike(n) || n.read) continue
    const to = notifTarget(n)
    const key = to === FALLBACK_TARGET ? `#${n.id}` : to
    const g = groups.get(key)
    if (!g) {
      groups.set(key, { key, to, latest: n, items: [n] })
      continue
    }
    g.items.push(n)
    // 문자열 비교 금지 — 서버 직렬화가 소수초 자릿수를 생략해(…:00Z vs …:00.5Z) 사전순이 시간순과 어긋난다.
    if (parseUtcDate(n.createdAt).getTime() > parseUtcDate(g.latest.createdAt).getTime()) g.latest = n
  }
  return [...groups.values()]
}
