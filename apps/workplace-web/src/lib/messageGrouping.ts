// 연속 메시지 그룹핑 — 직전 메시지와 같은 작성자이고 시간이 근접하면 한 그룹으로 묶는다(Slack 패턴).
// 그룹의 첫 줄에만 아바타/이름/시각을 표시하고, 후속 줄은 본문만 들여쓴다.
import type { MessageResponse } from '@/types/messaging'

import { getDateKey, parseUtcDate } from './formatters'

// 같은 그룹으로 인정하는 최대 간격(분).
const GROUP_GAP_MINUTES = 5

/** curr 가 새 그룹의 첫 줄인지 — 직전(prev)이 없거나, 작성자가 다르거나, 간격이 임계 초과면 true. */
export function shouldStartNewGroup(
  prev: MessageResponse | null,
  curr: MessageResponse,
): boolean {
  if (!prev) return true
  if (prev.authorId !== curr.authorId) return true
  // 서버 LocalDateTime(UTC) 파싱은 formatters.parseUtcDate 로 단일화(중복 제거).
  const gapMs = parseUtcDate(curr.createdAt).getTime() - parseUtcDate(prev.createdAt).getTime()
  return gapMs > GROUP_GAP_MINUTES * 60_000
}

/**
 * curr 앞에 날짜 구분선을 넣을지 — 첫 메시지이거나 직전 메시지와 KST 날짜가 다르면 true(#338).
 * 서버 시각은 UTC 라 그대로 날짜를 자르면 KST 자정~09시 메시지가 전날로 묶인다 — getDateKey 가 KST 로 변환한다.
 */
export function startsNewDay(
  prev: Pick<MessageResponse, 'createdAt'> | null,
  curr: Pick<MessageResponse, 'createdAt'>,
): boolean {
  return !prev || getDateKey(curr.createdAt) !== getDateKey(prev.createdAt)
}
