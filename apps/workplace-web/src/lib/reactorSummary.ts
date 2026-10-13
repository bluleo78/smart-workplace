// 반응자 요약 문구(WP-106) — 호버 카드의 "나, 이영희, 박지훈 외 2명이 반응했습니다".
// 총원은 받은 목록이 아니라 칩 count(SSE 로 실시간 유지)를, "나" 여부는 칩 reacted 를 따른다 — 서버 정렬(먼저 누른 순)을
// 바꾸지 않고 클라이언트에서 "나" 를 맨 앞에 둔다. 조사는 마지막 이름의 받침으로 고른다.
import { iGa } from '@/lib/utils'
import type { ReactorResponse } from '@/types/messaging'

/** 요약에 이름으로 보여줄 최대 인원(나 포함). 나머지는 "외 N명". */
const MAX_NAMED = 3

/** 받은 반응자 중 나를 뺀 사람들(받은 순서 유지). "나" 는 reacted 로 따로 맨 앞에 둔다. */
export function othersOf(items: ReactorResponse[], currentUserId: number): ReactorResponse[] {
  return items.filter((r) => r.userId !== currentUserId)
}

/**
 * @param count 칩의 반응 수(진실원)
 * @param reacted 내가 이 이모지를 눌렀는가
 * @param names 나를 뺀 다른 반응자 이름(받은 순서)
 */
export function formatReactorSummary({
  count,
  reacted,
  names,
}: {
  count: number
  reacted: boolean
  names: string[]
}): string {
  // 이름으로 보일 사람 — "나" 먼저, 총원(count)을 넘지 않게.
  const shown = [...(reacted ? ['나'] : []), ...names].slice(0, Math.min(MAX_NAMED, count))
  if (shown.length === 0) return `${count}명이 반응했습니다`
  const rest = count - shown.length
  if (rest > 0) return `${shown.join(', ')} 외 ${rest}명이 반응했습니다`
  if (shown.length === 1 && reacted) return '내가 반응했습니다'
  const last = shown[shown.length - 1]
  return `${shown.join(', ')}${iGa(last)} 반응했습니다`
}
